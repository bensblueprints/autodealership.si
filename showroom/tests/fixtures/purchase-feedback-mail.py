"""Isolated PostgreSQL and a fake Resend transport. Never sends real email."""
import os
import uuid
import psycopg
from psycopg.rows import dict_row
import dealer_mail
import review_mail

def connect():
    return psycopg.connect(os.environ["CLIENT_DATABASE_URL"], row_factory=dict_row)
site="10000000-0000-0000-0000-000000000001"
grant={"domain":"mail.qa.test","domain_id":"domain_qa"}
accepted={}
def send(path,*,bearer,idempotency,data):
    assert path=="/emails" and bearer=="fixture"
    assert data["from"]=="sales@mail.qa.test" and "Leave a public Google review: https://g.page/r/example/review" in data["text"]
    assert "unsubscribe=1" in data["text"] and "https://qa.autodealership.si/purchase-feedback.html#token=" in data["text"]
    assert "16300" not in data["text"] and "5-star" not in data["text"]
    assert idempotency not in accepted
    accepted[idempotency]=data["to"]
    return {"id":str(uuid.uuid4())}
with dealer_mail.store(connect,site,False,"domain_qa") as db:
    review_mail.dispatch(db,grant,"fixture",send)
    assert not accepted
    db.execute("UPDATE purchase_review_emails SET due_at=now()-interval '1 minute' WHERE state='scheduled'")
    review_mail.dispatch(db,grant,"fixture",send)
    review_mail.dispatch(db,grant,"fixture",send)
assert len(accepted)==2
print("Verified delayed, repeat-safe Resend dispatch through the correct dealer grant with a simulated transport.")
