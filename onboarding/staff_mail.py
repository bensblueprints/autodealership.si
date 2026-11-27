"""Staff-owned email connections, scoped to a dealership and authenticated staff identity."""
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import uuid
from contextlib import contextmanager
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs,urlsplit,urlencode
from urllib.request import Request,urlopen
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from cryptography.fernet import Fernet
import staff_mail_transport as mail
from resend_connect import Problem,digest

PATH="/onboarding/staff-email"
CALLBACK="https://autodealership.si"+PATH+"/callback"
COOKIE="__Host-adsi_staff_mail"
SCOPES=["https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/gmail.readonly"]
SCHEMA="""
CREATE TABLE IF NOT EXISTS public.staff_mail_tickets(token text PRIMARY KEY,site uuid NOT NULL REFERENCES public.client_sites ON DELETE CASCADE,actor text NOT NULL,expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.staff_mail_sessions(token text PRIMARY KEY,site uuid NOT NULL REFERENCES public.client_sites ON DELETE CASCADE,actor text NOT NULL,expires timestamptz NOT NULL,state text UNIQUE,verifier text);
CREATE TABLE IF NOT EXISTS public.staff_mail_grants(id uuid PRIMARY KEY,site uuid NOT NULL REFERENCES public.client_sites ON DELETE CASCADE,actor text NOT NULL,address text NOT NULL,kind text NOT NULL,credentials text NOT NULL,cursor jsonb NOT NULL,paused boolean NOT NULL DEFAULT false,last_sync timestamptz,issue text NOT NULL DEFAULT '', UNIQUE(site,actor),UNIQUE(site,address));
"""
def cipher():return Fernet(os.environ["STAFF_MAIL_TOKEN_KEY"].encode())
def encoded(data):return cipher().encrypt(json.dumps(data).encode()).decode()
def google_configured():return bool(os.getenv("STAFF_GMAIL_CLIENT_ID") and os.getenv("STAFF_GMAIL_CLIENT_SECRET"))
def google_token(fields):
    data={**fields,"client_id":os.environ["STAFF_GMAIL_CLIENT_ID"],"client_secret":os.environ["STAFF_GMAIL_CLIENT_SECRET"]}
    req=Request("https://oauth2.googleapis.com/token",data=urlencode(data).encode())
    with urlopen(req,timeout=12) as r:return json.loads(r.read(20000))

@contextmanager
def tenant_store(site):
    schema="client_"+uuid.UUID(str(site["site"])).hex
    name=site["database_name"]
    if name and name!=schema:raise ValueError("Invalid database route.")
    with psycopg.connect(os.environ["CLIENT_DATABASE_URL"],**({"dbname":schema} if name else {}),row_factory=dict_row) as db:
        if not name:db.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
        yield db

def inbox_address(value):
    value=str(value or "").strip().lower()
    if len(value)>254 or not re.fullmatch(r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9-]+\.)+[a-z]{2,63}",value):raise ValueError("Enter your full mailbox address.")
    return value

def scope(handler,db):
    jar=SimpleCookie();jar.load(handler.headers.get("Cookie",""));c=jar.get(COOKIE)
    token=digest(c.value) if c else ""
    row=db.execute("""SELECT s.*,t.slug,t.name,t.database_name FROM public.staff_mail_sessions s JOIN public.client_sites t ON t.id=s.site
      WHERE s.token=%s AND s.expires>now() FOR UPDATE OF s""",(token,)).fetchone()
    if not row:raise Problem(403,"Open Connect my inbox from your dealership dashboard.")
    return row

def disconnect(db,who):
    old=db.execute("DELETE FROM public.staff_mail_grants WHERE site=%s AND actor=%s RETURNING id",(who["site"],who["actor"])).fetchone()
    if old:
        with tenant_store(who) as tenant:
            if tenant.execute("SELECT to_regclass('staff_mail_messages') AS t").fetchone()["t"]:
                tenant.execute("""UPDATE sales_email_messages SET state='canceled' WHERE state='staff queued' AND id IN
                   (SELECT message FROM staff_mail_messages WHERE grant_id=%s)""",(old["id"],))
def save(db,who,c,cursor):
    other=db.execute("SELECT actor FROM public.staff_mail_grants WHERE site=%s AND address=%s",(who["site"],c["address"])).fetchone()
    if other and other["actor"]!=who["actor"]:raise Problem(409,"This mailbox is already linked to another staff member at this dealership.")
    old=db.execute("SELECT id,address,kind FROM public.staff_mail_grants WHERE site=%s AND actor=%s FOR UPDATE",(who["site"],who["actor"])).fetchone()
    if old and old["address"]==c["address"] and old["kind"]==c["kind"]:
        db.execute("UPDATE public.staff_mail_grants SET credentials=%s,paused=false,issue='' WHERE id=%s",(encoded(c),old["id"]));return
    if old:disconnect(db,who)
    db.execute("""INSERT INTO public.staff_mail_grants(id,site,actor,address,kind,credentials,cursor)
       VALUES(%s,%s,%s,%s,%s,%s,%s)""",(uuid.uuid4(),who["site"],who["actor"],c["address"],c["kind"],encoded(c),json.dumps(cursor)))

def get(handler,connect):
    route=urlsplit(handler.path)
    if route.path==PATH:return handler.reply(200,Path(__file__).with_name("staff-email.html").read_bytes(),True)
    ok=False
    try:
        params=parse_qs(route.query,max_num_fields=12)
        with connect() as db:
            who=scope(handler,db);state=params.get("state",[""])[0]
            if not state or not secrets.compare_digest(digest(state),who["state"] or ""):raise ValueError()
            db.execute("UPDATE public.staff_mail_sessions SET state=NULL,verifier=NULL WHERE token=%s",(who["token"],))
            db.commit()  # Consume the one-time state even when the provider refuses the exchange.
            if params.get("code"):
                scope(handler,db)
                t=google_token({"grant_type":"authorization_code","code":params["code"][0],"redirect_uri":CALLBACK,"code_verifier":who["verifier"]})
                if not set(SCOPES)<=set(t.get("scope","").split()) or not t.get("refresh_token"):raise ValueError()
                identity=mail.gmail("GET","/profile",t["access_token"])
                c={"kind":"google","address":inbox_address(identity["emailAddress"]),"refresh":t["refresh_token"]}
                save(db,who,c,{"history":identity["historyId"]});ok=True
    except Exception as error:logging.info("Staff Google authorization incomplete (%s)",type(error).__name__)
    handler.send_response(303);handler.send_header("Location",PATH+"?result="+("connected" if ok else "failed"))
    handler.send_header("Cache-Control","no-store");handler.send_header("Referrer-Policy","no-referrer");handler.end_headers()

def post(handler,connect,action,data):
    try:
        with connect() as db:
            if action=="enter":
                ticket=str(data.get("ticket",""))
                if not re.fullmatch(r"[A-Za-z0-9_-]{43}",ticket):raise Problem(403,"Reopen Connect my inbox in the dealership dashboard.")
                who=db.execute("DELETE FROM public.staff_mail_tickets WHERE token=%s AND expires>now() RETURNING site,actor",(digest(ticket),)).fetchone()
                if not who:raise Problem(403,"This setup link expired. Reopen Connect my inbox.")
                token=secrets.token_urlsafe(32);db.execute("DELETE FROM public.staff_mail_sessions WHERE expires<=now()")
                db.execute("INSERT INTO public.staff_mail_sessions(token,site,actor,expires) VALUES(%s,%s,%s,now()+interval '15 minutes')",(digest(token),who["site"],who["actor"]))
                db.commit()
                handler.session_cookie=COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900"
                return handler.reply(200,{})
            who=scope(handler,db)
            if action=="status":
                grant=db.execute("SELECT address,kind,paused,issue,last_sync FROM public.staff_mail_grants WHERE site=%s AND actor=%s",(who["site"],who["actor"])).fetchone()
                result={"name":who["name"],"dashboard":"https://"+who["slug"]+".autodealership.si/dealer#conversations","google":google_configured(),"grant":grant}
            elif action=="google":
                if not google_configured():raise Problem(409,"Google sign-in has not been configured for the platform.")
                state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(64)
                challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
                db.execute("UPDATE public.staff_mail_sessions SET state=%s,verifier=%s WHERE token=%s",(digest(state),verifier,who["token"]))
                result={"url":"https://accounts.google.com/o/oauth2/v2/auth?"+urlencode({"client_id":os.environ["STAFF_GMAIL_CLIENT_ID"],"redirect_uri":CALLBACK,"response_type":"code","scope":" ".join(SCOPES),"state":state,"code_challenge":challenge,"code_challenge_method":"S256","access_type":"offline","prompt":"consent select_account"})}
            elif action=="connect":
                kind=data.get("kind");address=inbox_address(data.get("address"));password=data.get("password")
                if kind not in ("yahoo","imap") or not isinstance(password,str) or not 1<=len(password)<=512:raise ValueError("Enter the mailbox address and app password.")
                c={"kind":kind,"address":address,"password":password}
                if kind=="yahoo":
                    c.update(imap="imap.mail.yahoo.com",smtp="smtp.mail.yahoo.com",port=465)
                else:
                    c.update(imap=mail.public_host(data.get("imap")),smtp=mail.public_host(data.get("smtp")),port=int(data.get("port",465)))
                    if c["port"] not in (465,587):raise ValueError("Choose SMTP port 465 or 587.")
                    if data.get("smtpPassword"):
                        if not isinstance(data["smtpPassword"],str) or len(data["smtpPassword"])>512:raise ValueError("Check the outgoing app password.")
                        c["smtpPassword"]=data["smtpPassword"]
                try:position=mail.verify(c)
                except Exception:raise Problem(422,"The provider could not verify both incoming and outgoing mail. Check the provider settings and app password.")
                save(db,who,c,position);result={}
            elif action=="disconnect":disconnect(db,who);result={}
            else:raise Problem(404,"Unknown inbox operation.")
        return handler.reply(200,result)
    except Problem as e:return handler.reply(e.status,{"error":str(e)})
    except (ValueError,TypeError):return handler.reply(422,{"error":"Check the email address and provider settings."})
    except psycopg.errors.UniqueViolation:return handler.reply(409,{"error":"This mailbox is already connected."})
    except Exception:return handler.reply(503,{"error":"Mailbox setup is unavailable. Please try again."})
