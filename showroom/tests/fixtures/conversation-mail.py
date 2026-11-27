"""Run against the isolated conversations-http fixture using an in-memory Resend transport."""
import datetime as dt
import os
import uuid
import psycopg
from psycopg.rows import dict_row
import dealer_mail as mail

site = "10000000-0000-0000-0000-000000000001"
domain = "mail.qa.test"
def connect():
    return psycopg.connect(os.environ["CLIENT_DATABASE_URL"], row_factory=dict_row)

with connect() as db:
    box = db.execute("SELECT * FROM public.dealer_mailboxes WHERE site=%s AND domain=%s",(site,domain)).fetchone()
assert box, "Run the isolated HTTP fixture first"
with mail.store(connect,site) as db:
    op = db.execute("SELECT id FROM sales_opportunities WHERE email='patty@example.test'").fetchone()["id"]

stamp = dt.datetime.now(dt.timezone.utc).isoformat()
def message(sender, mailbox, body):
    return {"id":str(uuid.uuid4()),"from":sender,"to":[mailbox],"subject":"Re: Visit","text":body,"created_at":stamp}
reply = "r-"+op.hex+"@"+domain
rows = [message("patty@example.test",reply,"Please hold the blue car."),
        message("different@example.test",reply,"I was forwarded this."),
        message("patty@example.test","team@"+domain,"Private mail.")]
accepted = []
def provider(path, **args):
    assert args["bearer"]=="fixture-token"
    if path=="/emails":
        assert args["data"]["reply_to"]==reply and args["data"]["to"]==["patty@example.test"]
        assert args["idempotency"].startswith("conversation/")
        accepted.append(args["idempotency"])
        return {"id":"a0000000-0000-0000-0000-000000000001"}
    if path.startswith("/emails/receiving?"):
        return {"data":rows[1:] if "after=" in path else rows[:1],"has_more":"after=" not in path}
    return next(r for r in rows if path.endswith("/"+r["id"]))

mail.sync(connect,box,"fixture-token",provider)
mail.sync(connect,box,"fixture-token",provider)
assert len(accepted)==1
with mail.store(connect,site) as db:
    history=db.execute("SELECT body,state FROM sales_email_messages WHERE opportunity=%s",(op,)).fetchall()
    assert {r["body"]:r["state"] for r in history}=={"We can show you both cars.":"accepted","Please hold the blue car.":"received"}
    assert db.execute("SELECT count(*) AS n FROM sales_email_messages WHERE body='I was forwarded this.' AND opportunity<>%s",(op,)).fetchone()["n"]==1
    assert db.execute("SELECT count(*) AS n FROM sales_email_messages WHERE body='Private mail.'").fetchone()["n"]==0
print("Verified dealer-scoped reply routing, outgoing acceptance, unrelated recipients, pagination and duplicate suppression.")
