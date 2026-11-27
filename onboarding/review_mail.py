"""Deliver purchase feedback invitations through each dealership's verified Resend grant."""
import logging
import time
import uuid

import dealer_mail
import resend_connect as provider


def envelope(row):
    page = row["origin"] + "/purchase-feedback.html#token=" + str(row["token"])
    text = (f"Thank you for purchasing a vehicle from {row['dealer']}. We'd welcome your honest feedback.\n\n"
            f"Leave a public Google review: {row['google_link']}\n"
            f"Send private feedback to the dealership: {page}\n\n"
            f"Unsubscribe from review emails: {page}&unsubscribe=1")
    return {"from": "sales@" + row["domain"], "to": [row["address"]],
            "subject": "How was your purchase at " + row["dealer"] + "?", "text": text}


def pending(db):
    return db.execute("SELECT to_regclass('purchase_review_emails') AS t").fetchone()["t"] and db.execute(
        "SELECT 1 FROM purchase_review_emails WHERE state='scheduled' AND due_at<=now() LIMIT 1").fetchone()


def dispatch(db, grant, token, call=provider.call):
    if not pending(db):
        return
    settings = db.execute("SELECT automatic,link FROM dealer_review_settings WHERE id=1 FOR SHARE").fetchone()
    rows = db.execute("""SELECT * FROM purchase_review_emails WHERE state='scheduled' AND due_at<=now()
        ORDER BY due_at,id LIMIT 10 FOR UPDATE SKIP LOCKED""").fetchall()
    for row in rows:
        state = "canceled"
        receipt = None
        suppressed = db.execute("SELECT 1 FROM purchase_review_optouts WHERE address=%s", (row["address"],)).fetchone()
        if settings and settings["automatic"] and settings["link"] == row["google_link"] and not suppressed and (
                row["domain"], row["domain_id"]) == (grant["domain"], grant["domain_id"]):
            # Even after an uncertain network response, retries within this window use exactly the same envelope.
            expired = db.execute("SELECT now()>%s::timestamptz + interval '23 hours' AS expired", (row["due_at"],)).fetchone()["expired"]
            if expired:
                state = "uncertain"
            else:
                try:
                    result = call("/emails", bearer=token, idempotency="purchase-review/"+str(row["id"]), data=envelope(row))
                    receipt, state = str(uuid.UUID(result["id"])), "accepted"
                except provider.Problem as exc:
                    if exc.status != 422:
                        raise
                    state = "failed"
        db.execute("UPDATE purchase_review_emails SET state=%s,provider_id=%s WHERE id=%s", (state, receipt, row["id"]))


def work(connect):
    while True:
        try:
            with connect() as control:
                grants=control.execute("SELECT site,domain,domain_id FROM public.dealer_email_grants WHERE verified AND NOT reconnect AND domain_id IS NOT NULL").fetchall()
            for grant in grants:
                try:
                    with dealer_mail.store(connect,grant["site"],require_mailbox=False) as db:
                        if not pending(db):
                            continue
                    token=provider.access(connect,grant["site"])
                    with dealer_mail.store(connect,grant["site"],require_mailbox=False,domain_id=grant["domain_id"]) as db:
                        dispatch(db,grant,token)
                except Exception:
                    logging.warning("Purchase review queue pending for %s",grant["site"])
        except Exception:
            logging.exception("Purchase review worker unavailable")
        time.sleep(30)
