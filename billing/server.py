"""Dealership billing service. All balances are in units of 1/60 of one cent."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from decimal import Decimal
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlparse

ROOT = Path(os.getenv("BILLING_DATA", "billing-data"))
ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
ORIGIN = os.getenv("BILLING_ORIGIN", "https://autodealership.si")
MERCHANT = os.getenv("WHOP_ACCOUNT_ID", "")
KEY = os.getenv("WHOP_API_KEY", "")
SECRET = os.getenv("WHOP_WEBHOOK_SECRET", "")
API = "https://sandbox-api.whop.com/api/v1" if os.getenv("WHOP_ENV") == "sandbox" else "https://api.whop.com/api/v1"
PLANS = {"website": (499, 0), "starter": (798, 150), "concierge": (1499, 750), "phone": (2499, 2000)}
VARIANTS = json.loads(os.getenv("WHOP_VARIANTS", "{}"))
AGENTS = json.loads(os.getenv("VOICE_AGENT_ACCOUNTS", "{}"))
CAP_UNIT = 6000
now = lambda: int(time.time())

@contextmanager
def transaction():
    db = sqlite3.connect(ROOT / "billing.sqlite", timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN IMMEDIATE")
        yield db
        db.commit()
    finally:
        db.close()

with transaction() as db:
    db.executescript("""
    CREATE TABLE IF NOT EXISTS dealers(id TEXT PRIMARY KEY,email TEXT UNIQUE,name TEXT,password TEXT,plan TEXT,marketing INTEGER,
      status TEXT DEFAULT 'signup',cycle INTEGER DEFAULT 0,used INTEGER DEFAULT 0,balance INTEGER DEFAULT 0,
      refill INTEGER DEFAULT 100,cap INTEGER DEFAULT 300,auto INTEGER DEFAULT 0,member TEXT,method TEXT,membership TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,dealer TEXT,expires INTEGER);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,dealer TEXT,kind TEXT,amount INTEGER,variant TEXT,
      cycle INTEGER,state TEXT DEFAULT 'pending',payment TEXT UNIQUE,checkout TEXT,url TEXT,created INTEGER);
    CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,dealer TEXT,kind TEXT,amount INTEGER,received INTEGER);
    CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,dealer TEXT,ended INTEGER,seconds INTEGER,charged INTEGER);
    CREATE TABLE IF NOT EXISTS cycles(dealer TEXT,start INTEGER,used INTEGER DEFAULT 0,PRIMARY KEY(dealer,start));
    CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY,dealer TEXT,subject TEXT,body TEXT,created INTEGER,sent INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS holds(id TEXT PRIMARY KEY,dealer TEXT,expires INTEGER,seconds INTEGER);
    CREATE TABLE IF NOT EXISTS consent(dealer TEXT,at INTEGER,settings TEXT);
    """)

def one(db, sql, *args):
    return db.execute(sql,args).fetchone()

def require(condition, message):
    if not condition:
        raise ValueError(message)

def passwd(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def plan_key(d):
    return d["plan"] + ("_marketing" if d["marketing"] else "")

def price(d):
    return PLANS[d["plan"]][0]+2500*d["marketing"]

def ready():
    return bool(MERCHANT and KEY and SECRET)

def provider(route, body, key):
    req=Request(API+route,data=json.dumps(body).encode(),headers={"Authorization":"Bearer "+KEY,
        "Content-Type":"application/json","Api-Version-Date":"2026-11-23-3","Idempotency-Key":key})
    with urlopen(req,timeout=12) as response:
        return json.load(response)

def start_order(db,d,kind,amount,variant):
    existing=one(db,"SELECT * FROM orders WHERE dealer=? AND kind=? AND state='pending'",d["id"],kind)
    if existing:
        require(existing["amount"]==amount and existing["variant"]==variant,"Finish the pending checkout before choosing another amount.")
        return existing
    order=uuid.uuid4().hex
    db.execute("INSERT INTO orders(id,dealer,kind,amount,variant,cycle,created) VALUES(?,?,?,?,?,?,?)",
               (order,d["id"],kind,amount,variant,d["cycle"],now()))
    return one(db,"SELECT * FROM orders WHERE id=?",order)

def checkout(dealer,kind,amount=0):
    require(ready(),"Your signup is saved. Whop checkout will open once this merchant is connected.")
    with transaction() as db:
        d=one(db,"SELECT * FROM dealers WHERE id=?",dealer)
        if kind=="subscription":
            require(d["status"]=="signup","Subscription already started.")
            variant=VARIANTS.get(plan_key(d));amount=price(d)
        else:
            require(d["status"]=="active" and d["plan"]!="website","An active voice subscription is required.")
            variant="setup" if kind=="card" else VARIANTS.get("credit_"+str(amount))
        require(variant,"Checkout for this selection is pending merchant setup.")
        o=start_order(db,d,kind,amount,variant)
    if o["url"]:return o["url"]
    body={"account_id":MERCHANT,"metadata":{"adsi_order":o["id"]},"redirect_url":ORIGIN+"/signup.html"}
    if kind=="card":body["mode"]="setup"
    else:body["variant_id"]=variant
    result=provider("/checkout_configurations",body,o["id"])
    url=result["purchase_url"]
    require(urlparse(url).scheme=="https" and urlparse(url).hostname in {"whop.com","sandbox.whop.com","www.whop.com"},"Unexpected checkout URL.")
    with transaction() as db:
        db.execute("UPDATE orders SET checkout=?,url=? WHERE id=?",(result["id"],url,o["id"]))
    return url

def billed(seconds, included):
    seconds=max(0,seconds-included*60)
    return min(seconds,300000)*35+min(max(0,seconds-300000),900000)*30+max(0,seconds-1200000)*27

def queue_refill(db,d):
    if not (ready() and d["auto"] and d["method"] and d["status"]=="active"):return
    if d["used"] < max(0,PLANS[d["plan"]][1]*60-300):return
    if d["balance"] >= d["refill"]*CAP_UNIT//5:return
    total=one(db,"SELECT COALESCE(SUM(amount),0) FROM orders WHERE dealer=? AND cycle=? AND kind='auto' AND state IN ('pending','paid')",d["id"],d["cycle"])[0]
    variant=VARIANTS.get("credit_"+str(d["refill"]))
    if variant and total+d["refill"]<=d["cap"]:
        start_order(db,d,"auto",d["refill"],variant)

def notify(db,key,dealer,subject,body):
    db.execute("INSERT OR IGNORE INTO notices(id,dealer,subject,body,created) VALUES(?,?,?,?,?)",(key,dealer,subject,body,now()))

def admit(db,dealer):
    d=one(db,"SELECT * FROM dealers WHERE id=?",dealer)
    if not d or d["status"]!="active" or d["plan"]=="website":return {"allowed":False}
    db.execute("DELETE FROM holds WHERE expires<=?",(now(),))
    reserved=one(db,"SELECT COALESCE(SUM(seconds),0) FROM holds WHERE dealer=?",dealer)[0]
    free=max(0,PLANS[d["plan"]][1]*60-d["used"])
    # Conservatively reserve at the most expensive tier.
    available=max(0,free+d["balance"]//35-reserved)
    if not available:return {"allowed":False,"fallback":"text_or_dealer_phone"}
    hold=uuid.uuid4().hex
    duration=min(300,available)
    db.execute("INSERT INTO holds VALUES(?,?,?,?)",(hold,dealer,now()+duration+120,duration))
    return {"allowed":True,"reservation":hold,"maximumConnectedSeconds":duration}

def meter(db,data):
    dealer=AGENTS.get(data["agent_id"])
    if not dealer:return
    d=one(db,"SELECT * FROM dealers WHERE id=?",dealer)
    if not d or not d["cycle"]:return
    cid=data["conversation_id"];meta=data["metadata"]
    seconds=meta["call_duration_secs"];start=meta["start_time_unix_secs"]
    require(type(seconds) is int and seconds>=0,"Invalid duration.")
    if one(db,"SELECT id FROM calls WHERE id=?",cid):return
    cycle=one(db,"SELECT * FROM cycles WHERE dealer=? AND start<=? ORDER BY start DESC LIMIT 1",dealer,start)
    if not cycle:return
    allowance=PLANS[d["plan"]][1]
    reservation=((data.get("conversation_initiation_client_data") or {}).get("dynamic_variables") or {}).get("billing_reservation")
    if reservation:db.execute("DELETE FROM holds WHERE id=? AND dealer=?",(reservation,dealer))
    cost=billed(cycle["used"]+seconds,allowance)-billed(cycle["used"],allowance)
    charge=min(cost,d["balance"])
    db.execute("INSERT INTO calls VALUES(?,?,?,?,?)",(cid,dealer,start+seconds,seconds,charge))
    db.execute("UPDATE cycles SET used=used+? WHERE dealer=? AND start=?",(seconds,dealer,cycle["start"]))
    db.execute("UPDATE dealers SET balance=balance-?,used=used+? WHERE id=?",(charge,seconds if cycle["start"]==d["cycle"] else 0,dealer))
    queue_refill(db,one(db,"SELECT * FROM dealers WHERE id=?",dealer))

def whop_event(db,event):
    typ=event["type"];v=event["data"]
    if not MERCHANT or (v.get("account_id") or v.get("company_id"))!=MERCHANT:return
    ref=(v.get("metadata") or {}).get("adsi_order","")
    order=one(db,"SELECT * FROM orders WHERE id=? OR checkout=?",ref,v.get("checkout_configuration_id"))
    membership=v.get("membership_id")
    if typ=="membership.deactivated":
        db.execute("UPDATE dealers SET status='inactive',auto=0 WHERE membership=?",(v["id"],));return
    if typ=="setup_intent.succeeded" and order and order["kind"]=="card":
        d=one(db,"SELECT member FROM dealers WHERE id=?",order["dealer"])
        if d["member"]==v.get("member_id") and v.get("payment_method_id"):
            db.execute("UPDATE dealers SET method=? WHERE id=?",(v["payment_method_id"],order["dealer"]))
            db.execute("UPDATE orders SET state='paid' WHERE id=?",(order["id"],))
        return
    if typ=="payment.failed" and order and order["kind"]=="auto":
        db.execute("UPDATE orders SET state='failed' WHERE id=? AND state='pending'",(order["id"],))
        db.execute("UPDATE dealers SET auto=0 WHERE id=?",(order["dealer"],))
        notify(db,"failed:"+v["id"],order["dealer"],"Automatic voice refill failed","Your payment failed. Sign in to review your saved card and turn automatic refills back on.")
        return
    if typ!="payment.succeeded":return
    subtotal=v.get("subtotal")
    currency=subtotal.get("currency") if isinstance(subtotal,dict) else v.get("currency")
    if currency!="usd":return
    received=Decimal(str(subtotal["amount"] if isinstance(subtotal,dict) else subtotal))
    if one(db,"SELECT id FROM payments WHERE id=?",v["id"]):return
    if order and order["variant"]!=v.get("variant_id"):return
    d=one(db,"SELECT * FROM dealers WHERE id=?",order["dealer"]) if order else one(db,"SELECT * FROM dealers WHERE membership=?",membership)
    if not d:return
    kind=order["kind"] if order else "subscription"
    if kind=="subscription":
        if received!=price(d):return
        if not membership or not v.get("member_id") or v.get("variant_id")!=VARIANTS.get(plan_key(d)):return
        if d["membership"] and d["membership"]!=membership:return
        stamp=int(datetime.fromisoformat(v["paid_at"].replace("Z","+00:00")).timestamp())
        db.execute("INSERT OR IGNORE INTO cycles(dealer,start) VALUES(?,?)",(d["id"],stamp))
        if stamp>=d["cycle"]:
            db.execute("UPDATE dealers SET status='active',membership=?,member=?,cycle=?,used=0 WHERE id=?",(membership,v["member_id"],stamp,d["id"]))
        amount=price(d)
    elif kind in ("auto","manual"):
        if not order or order["state"]=="paid" or d["member"]!=v.get("member_id"):return
        amount=order["amount"]
        if received!=amount:return
        db.execute("UPDATE dealers SET balance=balance+? WHERE id=?",(amount*CAP_UNIT,d["id"]))
    else:return
    db.execute("INSERT INTO payments VALUES(?,?,?,?,?)",(v["id"],d["id"],kind,amount,now()))
    notify(db,"receipt:"+v["id"],d["id"],"Whop payment received","Your "+kind+" payment was confirmed. Reference "+v["id"]+". View the payment in your dealer billing account.")
    if kind=="auto" and d["cap"]>0:
        prior=one(db,"SELECT COALESCE(SUM(amount),0) FROM orders WHERE dealer=? AND cycle=? AND kind='auto' AND state='paid'",d["id"],order["cycle"])[0]
        if (prior+amount)*5>=d["cap"]*4:
            notify(db,"limit:"+d["id"]+":"+str(order["cycle"]),d["id"],"Voice top-ups have reached 80% of your limit","Review your automatic card-charge limit in your billing account.")
    if order:db.execute("UPDATE orders SET state='paid',payment=? WHERE id=?",(v["id"],order["id"]))

def verify_whop(headers,body):
    secret=SECRET
    ts=headers.get("webhook-timestamp","0");ident=headers.get("webhook-id","")
    if not secret or not ident or abs(now()-int(ts))>300:return False
    digest=hmac.digest(secret.encode(),ident.encode()+b"."+ts.encode()+b"."+body,"sha256")
    return any(hmac.compare_digest("v1,"+base64.b64encode(digest).decode(),sig) for sig in headers.get("webhook-signature","").split())

def verify_voice(headers,body):
    values=dict(part.strip().split("=",1) for part in headers.get("elevenlabs-signature","").split(",") if "=" in part)
    ts=values.get("t","0");secret=os.getenv("ELEVENLABS_WEBHOOK_SECRET","")
    return secret and abs(now()-int(ts))<=300 and hmac.compare_digest(values.get("v0",""),hmac.new(secret.encode(),ts.encode()+b"."+body,hashlib.sha256).hexdigest())

def preferences(data):
    refill=data.get("refill",100);cap=data.get("cap",300);auto=data.get("auto",False)
    require(type(auto) is bool and type(refill) is int and refill in (100,500) and type(cap) is int and 0<=cap<=100000 and (not auto or cap>=refill),"Check the refill amount and monthly limit.")
    return refill,cap,auto

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,code,data,cookie=None):
        body=json.dumps(data).encode()
        self.send_response(code);self.send_header("Content-Type","application/json");self.send_header("Cache-Control","no-store")
        if cookie:self.send_header("Set-Cookie",cookie)
        self.send_header("Content-Length",str(len(body)));self.end_headers();self.wfile.write(body)
    def token(self):
        c=SimpleCookie();c.load(self.headers.get("Cookie",""));v=c.get("dealer_billing")
        return hashlib.sha256((v.value if v else "").encode()).hexdigest()
    def dealer(self,db):
        return one(db,"SELECT d.* FROM dealers d JOIN sessions s ON s.dealer=d.id WHERE s.token=? AND s.expires>?",self.token(),now())
    def do_GET(self):
        if self.path!="/billing/account":return self.reply(404,{})
        with transaction() as db:
            d=self.dealer(db)
            if not d:return self.reply(200,{"signedIn":False,"checkoutAvailable":ready()})
            public={k:d[k] for k in ("name","email","plan","marketing","status","cycle","used","balance","refill","cap","auto")}
            public.update(signedIn=True,cardSaved=bool(d["method"]),checkoutAvailable=ready() and bool(VARIANTS.get(plan_key(d))),included=PLANS[d["plan"]][1],
                notices=[dict(x) for x in db.execute("SELECT subject,created FROM notices WHERE dealer=? ORDER BY created DESC LIMIT 5",(d["id"],))],
                receipts=[dict(x) for x in db.execute("SELECT kind,amount,received,id FROM payments WHERE dealer=? ORDER BY received DESC LIMIT 25",(d["id"],))])
            self.reply(200,public)
    def do_POST(self):
        try:self.post()
        except (ValueError,KeyError,TypeError) as exc:self.reply(400,{"error":str(exc)})
        except Exception:self.reply(503,{"error":"The operation could not be completed. Please try again."})
    def post(self):
        size=int(self.headers.get("Content-Length","0"))
        require(0<size<=(3000000 if self.path=="/billing/voice-hook" else 64000),"Invalid request size.")
        raw=self.rfile.read(size)
        if self.path in ("/billing/whop-hook","/billing/voice-hook"):
            whop=self.path.endswith("whop-hook")
            if not (verify_whop if whop else verify_voice)(self.headers,raw):return self.reply(403,{})
            event=json.loads(raw)
            with transaction() as db:
                if whop:whop_event(db,event)
                elif event["type"]=="post_call_transcription":meter(db,event["data"])
            return self.reply(200,{"received":True})
        if self.path=="/billing/internal/admit":
            configured=os.getenv("BILLING_ADMISSION_KEY","")
            if not configured or not hmac.compare_digest(self.headers.get("Authorization",""),"Bearer "+configured):return self.reply(403,{})
            with transaction() as db:result=admit(db,json.loads(raw)["dealer"])
            return self.reply(200,result)
        require(self.headers.get("Origin")==ORIGIN and self.headers.get_content_type()=="application/json","Use the dealership billing page.")
        data=json.loads(raw)
        with transaction() as db:
            if self.path in ("/billing/signup","/billing/login"):
                email=data["email"].strip().lower();password=data["password"]
                require(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email) and len(email)<=254 and 12<=len(password)<=256,"Enter an email and a password of 12–256 characters.")
                if self.path.endswith("signup"):
                    require(data["plan"] in PLANS and type(data.get("marketing",False)) is bool and 0<len(data["name"].strip())<=150,"Choose a package and enter your dealership name.")
                    salt=secrets.token_hex(16);dealer=uuid.uuid4().hex;refill,cap,auto=preferences(data)
                    try:db.execute("INSERT INTO dealers(id,email,name,password,plan,marketing,refill,cap,auto) VALUES(?,?,?,?,?,?,?,?,?)",(dealer,email,data["name"].strip(),salt+":"+passwd(password,salt),data["plan"],int(data.get("marketing",False)),refill,cap,auto))
                    except sqlite3.IntegrityError:raise ValueError("Use sign in if a billing account already exists.")
                    db.execute("INSERT INTO consent VALUES(?,?,?)",(dealer,now(),json.dumps({"version":1,"refill":refill,"threshold":refill//5,"cap":cap,"auto":auto})))
                else:
                    d=one(db,"SELECT * FROM dealers WHERE email=?",email)
                    salt,hashed=d["password"].split(":") if d else ("00"*16,"")
                    require(hmac.compare_digest(passwd(password,salt),hashed),"Invalid sign-in.")
                    dealer=d["id"]
                token=secrets.token_urlsafe(32)
                db.execute("INSERT INTO sessions VALUES(?,?,?)",(hashlib.sha256(token.encode()).hexdigest(),dealer,now()+86400*7))
                db.commit()
                return self.reply(200,{"saved":True},"dealer_billing="+token+"; HttpOnly; Secure; SameSite=Lax; Path=/billing; Max-Age=604800")
            d=self.dealer(db)
            if not d:return self.reply(401,{"error":"Please sign in."})
            dealer=d["id"]
            if self.path=="/billing/logout":
                db.execute("DELETE FROM sessions WHERE token=?",(self.token(),));return self.reply(200,{"saved":True})
            if self.path=="/billing/settings":
                refill,cap,auto=preferences(data)
                db.execute("UPDATE dealers SET refill=?,cap=?,auto=? WHERE id=?",(refill,cap,auto,dealer))
                db.execute("INSERT INTO consent VALUES(?,?,?)",(dealer,now(),json.dumps({"version":1,"refill":refill,"threshold":refill//5,"cap":cap,"auto":auto})))
                return self.reply(200,{"saved":True})
        kinds={"/billing/checkout":"subscription","/billing/save-card":"card","/billing/buy":"manual"}
        if self.path in kinds:
            amount=data.get("amount",0)
            require(self.path!="/billing/buy" or amount in (100,500),"Invalid refill.")
            return self.reply(200,{"url":checkout(dealer,kinds[self.path],amount)})
        self.reply(404,{})

def deliver_notices():
    host=os.getenv("BILLING_SMTP_HOST")
    if not host:return
    import smtplib
    from email.message import EmailMessage
    with transaction() as db:
        rows=db.execute("SELECT n.*,d.email FROM notices n JOIN dealers d ON d.id=n.dealer WHERE n.sent=0 ORDER BY created LIMIT 10").fetchall()
    for row in rows:
        email=EmailMessage()
        email["From"]=os.environ["BILLING_MAIL_FROM"]
        email["To"]=row["email"];email["Subject"]=row["subject"]
        email.set_content(row["body"]+"\n\n"+ORIGIN+"/signup.html")
        with smtplib.SMTP_SSL(host,int(os.getenv("BILLING_SMTP_PORT","465")),timeout=10) as smtp:
            if os.getenv("BILLING_SMTP_USER"):smtp.login(os.environ["BILLING_SMTP_USER"],os.environ["BILLING_SMTP_PASSWORD"])
            smtp.send_message(email)
        with transaction() as db:db.execute("UPDATE notices SET sent=1 WHERE id=?",(row["id"],))

def refill_worker():
    import logging
    while True:
        try:
            with transaction() as db:
                for d in db.execute("SELECT * FROM dealers WHERE status='active' AND auto=1").fetchall():queue_refill(db,d)
                orders=db.execute("SELECT o.*,d.member,d.method FROM orders o JOIN dealers d ON d.id=o.dealer WHERE o.kind='auto' AND o.state='pending' AND o.payment IS NULL AND d.auto=1 AND d.status='active'").fetchall()
            for o in orders:
                # Never replay an ambiguous request after the provider idempotency window.
                if now()-o["created"]>3600:continue
                result=provider("/payments",{"account_id":MERCHANT,"variant_id":o["variant"],"member_id":o["member"],"payment_method_id":o["method"],"metadata":{"adsi_order":o["id"]}},o["id"])
                with transaction() as db:db.execute("UPDATE orders SET payment=? WHERE id=?",(result["id"],o["id"]))
        except Exception:logging.warning("Pending Whop refill requires reconciliation.")
        try:deliver_notices()
        except Exception:logging.warning("Billing notification delivery pending.")
        time.sleep(30)

if __name__=="__main__":
    import threading
    threading.Thread(target=refill_worker,daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1",int(os.getenv("BILLING_PORT","18285"))),Handler).serve_forever()
