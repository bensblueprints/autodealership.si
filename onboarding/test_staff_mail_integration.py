"""Run in the isolated conversation HTTP fixture with no external mail transport."""
import sys,os,uuid,datetime,base64,json
from unittest.mock import patch
import psycopg
from psycopg.rows import dict_row
import staff_mail as sm
import staff_mail_worker as worker
import staff_mail_transport as mail
from cryptography.fernet import Fernet

def connect():return psycopg.connect(os.environ["CLIENT_DATABASE_URL"],row_factory=dict_row)
site=uuid.UUID("10000000-0000-0000-0000-000000000001")
actor="account:review.writer@example.test"
who={"actor":actor,"site":site,"database_name":None}
def run(step):
    if step=="prepare":
        with connect() as db:
            db.execute(sm.SCHEMA)
            db.execute("ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS engineer uuid, ADD COLUMN IF NOT EXISTS clerk_org_id text")
            sm.save(db,who,{"address":"writer@qa.example","kind":"imap","password":"fixture"},{"validity":1,"last":10})
        return
    with connect() as db:g=db.execute("SELECT * FROM public.staff_mail_grants WHERE actor=%s",(actor,)).fetchone()
    sent=[]
    def send(c,m,thread):
        assert m["From"]=="writer@qa.example" and m["To"]=="patty@example.test"
        sent.append(str(m["Message-ID"]));return "fixture-out",None
    def sync(c,pos,match,receive):
        assert match("unrelated@example.test",sent) is None and match("patty@example.test",["<unrelated>"]) is None
        op=match("patty@example.test",sent);assert op
        for _ in range(2):receive(op,"patty@example.test","Re: A personal response","I'll visit Friday.","<personal-reply>","1:11",None)
        return {"validity":1,"last":11}
    with patch.object(mail,"send",send),patch.object(mail,"sync_imap",sync):
        worker.process(connect,g["id"]);worker.process(connect,g["id"])
    assert len(sent)==1
    with sm.tenant_store(who) as db:
        res=db.execute("SELECT m.state,m.direction FROM sales_email_messages m JOIN staff_mail_messages l ON l.message=m.id WHERE l.grant_id=%s ORDER BY m.direction",(g["id"],)).fetchall()
        assert res==[{"state":"received","direction":"in"},{"state":"accepted","direction":"out"}],res
    with connect() as db:
        sm.disconnect(db,who)
        assert not db.execute("SELECT 1 FROM public.staff_mail_grants WHERE actor=%s",(actor,)).fetchone()
    print("Verified PostgreSQL sender dispatch, matched replies, duplicate suppression, disconnect and preserved history.")
if __name__=="__main__":run(sys.argv[1])
