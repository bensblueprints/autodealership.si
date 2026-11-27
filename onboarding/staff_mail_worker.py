"""Dispatch staff replies and sync only email threads started in Conversations."""
import concurrent.futures
import json
import logging
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import urlencode,quote
from email import message_from_bytes,policy
from email.utils import parseaddr
import base64
import smtplib
import imaplib
from psycopg.types.json import Jsonb
import staff_mail as settings
import staff_mail_transport as transport

def eligible(control,g):
    actor=g["actor"]
    if actor.startswith("account:"):
        return not g["clerk_org_id"] and control.execute("SELECT 1 FROM public.dealer_users WHERE site=%s AND email=%s AND active",(str(g["site"]),actor[8:])).fetchone()
    if actor.startswith("engineer:"):
        return control.execute("SELECT 1 FROM public.client_engineers WHERE id=%s AND id=%s AND active",(g["engineer"],actor[9:])).fetchone()
    if actor.startswith("clerk:"):
        if control.execute("""SELECT 1 FROM public.staff_clerk_links WHERE subject=%s AND
            (principal IN ('owner','owner:sales@autodealership.si') OR principal IN
             (SELECT id::text FROM public.client_engineers WHERE id=%s AND active))""",(actor[6:],g["engineer"])).fetchone():return True
        return control.execute("""SELECT 1 FROM public.dealer_sales_rosters WHERE site=%s AND organization=%s AND
            synced_at>now()-interval '1 hour' AND members @> %s::jsonb""",(str(g["site"]),g["clerk_org_id"],Jsonb([{"id":actor}]))).fetchone()
    return False

def google_access(c):
    if c.get("expires",0)>time.time()+90:return False
    t=settings.google_token({"grant_type":"refresh_token","refresh_token":c["refresh"]})
    c.update(access=t["access_token"],expires=time.time()+int(t["expires_in"]))
    if t.get("refresh_token"):c["refresh"]=t["refresh_token"]
    return True

def dispatch(site,c):
    with settings.tenant_store(site) as db:
        if not db.execute("SELECT to_regclass('staff_mail_messages') AS t").fetchone()["t"]:return
        # This grant's registry lock serializes delivery. A prior committed claim is uncertain after a crash.
        db.execute("""UPDATE sales_email_messages SET state='check sent folder' WHERE state='sending from inbox'
           AND id IN (SELECT message FROM staff_mail_messages WHERE grant_id=%s)""",(site["id"],))
        row=db.execute("""SELECT m.*,l.rfc_id FROM sales_email_messages m JOIN staff_mail_messages l ON l.message=m.id
           WHERE l.grant_id=%s AND m.state='staff queued' ORDER BY m.created_at,m.id LIMIT 1 FOR UPDATE OF m""",(site["id"],)).fetchone()
        if not row:return
        parent=db.execute("""SELECT l.rfc_id,l.thread_id FROM staff_mail_messages l JOIN sales_email_messages m ON m.id=l.message
            WHERE l.grant_id=%s AND m.opportunity=%s AND m.address=%s AND m.subject=%s AND m.state IN ('accepted','received')
            ORDER BY m.created_at DESC LIMIT 1""",(site["id"],row["opportunity"],row["address"],row["subject"])).fetchone() or {}
        db.execute("UPDATE sales_email_messages SET state='sending from inbox' WHERE id=%s",(row["id"],))
    try:
        email=transport.message(row["rfc_id"],c["address"],row["address"],row["subject"],row["body"],parent.get("rfc_id"))
        receipt,thread=transport.send(c,email,parent.get("thread_id"))
    except Exception as error:
        definitive=isinstance(error,(smtplib.SMTPRecipientsRefused,smtplib.SMTPAuthenticationError,smtplib.SMTPSenderRefused,smtplib.SMTPDataError)) or isinstance(error,HTTPError) and 400<=error.code<500
        with settings.tenant_store(site) as db:db.execute("UPDATE sales_email_messages SET state=%s WHERE id=%s",("failed" if definitive else "check sent folder",row["id"]))
        raise
    with settings.tenant_store(site) as db:
        db.execute("UPDATE sales_email_messages SET state='accepted',provider_id=%s WHERE id=%s",("staff:"+str(site["id"])+":"+receipt,row["id"]))
        db.execute("UPDATE staff_mail_messages SET thread_id=%s WHERE message=%s",(thread,row["id"]))
    return True

def lookup(db,grant,sender,refs,thread=None):
    if not sender or not (refs or thread):return
    rows=db.execute("""SELECT DISTINCT m.opportunity FROM staff_mail_messages l JOIN sales_email_messages m ON m.id=l.message
      JOIN sales_opportunities o ON o.id=m.opportunity WHERE l.grant_id=%s AND m.address=%s AND lower(o.email)=%s AND
      (l.rfc_id=ANY(%s::text[]) OR l.thread_id=%s) LIMIT 2""",(grant,sender,sender,refs,thread)).fetchall()
    return rows[0]["opportunity"] if len(rows)==1 else None

def ingest(db,g,op,sender,subject,body,rfc,provider_id,thread):
    mid=uuid.uuid4()
    key="staff:"+str(g["id"])+":"+provider_id
    if db.execute("SELECT 1 FROM staff_mail_messages WHERE grant_id=%s AND rfc_id=%s",(g["id"],rfc or key)).fetchone():return
    if not db.execute("""INSERT INTO sales_email_messages(id,opportunity,provider_id,direction,address,subject,body,state)
      VALUES(%s,%s,%s,'in',%s,%s,%s,'received') ON CONFLICT DO NOTHING RETURNING id""",(mid,op,key,sender,subject,body)).fetchone():return
    db.execute("INSERT INTO staff_mail_messages VALUES(%s,%s,%s,%s,%s,%s)",(mid,g["id"],g["actor"],g["address"],rfc or key,thread))
    db.execute("UPDATE sales_opportunities SET updated_at=now() WHERE id=%s",(op,))

def sync_google(db,g,c,pos):
    token=c["access"]
    known={r["thread_id"] for r in db.execute("SELECT DISTINCT thread_id FROM staff_mail_messages WHERE grant_id=%s AND thread_id IS NOT NULL",(g["id"],))}
    if not known:return {"history":transport.gmail("GET","/profile",token)["historyId"]}
    def check(mid,thread):
        if thread not in known:return
        path="/messages/"+quote(mid,safe="")
        try:
            meta=transport.gmail("GET",path+"?format=metadata&metadataHeaders=From&metadataHeaders=References&metadataHeaders=In-Reply-To",token)
        except HTTPError as e:
            if e.code==404:return
            raise
        if "SENT" in meta.get("labelIds",[]) or "DRAFT" in meta.get("labelIds",[]) or "SPAM" in meta.get("labelIds",[]) or "TRASH" in meta.get("labelIds",[]):return
        headers={h["name"].lower():h["value"] for h in meta["payload"].get("headers",[])}
        sender=parseaddr(headers.get("from",""))[1].lower();op=lookup(db,g["id"],sender,[],thread)
        if not op or db.execute("SELECT 1 FROM sales_email_messages WHERE provider_id=%s",("staff:"+str(g["id"])+":"+mid,)).fetchone():return
        if int(meta.get("sizeEstimate",0))>transport.MAX_MESSAGE:
            ingest(db,g,op,sender,"Customer reply","Open the original message in your mailbox to view this large email.","",mid,thread);return
        raw=transport.gmail("GET",path+"?format=raw",token)["raw"]
        m=message_from_bytes(base64.urlsafe_b64decode(raw+"==="),policy=policy.default)
        ingest(db,g,op,sender,str(m.get("Subject",""))[:300],transport.content(m),str(m.get("Message-ID",""))[:255],mid,thread)
    if "reconcile" in pos:
        scan=sorted(t for t in known if t>pos["reconcile"])
        for thread in scan[:20]:
            try:
                msgs=transport.gmail("GET","/threads/"+quote(thread,safe="")+"?format=minimal",token).get("messages",[])
            except HTTPError as e:
                if e.code==404:continue
                raise
            for m in msgs:check(m["id"],thread)
        return {"history":pos["history"],**({"reconcile":scan[19]} if len(scan)>20 else {})}
    params={"startHistoryId":pos["history"],"historyTypes":"messageAdded","maxResults":50}
    if pos.get("page"):params["pageToken"]=pos["page"]
    try:changes=transport.gmail("GET","/history?"+urlencode(params),token)
    except HTTPError as e:
        if e.code!=404:raise
        return {"history":transport.gmail("GET","/profile",token)["historyId"],"reconcile":""}
    for change in changes.get("history",[]):
        for item in change.get("messagesAdded",[]):
            m=item["message"];check(m["id"],m["threadId"])
    return {"history":pos["history"],"page":changes["nextPageToken"]} if changes.get("nextPageToken") else {"history":changes["historyId"]}

def process(connect,gid):
    with connect() as control:
        g=control.execute("""SELECT g.*,t.database_name,t.clerk_org_id,t.engineer FROM public.staff_mail_grants g
          JOIN public.client_sites t ON t.id=g.site WHERE g.id=%s AND NOT g.paused
          FOR SHARE OF t FOR UPDATE OF g SKIP LOCKED""",(gid,)).fetchone()
        if not g:return
        if not eligible(control,g):
            control.execute("UPDATE public.staff_mail_grants SET issue='Waiting for active dealership membership' WHERE id=%s",(gid,));return
        c=json.loads(settings.cipher().decrypt(g["credentials"].encode()))
        try:
            if c["kind"]=="google" and google_access(c):
                control.execute("UPDATE public.staff_mail_grants SET credentials=%s WHERE id=%s",(settings.encoded(c),gid))
            for _ in range(8):
                if not dispatch(g,c):break
            with settings.tenant_store(g) as db:
                if not db.execute("SELECT to_regclass('staff_mail_messages') AS t").fetchone()["t"]:return
                if c["kind"]=="google":pos=sync_google(db,g,c,g["cursor"])
                else:pos=transport.sync_imap(c,g["cursor"],lambda sender,refs:lookup(db,gid,sender,refs),lambda *args:ingest(db,g,*args))
            control.execute("UPDATE public.staff_mail_grants SET cursor=%s,last_sync=now(),issue='' WHERE id=%s",(Jsonb(pos),gid))
        except Exception as e:
            auth=isinstance(e,smtplib.SMTPAuthenticationError) or isinstance(e,imaplib.IMAP4.error) and 'AUTHENTICATIONFAILED' in str(e).upper() or isinstance(e,HTTPError) and e.code==401 or isinstance(e,HTTPError) and e.code==400 and 'invalid_grant' in e.read(2000).decode(errors="ignore")
            control.execute("UPDATE public.staff_mail_grants SET paused=%s,issue=%s WHERE id=%s",(auth,"Reconnect your mailbox" if auth else "Provider unavailable. Sync will retry.",gid))
            logging.warning("Staff inbox processing issue for %s (%s)",gid,type(e).__name__)

def work(connect):
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        while True:
            try:
                with connect() as db:ids=[r["id"] for r in db.execute("SELECT id FROM public.staff_mail_grants WHERE NOT paused ORDER BY last_sync NULLS FIRST")]
                for future in [pool.submit(process,connect,i) for i in ids]:
                    try:future.result()
                    except Exception as e:logging.warning("Staff mail worker: %s",type(e).__name__)
            except Exception as e:logging.warning("Staff mail registry: %s",type(e).__name__)
            time.sleep(30)
