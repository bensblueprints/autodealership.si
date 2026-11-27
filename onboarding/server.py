"""Owner-only client creation and staging; hosted separately from merchant billing."""
from http.cookies import SimpleCookie
import base64, hashlib, hmac, json, os, re, secrets, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import psycopg
from tenant_database import provision
from psycopg.rows import dict_row
import resend_connect
import resend_routes
import dealer_mail
import threading
import platform_mail
import platform_mail_routes

ROOT=Path(__file__).parent
ORIGIN="https://autodealership.si"
def connect():
    return psycopg.connect(os.environ["CLIENT_DATABASE_URL"],row_factory=dict_row)
with connect() as db:
    db.execute("""CREATE TABLE IF NOT EXISTS public.client_sites(
        id uuid PRIMARY KEY, slug text UNIQUE NOT NULL,name text NOT NULL,
        admin_hash text NOT NULL, rate integer NOT NULL,bhph boolean NOT NULL,
        voice boolean NOT NULL,agent_id text,domain text NOT NULL DEFAULT '',
        verified_domain text UNIQUE,agent_state text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now())""")
    db.execute("ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS database_name text UNIQUE")
    db.execute("CREATE TABLE IF NOT EXISTS public.owner_sessions(token text PRIMARY KEY,expires timestamptz NOT NULL)")
    db.execute("""CREATE TABLE IF NOT EXISTS public.client_engineers (
        id uuid PRIMARY KEY,email text UNIQUE NOT NULL,password text,invite_hash text UNIQUE,invite_expires timestamptz,active boolean NOT NULL DEFAULT true,
        failures integer NOT NULL DEFAULT 0,last_failure timestamptz);
        CREATE TABLE IF NOT EXISTS public.client_desk_sessions(token text PRIMARY KEY,slug text NOT NULL REFERENCES public.client_sites(slug),engineer uuid REFERENCES public.client_engineers(id),expires timestamptz NOT NULL);
        CREATE TABLE IF NOT EXISTS public.engineer_sessions(token text PRIMARY KEY,engineer uuid NOT NULL REFERENCES public.client_engineers(id),expires timestamptz NOT NULL);
        ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS engineer uuid REFERENCES public.client_engineers(id)""")
    db.execute(resend_connect.SCHEMA)
    db.execute(dealer_mail.MAILBOX_SCHEMA)
    db.execute(platform_mail.SCHEMA)
def digest(token):return hashlib.sha256(token.encode()).hexdigest()
def encoded_password(password,salt):
    return hashlib.scrypt(password.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1).hex()
def create(data,engineer=None):
    slug=data["slug"].strip().lower();name=data["name"].strip();rate=data["rate"];password=data["password"]
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,48}[a-z0-9]",slug) or slug in {"www","demo","admin","mail","api","dashboard","onboarding","billing","support"}:raise ValueError("Choose an available subdomain with 3 to 50 letters, numbers or hyphens.")
    if not 1<=len(name)<=100 or not 14<=len(password)<=128 or type(rate) is not int or not 0<=rate<=100000:raise ValueError("Check the dealership name, monthly rate and dealer password (14 characters minimum).")
    domain=data.get("domain","").strip().lower()
    if domain and (not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}",domain) or domain.endswith(".autodealership.si") or domain=="autodealership.si"):raise ValueError("Enter the future custom hostname without https://.")
    template=data.get("siteTemplate") or ("bhph" if data.get("bhph") is True else "independent")
    if template not in ("classic","franchise","independent","bhph"):raise ValueError("Choose a supported storefront template.")
    ident=uuid.uuid4()
    auth="Basic "+base64.b64encode(("dealer:"+password).encode()).decode()
    with connect() as db:
        db.execute("INSERT INTO public.client_sites(id,slug,name,admin_hash,rate,bhph,voice,domain,engineer) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",(ident,slug,name,hashlib.sha256(auth.encode()).hexdigest(),rate,data["bhph"] is True,data["voice"] is True,domain,engineer))
        provision(db,ident,name,template=template)
    return {"slug":slug}
def provision_agent(slug):
    with connect() as db:
        row=db.execute("UPDATE public.client_sites SET agent_state='provisioning' WHERE slug=%s AND voice AND agent_id IS NULL AND agent_state IN ('pending','failed') RETURNING name",(slug,)).fetchone()
    if not row:raise ValueError("Agent already created, unavailable, or awaiting reconciliation.")
    try:
        body={"name":row["name"]+" | Web concierge","conversation_config":{"agent":{"first_message":"Welcome to "+row["name"]+". How can I help you shop today?","prompt":{"tool_ids":["tool_7801m87be7rvfzcvxeg4rc4khfpt","tool_3201m87be7rwe3gvqaf660k9s1p3","tool_4401m87tye1kfhe9g57skerqtb32"],"prompt":"You are the website concierge for "+row["name"]+". Use search_inventory, open_vehicle and shopper_action on this website. For a vehicle question offer to send a shopper inquiry. Use shopper_action with workflow vehicle_inquiry. Resolve the exact vehicle and collect name, callback phone and the question. Once they agree, submit with car_id set to the selected VIN, name, phone, message and submit true. Only confirm delivery after submitted:true. For a test drive gather name, email, phone and available time, confirm once, then submit. After success ask about trade-in and preferences and use customer_notes. Use the vehicle details supplied in website context. Quote only published inventory and payment terms. Never guarantee financing or say a booking is confirmed without a successful booking result. If you lack current details, guide the shopper to a vehicle page or test-drive form."}}}}
        request=Request("https://api.elevenlabs.io/v1/convai/agents/create",data=json.dumps(body).encode(),headers={"xi-api-key":os.environ["ELEVENLABS_API_KEY"],"Content-Type":"application/json"})
        with urlopen(request,timeout=35) as response:agent=json.load(response)["agent_id"]
    except Exception as err:
        state="failed" if isinstance(err,(KeyError,HTTPError)) and (not isinstance(err,HTTPError) or err.code<500) else "check provider"
        with connect() as db:db.execute("UPDATE public.client_sites SET agent_state=%s WHERE slug=%s",(state,slug))
        raise ValueError("Voice provider setup requires attention. Website is saved.") from err
    with connect() as db:db.execute("UPDATE public.client_sites SET agent_id=%s,agent_state='created' WHERE slug=%s",(agent,slug))
    return {"saved":True}
class Handler(BaseHTTPRequestHandler):
    def reply(self,code,data,html=False):
        body=data if html else json.dumps(data,default=str).encode()
        self.send_response(code);self.send_header("Content-Type","text/html; charset=utf-8" if html else "application/json")
        self.send_header("Cache-Control","no-store");self.send_header("X-Frame-Options","DENY")

        if getattr(self,"session_cookie",None):self.send_header("Set-Cookie",self.session_cookie)
        self.end_headers();self.wfile.write(body)
    def identity(self):
        expected="Basic "+base64.b64encode(("owner:"+os.environ["CLIENT_OWNER_PASSWORD"]).encode()).decode()
        if hmac.compare_digest(self.headers.get("Authorization",""),expected):return "owner"
        c=SimpleCookie();c.load(self.headers.get("Cookie",""));v=c.get("onboarding_session")
        if v:
            with connect() as db:
                if db.execute("SELECT 1 FROM public.owner_sessions WHERE token=%s AND expires>now()",(digest(v.value),)).fetchone():return "owner"
                row=db.execute("SELECT e.id FROM public.engineer_sessions s JOIN public.client_engineers e ON e.id=s.engineer WHERE token=%s AND expires>now() AND e.active",(digest(v.value),)).fetchone()
            if row:return row["id"]
        return None
    def log_request(self, code="-", size="-"):
        self.log_message("%s %s %s", self.command, self.path.partition("?")[0], code)
    def do_GET(self):
        if self.path.partition("?")[0] in (platform_mail.PATH,platform_mail.PATH+"/callback",platform_mail_routes.UNSUB):
            return platform_mail_routes.get(self)
        if self.path.partition("?")[0] in ("/onboarding/email","/onboarding/email/callback"):
            return resend_routes.get(self,connect)
        if self.path.startswith("/api/v1/vin/"):
            vin=self.path.split("?",1)[0][len("/api/v1/vin/"):].upper()
            if not re.fullmatch(r"[A-HJ-NPR-Z0-9]{17}",vin):return self.reply(400,{"error":"Provide a 17-character VIN."})
            try:
                with connect() as db:
                    db.execute("SET LOCAL statement_timeout='6s'")
                    specs=db.execute("SELECT public.vehicle_specs(%s) AS specs",(vin,)).fetchone()["specs"]
            except psycopg.Error:return self.reply(503,{"error":"Vehicle catalog temporarily unavailable."})
            if not specs or specs.get("ErrorCode")!="0":return self.reply(422,{"vin":vin,"error":"VIN could not be confirmed."})
            return self.reply(200,{"vin":vin,"source":"NHTSA vPIC","catalogRelease":"2026-11","specs":specs})

        if self.path.split("?")[0] in ("/onboarding/clerk-login","/onboarding/clerk-team"):
            return self.reply(200,(ROOT/"clerk-login.html").read_text().replace("__KEY__",os.environ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"]).encode(),True)
        if self.path not in ["/onboarding/","/onboarding/owner","/onboarding/admin","/onboarding/sites","/onboarding/team"]:return self.reply(404,{})
        who=self.identity()
        if not who:
            if self.path in ["/onboarding/admin","/onboarding/owner"]:return self.reply(200,(ROOT/"owner.html").read_bytes(),True)
            if self.path=="/onboarding/":return self.reply(200,(ROOT/"signin.html").read_bytes(),True)
            return self.reply(401,{"error":"Sign in required."})
        if self.path in ("/onboarding/owner","/onboarding/admin") and who!="owner":return self.reply(200,(ROOT/"owner.html").read_bytes(),True)
        if self.path in ("/onboarding/","/onboarding/owner","/onboarding/admin"):return self.reply(200,(ROOT/"wizard.html").read_bytes(),True)
        if self.path=="/onboarding/team":
            if who!="owner":return self.reply(200,{"owner":False})
            with connect() as db:team=db.execute("SELECT email,id,active,password IS NOT NULL AS joined FROM public.client_engineers ORDER BY email").fetchall()
            return self.reply(200,{"owner":True,"team":team})
        with connect() as db:
            rows=db.execute("SELECT slug,name,rate,domain,verified_domain,bhph,voice,agent_state,engineer,clerk_org_id FROM public.client_sites "+("" if who=="owner" else "WHERE engineer=%s ")+"ORDER BY created_at DESC",() if who=="owner" else (who,)).fetchall()
        self.reply(200,rows)
    def do_POST(self):
        if self.path.partition("?")[0]==platform_mail_routes.UNSUB:
            return platform_mail_routes.leave(self,connect)
        who=self.identity()
        if self.headers.get("Origin")!=ORIGIN or self.headers.get_content_type()!="application/json":return self.reply(403,{})
        try:
            size=int(self.headers.get("Content-Length",0))
            if not 0<size<8000:raise ValueError("Invalid request.")
            data=json.loads(self.rfile.read(size))
            if self.path.startswith(platform_mail.PATH+"/"):
                return platform_mail_routes.post(self,connect,data,who)
            if self.path.startswith("/onboarding/email/"):
                return resend_routes.post(self,connect,self.path[len("/onboarding/email/"):],data)
            if self.path=="/onboarding/clerk-exchange":
                from clerk_auth import verified_identity
                try:subject,email=verified_identity(data["token"])
                except (OSError,HTTPError):
                    return self.reply(503,{"error":"The identity provider is temporarily unavailable. Please try again."})
                except Exception as error:
                    print("Staff sign-in verification:",type(error).__name__,flush=True)
                    return self.reply(403,{"error":"We could not verify this session. Try again or sign in with your verified work email."})
                token=secrets.token_urlsafe(32)
                with connect() as db:
                    sales_admin=email=="sales@autodealership.si" and db.execute("SELECT 1 FROM public.staff_clerk_links WHERE principal=%s AND subject=%s",("owner:"+email,subject)).fetchone()
                    if data.get("role")=="owner" or (data.get("role")=="platform" and (sales_admin or email=="benji@benjaminboyce.com")):
                        if not sales_admin:
                            row=db.execute("SELECT subject FROM public.staff_clerk_links WHERE principal='owner'").fetchone()
                            if not row:
                                if email!="benji@benjaminboyce.com":return self.reply(403,{"error":"Owner access required."})
                                db.execute("INSERT INTO public.staff_clerk_links VALUES ('owner',%s)",(subject,))
                            elif row["subject"]!=subject:return self.reply(403,{"error":"Owner access required."})
                        db.execute("INSERT INTO public.owner_sessions VALUES(%s,now()+interval '1 hour')",(digest(token),))
                    else:
                        eng=db.execute("SELECT id FROM public.client_engineers WHERE email=%s AND active FOR UPDATE",(email,)).fetchone()
                        if not eng:return self.reply(403,{"error":"No active engineer assignment for this account."})
                        principal=str(eng["id"])
                        db.execute("INSERT INTO public.staff_clerk_links VALUES (%s,%s) ON CONFLICT(principal) DO NOTHING",(principal,subject))
                        if not db.execute("SELECT 1 FROM public.staff_clerk_links WHERE principal=%s AND subject=%s",(principal,subject)).fetchone():return self.reply(403,{"error":"Engineer identity has changed."})
                        db.execute("INSERT INTO public.engineer_sessions VALUES(%s,%s,now()+interval '1 hour')",(digest(token),eng["id"]))
                self.session_cookie="onboarding_session="+token+"; Path=/onboarding/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600"
                return self.reply(200,{})
            if self.path=="/onboarding/owner-signin":
                if data.get("username")!="owner" or not hmac.compare_digest(str(data.get("password","")).encode(),os.environ["CLIENT_OWNER_PASSWORD"].encode()):return self.reply(403,{"error":"Check your owner username and password."})
                token=secrets.token_urlsafe(32)
                with connect() as db:db.execute("INSERT INTO public.owner_sessions VALUES(%s,now()+interval '8 hours')",(digest(token),))
                self.session_cookie="onboarding_session="+token+"; Path=/onboarding/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800"
                return self.reply(200,{})
            if self.path=="/onboarding/logout":
                c=SimpleCookie();c.load(self.headers.get("Cookie",""))
                if "onboarding_session" in c:
                    with connect() as db:
                        for table in ("engineer_sessions","owner_sessions"):db.execute("DELETE FROM public."+table+" WHERE token=%s",(digest(c["onboarding_session"].value),))
                self.session_cookie="onboarding_session=; Path=/onboarding/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"
                return self.reply(200,{})
            if self.path in ["/onboarding/claim","/onboarding/signin"]:
                pw=data["password"]
                if not isinstance(pw,str) or not 14<=len(pw)<=128:raise ValueError("Use a password between 14 and 128 characters.")
                with connect() as db:
                    if self.path.endswith("/claim"):
                        salt=secrets.token_hex(16)
                        row=db.execute("UPDATE public.client_engineers SET password=%s,invite_hash=NULL,invite_expires=NULL WHERE active AND invite_hash=%s AND invite_expires>now() RETURNING id",(salt+":"+encoded_password(pw,salt),digest(data["invite"]))).fetchone()
                    else:
                        row=db.execute("SELECT id,password FROM public.client_engineers WHERE email=%s AND active AND password IS NOT NULL AND (failures<8 OR last_failure<now()-interval '15 minutes') FOR UPDATE",(data["email"].strip().lower(),)).fetchone()
                        if row:
                            salt,stored=row["password"].split(":")
                            if not hmac.compare_digest(stored,encoded_password(pw,salt)):
                                db.execute("UPDATE public.client_engineers SET failures=CASE WHEN last_failure<now()-interval '15 minutes' THEN 1 ELSE failures+1 END,last_failure=now() WHERE id=%s",(row["id"],));row=None
                    if not row:return self.reply(403,{"error":"Check your login or ask the owner for a new invitation."})
                    token=secrets.token_urlsafe(32)
                    db.execute("UPDATE public.client_engineers SET failures=0 WHERE id=%s",(row["id"],))
                    db.execute("INSERT INTO public.engineer_sessions VALUES(%s,%s,now()+interval '12 hours')",(digest(token),row["id"]))
                self.session_cookie="onboarding_session="+token+"; Path=/onboarding/; Secure; HttpOnly; SameSite=Strict; Max-Age=43200"
                return self.reply(200,{})
            if not who:return self.reply(401,{"error":"Sign in required."})
            if self.path in ["/onboarding/invite","/onboarding/assign","/onboarding/revoke"]:
                if who!="owner":return self.reply(403,{"error":"Owner access required."})
                with connect() as db:
                    if self.path.endswith("/invite"):
                        email=data["email"].strip().lower()
                        if not re.fullmatch(r"[^ @]+@[^ @]+\.[^ @]+",email) or len(email)>200:raise ValueError("Enter a valid work email.")
                        token=secrets.token_urlsafe(32)
                        row=db.execute("INSERT INTO public.client_engineers(id,email,invite_hash,invite_expires) VALUES(%s,%s,%s,now()+interval '48 hours') ON CONFLICT(email) DO UPDATE SET invite_hash=excluded.invite_hash,invite_expires=excluded.invite_expires WHERE client_engineers.password IS NULL AND client_engineers.active RETURNING id",(uuid.uuid4(),email,digest(token))).fetchone()
                        if not row:raise ValueError("This engineer already has an account.")
                        result={"url":ORIGIN+"/onboarding/#invite="+token}
                    elif self.path.endswith("/assign"):
                        engineer=data["engineer"] or None
                        if engineer and not db.execute("SELECT 1 FROM public.client_engineers WHERE id=%s AND active",(engineer,)).fetchone():raise ValueError("Choose an active engineer.")
                        if not db.execute("UPDATE public.client_sites SET engineer=%s WHERE slug=%s RETURNING id",(engineer,data["slug"])).fetchone():raise ValueError("Client no longer exists.")
                        db.execute("DELETE FROM public.client_desk_sessions WHERE slug=%s AND engineer IS NOT NULL AND engineer IS DISTINCT FROM %s",(data["slug"],engineer))
                        result={}
                    else:
                        db.execute("UPDATE public.client_engineers SET active=false,invite_hash=NULL WHERE id=%s",(data["engineer"],));result={}
                return self.reply(200,result)
            if self.path!="/onboarding/sites" and who!="owner":
                with connect() as db:
                    if not db.execute("SELECT 1 FROM public.client_sites WHERE slug=%s AND engineer=%s",(data.get("slug"),who)).fetchone():return self.reply(403,{"error":"This client is not assigned to you."})
            if self.path=="/onboarding/dealer-invite":
                if who!="owner":return self.reply(403,{})
                email=str(data.get("email","")).strip().lower()
                if not re.fullmatch(r"[^ @]+@[^ @]+\.[^ @]+",email) or len(email)>254:raise ValueError("Enter a valid dealer email.")
                with connect() as db:
                    site=db.execute("SELECT clerk_org_id FROM public.client_sites WHERE slug=%s",(data["slug"],)).fetchone()
                if not site or not site["clerk_org_id"]:raise ValueError("Connect a Clerk organization to this client first.")
                path="/organizations/"+site["clerk_org_id"]+"/invitations"
                from clerk_auth import provider
                offset=0
                while True:
                    page=provider(path.lstrip("/")+"?status=pending&limit=100&offset="+str(offset))["data"]
                    for invitation in page:
                        if invitation["email_address"].lower()==email and invitation["role"]=="org:admin" and invitation["status"]=="pending" and invitation.get("url") and invitation.get("expires_at",0)>__import__("time").time()*1000:return self.reply(200,{"url":invitation["url"]})
                    if len(page)<100:break
                    offset+=100
                request=Request("https://api.clerk.com/v1"+path,data=json.dumps({"email_address":email,"role":"org:admin","notify":False}).encode(),headers={"Authorization":"Bearer "+os.environ["CLERK_SECRET_KEY"],"User-Agent":"AutoDealership/1","Content-Type":"application/json"})
                try:
                    with urlopen(request,timeout=10) as response:invitation=json.load(response)
                except HTTPError:return self.reply(409,{"error":"Clerk could not create the invitation. Check whether this email is already a dealership member."})
                return self.reply(200,{"url":invitation["url"]})
            if self.path=="/onboarding/open-desk":
                slug=data["slug"];token=secrets.token_urlsafe(32)
                with connect() as db:
                    if not db.execute("SELECT 1 FROM public.client_sites WHERE slug=%s",(slug,)).fetchone():return self.reply(404,{})
                    db.execute("DELETE FROM public.client_desk_sessions WHERE expires<=now()")
                    db.execute("INSERT INTO public.client_desk_sessions VALUES(%s,%s,%s,now()+interval '90 seconds')",(digest("handoff:"+token),slug,None if who=="owner" else who))
                return self.reply(200,{"url":"https://"+slug+".autodealership.si/dealer-connect#"+token})
            if self.path=="/onboarding/sites":result=create(data,None if who=="owner" else who)
            elif self.path=="/onboarding/domain":
                host=data["domain"].strip().lower()
                if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}",host) or host.endswith(".autodealership.si") or host=="autodealership.si":raise ValueError("Enter a valid custom domain.")
                with connect() as db:
                    db.execute("UPDATE public.client_sites SET domain=%s WHERE slug=%s",(host,data["slug"]))
                result={"saved":True}
            elif self.path=="/onboarding/voice":result=provision_agent(data["slug"])
            else:return self.reply(404,{})
            self.reply(200,result)
        except psycopg.errors.UniqueViolation:self.reply(409,{"error":"That subdomain is already reserved."})
        except (ValueError,TypeError,KeyError) as err:self.reply(400,{"error":str(err)})
        except Exception:self.reply(500,{"error":"Could not complete this change."})
threading.Thread(target=dealer_mail.work,args=(connect,),daemon=True).start()
ThreadingHTTPServer(("127.0.0.1",18485),Handler).serve_forever()

