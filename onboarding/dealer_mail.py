"""Handle dealership replies using that rooftop's Resend OAuth grant."""
import datetime as dt
from contextlib import contextmanager
from email.utils import parseaddr
from html.parser import HTMLParser
import logging
import os
import re
import time
import uuid
from urllib.parse import quote
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
import resend_connect as provider
from tenant_database import TABLES

MAILBOX_SCHEMA = """CREATE TABLE IF NOT EXISTS public.dealer_mailboxes(
  site uuid PRIMARY KEY REFERENCES public.dealer_email_grants(site) ON DELETE CASCADE,
  domain text NOT NULL,domain_id text NOT NULL,enabled_at timestamptz NOT NULL DEFAULT now(),last_id text)"""

def enable(db, site, token):
    row = provider.grant(db, site)
    if row["reconnect"] or not row["domain_id"] or not row["verified"]:
        raise provider.Problem(409, "Verify the dealership's dedicated sending domain first.")
    domain = provider.call("/domains/"+quote(row["domain_id"],safe=""),bearer=token)
    if domain.get("name") != row["domain"] or domain.get("status") != "verified" or domain.get("capabilities",{}).get("receiving") != "enabled":
        raise provider.Problem(409, "Enable receiving in Resend on this dedicated subdomain, publish its incoming MX record and verify the domain.")
    inbound = [r for r in domain.get("records",[]) if r.get("type")=="MX" and str(r.get("record","")).lower() in ("receiving","mx")]
    if not any(r.get("status")=="verified" for r in inbound):
        raise provider.Problem(409, "The receiving MX record is awaiting verification in Resend.")
    db.execute("INSERT INTO public.dealer_mailboxes(site,domain,domain_id) VALUES(%s,%s,%s) ON CONFLICT(site) DO NOTHING",(site,row["domain"],row["domain_id"]))

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.hidden=0
    def handle_starttag(self, tag, attrs):
        if tag in ("script","style"): self.hidden+=1
        if tag in ("br","div","p","li"): self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script","style") and self.hidden: self.hidden-=1
    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)

def address(value):
    addr=parseaddr(str(value or ""))[1].strip().lower()
    return addr if len(addr)<=254 and re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+",addr) else ""

@contextmanager
def store(connect, site, require_mailbox=True, domain_id=None):
    with connect() as control:
        if require_mailbox:
            row=control.execute("""SELECT t.database_name FROM public.client_sites t JOIN public.dealer_mailboxes m ON m.site=t.id
              JOIN public.dealer_email_grants g ON g.site=t.id AND g.domain_id=m.domain_id AND g.domain=m.domain
              WHERE t.id=%s AND g.verified AND NOT g.reconnect FOR SHARE OF t,m,g""",(site,)).fetchone()
        else:
            row=control.execute("""SELECT t.database_name FROM public.client_sites t JOIN public.dealer_email_grants g ON g.site=t.id
              WHERE t.id=%s AND g.verified AND NOT g.reconnect AND (%s::text IS NULL OR g.domain_id=%s) FOR SHARE OF t,g""",(site,domain_id,domain_id)).fetchone()
        if not row: raise provider.Problem(409,"Dealer mailbox disconnected.")
        schema="client_"+uuid.UUID(str(site)).hex
        if row["database_name"] and row["database_name"] != schema: raise ValueError("Invalid database route.")
        with psycopg.connect(os.environ["CLIENT_DATABASE_URL"],**({"dbname":schema} if row["database_name"] else {}),row_factory=dict_row) as db:
            if not row["database_name"]: db.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
            if require_mailbox and not db.execute("SELECT to_regclass('sales_email_messages') AS t").fetchone()["t"]:
                db.execute("SELECT pg_advisory_xact_lock(81454,2)")
                for table in ("sales_opportunities","sales_email_messages"):
                    db.execute(sql.SQL("CREATE TABLE IF NOT EXISTS {} ({})").format(sql.Identifier(table),sql.SQL(TABLES[table])))
                db.execute("CREATE INDEX IF NOT EXISTS sales_email_thread ON sales_email_messages(opportunity,created_at DESC)")
            yield db

def receive(db, mail, domain):
    sender=address(mail.get("from")); targets={address(s) for s in mail.get("to",[])}
    if not sender or sender.endswith("@"+domain): return
    direct="sales@"+domain in targets
    replies=[m.group(1) for t in targets if (m:=re.fullmatch(r"r-([a-f0-9]{32})@"+re.escape(domain),t))]
    if not direct and not replies: return
    pid=str(uuid.UUID(mail["id"]))
    if db.execute("SELECT 1 FROM sales_email_messages WHERE provider_id=%s",("in:"+pid,)).fetchone():return
    # A reply address also has to match the shopper. Forwarded messages get their own thread.
    op=None
    if len(replies)==1:
        op=db.execute("SELECT id FROM sales_opportunities WHERE id=%s AND email=%s",(uuid.UUID(replies[0]),sender)).fetchone()
    if not op:
        matches=db.execute("SELECT id FROM sales_opportunities WHERE email=%s LIMIT 2",(sender,)).fetchall()
        if len(matches)==1: op=matches[0]
    if not op:
        op=db.execute("""INSERT INTO sales_opportunities(id,thread_key,name,email) VALUES(%s,%s,%s,%s)
          ON CONFLICT(thread_key) DO UPDATE SET updated_at=now() RETURNING id""",(uuid.uuid4(),"email:"+sender,sender,sender)).fetchone()
    body=mail.get("text") or ""
    if not body and mail.get("html"):
        text=Text();text.feed(mail["html"]);body="".join(text.parts).strip()
    db.execute("""INSERT INTO sales_email_messages(id,opportunity,provider_id,direction,address,subject,body,state,created_at)
      VALUES(%s,%s,%s,'in',%s,%s,%s,'received',%s) ON CONFLICT(provider_id) DO NOTHING""",(uuid.uuid4(),op["id"],"in:"+pid,sender,(mail.get("subject") or "")[:300],body[:50000],mail["created_at"]))
    db.execute("UPDATE sales_opportunities SET updated_at=greatest(updated_at,%s) WHERE id=%s",(mail["created_at"],op["id"]))

def sync(connect, mailbox, token, call=provider.call):
    site,domain=mailbox["site"],mailbox["domain"]
    with store(connect,site) as db:
        db.execute("UPDATE sales_email_messages SET state='canceled' WHERE direction='out' AND state='queued' AND created_at<%s",(mailbox["enabled_at"],))
        # Retry a lost provider response only within Resend's idempotency window.
        db.execute("UPDATE sales_email_messages SET state='needs review' WHERE direction='out' AND state='queued' AND created_at < now()-interval '23 hours'")
        pending=db.execute("SELECT * FROM sales_email_messages WHERE direction='out' AND state='queued' ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED").fetchall()
        for m in pending:
            try:
                result=call("/emails",bearer=token,idempotency="conversation/"+str(m["id"]),data={"from":"sales@"+domain,"to":[m["address"]],"subject":m["subject"],"text":m["body"],"reply_to":"r-"+m["opportunity"].hex+"@"+domain})
                db.execute("UPDATE sales_email_messages SET provider_id=%s,state='accepted' WHERE id=%s",("out:"+str(uuid.UUID(result["id"])),m["id"]))
            except provider.Problem as exc:
                if exc.status==422: db.execute("UPDATE sales_email_messages SET state='failed' WHERE id=%s",(m["id"],))
                else: break
    cursor="";newest=None
    while True:
        page=call("/emails/receiving?limit=100"+cursor,bearer=token);rows=page.get("data",[])
        if not rows:break
        newest=newest or rows[0]["id"]
        finished=False
        for row in rows:
            when=dt.datetime.fromisoformat(row["created_at"].replace("Z","+00:00"))
            if row["id"]==mailbox["last_id"] or when<mailbox["enabled_at"]:finished=True;break
            targets=[address(s) for s in row.get("to",[])]
            if not any(t=="sales@"+domain or re.fullmatch(r"r-[a-f0-9]{32}@"+re.escape(domain),t) for t in targets):continue
            mail=call("/emails/receiving/"+str(uuid.UUID(row["id"])),bearer=token)
            with store(connect,site) as db: receive(db,mail,domain)
        if finished or not page.get("has_more"):break
        cursor="&after="+quote(rows[-1]["id"],safe="")
    if newest:
        with connect() as db: db.execute("UPDATE public.dealer_mailboxes SET last_id=%s WHERE site=%s AND domain_id=%s AND enabled_at=%s",(newest,site,mailbox["domain_id"],mailbox["enabled_at"]))

def work(connect):
    while True:
        try:
            with connect() as db: rows=db.execute("SELECT m.* FROM public.dealer_mailboxes m JOIN public.dealer_email_grants g USING(site) WHERE m.domain_id=g.domain_id AND m.domain=g.domain AND g.verified AND NOT g.reconnect").fetchall()
            for row in rows:
                try: sync(connect,row,provider.access(connect,row["site"]))
                except Exception: logging.warning("Dealer mailbox sync pending for %s",row["site"])
        except Exception: logging.warning("Dealer mailbox worker unavailable")
        time.sleep(30)
