"""Owner-operated AutoDealership.SI sales email. All mail is explicitly previewed and sent."""
import base64
import hashlib
import json
import os
import re
import secrets
import time
from urllib.parse import urlencode
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb
from resend_connect import BASE, Problem, call, cipher, digest, seal

PREFIX = "PLATFORM_RESEND_"
PATH = "/onboarding/sales-email"
URL = "https://autodealership.si" + PATH
CALLBACK = URL + "/callback"
KINDS = {"demo":"Demo invitation", "followup":"Personal follow-up", "education":"Educational email"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS public.platform_mail_settings (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), sender text NOT NULL DEFAULT 'sales@autodealership.si',
    address text NOT NULL DEFAULT '', credentials text, connection uuid, reconnect boolean NOT NULL DEFAULT false);
INSERT INTO public.platform_mail_settings(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.platform_mail_states (
    session text PRIMARY KEY, state text NOT NULL UNIQUE, verifier text NOT NULL, expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.platform_mail_contacts (
    email text PRIMARY KEY, opt_token text NOT NULL UNIQUE, unsubscribed timestamptz);
CREATE TABLE IF NOT EXISTS public.platform_mail_messages (
    id uuid PRIMARY KEY, email text NOT NULL REFERENCES public.platform_mail_contacts(email), kind text NOT NULL,
    permission_note text NOT NULL, payload jsonb NOT NULL, connection uuid NOT NULL,
    first_attempt timestamptz, accepted timestamptz, provider_id text UNIQUE, created timestamptz NOT NULL DEFAULT now());
"""


def config(db, lock=False):
    return db.execute("SELECT * FROM public.platform_mail_settings WHERE singleton" + (" FOR UPDATE" if lock else "")).fetchone()


def status(db):
    row = config(db)
    history = db.execute("""SELECT id,email,kind,payload->>'subject' AS subject,accepted,
        first_attempt,created FROM public.platform_mail_messages ORDER BY created DESC LIMIT 25""").fetchall()
    return {"sender":row["sender"],"address":row["address"],"connected":bool(row["connection"]),
            "reconnect":row["reconnect"],"history":history}


def mailbox(value):
    if not isinstance(value,str):
        raise Problem(422,"Enter a single email address.")
    value=value.strip().lower()
    if (len(value)>254 or not re.fullmatch(r"[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",value)):
        raise Problem(422,"Enter a single valid email address.")
    return value


def save(db, data):
    sender=mailbox(data.get("sender"))
    if not sender.endswith("@autodealership.si"):
        raise Problem(422,"Choose a sender at autodealership.si.")
    address=str(data.get("address") or "").strip()
    if not 5<=len(address)<=280 or any(ord(c)<32 for c in address):
        raise Problem(422,"Enter your business mailing address on one line for the email footer.")
    db.execute("UPDATE public.platform_mail_settings SET sender=%s,address=%s WHERE singleton",(sender,address))
    return status(db)


def begin(db, session):
    row=config(db,True)
    if row["connection"] and not row["reconnect"]:
        raise Problem(409,"Disconnect the current platform team first.")
    verifier=secrets.token_urlsafe(64)
    state=secrets.token_urlsafe(32)
    db.execute("DELETE FROM public.platform_mail_states WHERE expires<now() OR session=%s",(digest(session),))
    db.execute("INSERT INTO public.platform_mail_states VALUES (%s,%s,%s,now()+interval '10 minutes')",
               (digest(session),digest(state),verifier))
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return {"url":BASE+"/oauth/authorize?"+urlencode({"client_id":os.environ[PREFIX+"CLIENT_ID"],
            "redirect_uri":CALLBACK,"response_type":"code","scope":"emails:send","state":state,
            "code_challenge":challenge,"code_challenge_method":"S256"})}


def authorize(db, session, data):
    config(db,True)
    row=db.execute("""DELETE FROM public.platform_mail_states WHERE session=%s AND state=%s AND expires>now()
                      RETURNING verifier""",(digest(session),digest(data.get("state","")))).fetchone()
    if not row:
        raise Problem(403,"Approval expired or was opened in another session. Start again from Platform Admin.")
    if data.get("error") or not data.get("code"):
        return {"canceled":True}
    tokens=call("/oauth/token",{"grant_type":"authorization_code","redirect_uri":CALLBACK,
               "code_verifier":row["verifier"],"code":data["code"]},prefix=PREFIX)
    db.execute("UPDATE public.platform_mail_settings SET credentials=%s,connection=%s,reconnect=false WHERE singleton",
               (seal(tokens,"emails:send",PREFIX),uuid4()))
    db.execute("DELETE FROM public.platform_mail_states")
    return {"connected":True}


def disconnect(db):
    row=config(db,True)
    if row["credentials"]:
        creds=json.loads(cipher(PREFIX).decrypt(row["credentials"].encode()))
        try:
            call("/oauth/revoke",{"token":creds["refresh"],"token_type_hint":"refresh_token"},prefix=PREFIX)
        except Problem as err:
            if err.status!=401:
                raise
    db.execute("DELETE FROM public.platform_mail_states")
    db.execute("UPDATE public.platform_mail_settings SET credentials=NULL,connection=NULL,reconnect=false WHERE singleton")
    return status(db)


def access(connect):
    with connect() as db:
        row=config(db,True)
        if not row["credentials"] or row["reconnect"]:
            raise Problem(409,"Connect the platform’s Resend team to send email.")
        creds=json.loads(cipher(PREFIX).decrypt(row["credentials"].encode()))
        if creds["expires"]>time.time()+60:
            return row["connection"],creds["access"]
        try:
            tokens=call("/oauth/token",{"grant_type":"refresh_token","refresh_token":creds["refresh"]},prefix=PREFIX)
        except Problem as err:
            if err.status==401:
                db.execute("UPDATE public.platform_mail_settings SET reconnect=true WHERE singleton")
                db.commit()
            raise
        db.execute("UPDATE public.platform_mail_settings SET credentials=%s WHERE singleton",(seal(tokens,"emails:send",PREFIX),))
        return row["connection"],tokens["access_token"]


def stage(db,data):
    row=config(db,True)
    if not row["connection"] or row["reconnect"] or not row["address"]:
        raise Problem(409,"Connect Resend and save your sender and mailing address first.")
    email=mailbox(data.get("email"))
    kind=data.get("kind")
    subject=str(data.get("subject") or "").strip()
    body=str(data.get("body") or "").strip()
    permission=str(data.get("permission") or "").strip()
    if kind not in KINDS or not 1<=len(subject)<=160 or any(ord(c)<32 for c in subject) or not 1<=len(body)<=4000:
        raise Problem(422,"Choose an email type and enter a subject and message.")
    if not 3<=len(permission)<=350:
        raise Problem(422,"Record how this contact requested or agreed to receive this email.")
    db.execute("INSERT INTO public.platform_mail_contacts VALUES (%s,%s,NULL) ON CONFLICT(email) DO NOTHING",
               (email,secrets.token_urlsafe(32)))
    contact=db.execute("SELECT * FROM public.platform_mail_contacts WHERE email=%s FOR UPDATE",(email,)).fetchone()
    if contact["unsubscribed"]:
        raise Problem(409,"This recipient has unsubscribed from platform sales emails.")
    url=URL+"/unsubscribe?t="+contact["opt_token"]
    payload={"from":"AutoDealership.SI <"+row["sender"]+">","to":[email],"subject":subject,
        "text":body+"\n\nAutoDealership.SI\n"+row["address"]+"\nUnsubscribe: "+url,
        "headers":{"List-Unsubscribe":"<"+url+">","List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}}
    ident=uuid4()
    db.execute("""INSERT INTO public.platform_mail_messages(id,email,kind,permission_note,payload,connection)
                  VALUES (%s,%s,%s,%s,%s,%s)""",(ident,email,kind,permission,Jsonb(payload),row["connection"]))
    return preview(db,str(ident))


def identifier(raw):
    try:
        return UUID(str(raw))
    except ValueError:
        raise Problem(422,"Choose an email from your workspace.")


def preview(db, raw):
    row=db.execute("""SELECT id,payload,accepted,first_attempt,provider_id FROM public.platform_mail_messages WHERE id=%s""",
                   (identifier(raw),)).fetchone()
    if not row:
        raise Problem(404,"Email not found.")
    return {"id":row["id"],"sender":row["payload"]["from"],"email":row["payload"]["to"][0],
            "subject":row["payload"]["subject"],"body":row["payload"]["text"],"accepted":row["accepted"],
            "attempted":bool(row["first_attempt"])}


def send(connect, raw):
    ident=identifier(raw)
    with connect() as db:
        msg=db.execute("SELECT id,accepted,provider_id FROM public.platform_mail_messages WHERE id=%s",(ident,)).fetchone()
        if not msg:
            raise Problem(404,"Email not found.")
        if msg["accepted"]:
            return {"accepted":True,"providerId":msg["provider_id"]}
    conn,bearer=access(connect)
    # Persist the start of the provider deduplication window before making any network call.
    with connect() as db:
        db.execute("""UPDATE public.platform_mail_messages SET first_attempt=now()
                      WHERE id=%s AND connection=%s AND first_attempt IS NULL""",(ident,conn))
    with connect() as db:
        cfg=config(db,True)
        msg=db.execute("""SELECT *,first_attempt>now()-interval '23 hours' AS retryable FROM public.platform_mail_messages
                          WHERE id=%s FOR UPDATE""",(ident,)).fetchone()
        if msg["accepted"]:
            return {"accepted":True,"providerId":msg["provider_id"]}
        if cfg["connection"]!=conn or msg["connection"]!=conn or cfg["reconnect"]:
            raise Problem(409,"The platform connection changed. Create a fresh preview.")
        if not msg["retryable"]:
            raise Problem(409,"The retry window has closed. Check the Resend activity log before preparing another email.")
        if db.execute("SELECT unsubscribed FROM public.platform_mail_contacts WHERE email=%s FOR UPDATE",(msg["email"],)).fetchone()["unsubscribed"]:
            raise Problem(409,"This recipient unsubscribed. Sending is disabled.")
        try:
            result=call("/emails",bearer=bearer,data=msg["payload"],idempotency="platform-mail/"+str(ident))
        except Problem as err:
            if err.status==401:
                db.execute("UPDATE public.platform_mail_settings SET reconnect=true WHERE singleton")
                db.commit()
            raise
        if not result.get("id"):
            raise Problem(502,"Acceptance could not be confirmed. Reopen this preview before retrying.")
        db.execute("UPDATE public.platform_mail_messages SET accepted=now(),provider_id=%s WHERE id=%s",
                   (result["id"],ident))
        return {"accepted":True,"providerId":result["id"]}


def unsubscribe(db, token):
    if not isinstance(token,str) or not re.fullmatch(r"[a-zA-Z0-9_-]{43}",token):
        raise Problem(404,"Invalid unsubscribe link.")
    row=db.execute("""UPDATE public.platform_mail_contacts SET unsubscribed=COALESCE(unsubscribed,now())
                      WHERE opt_token=%s RETURNING email""",(token,)).fetchone()
    if not row:
        raise Problem(404,"Invalid unsubscribe link.")
