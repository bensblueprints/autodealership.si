import json,os,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
sandbox=tempfile.TemporaryDirectory()
os.environ["BILLING_DATA"]=sandbox.name
import psycopg,uuid
from psycopg.conninfo import make_conninfo
schema="billing_test_"+uuid.uuid4().hex
dsn=os.environ["BILLING_DATABASE_URL"]
with psycopg.connect(dsn) as conn:
    conn.execute("CREATE SCHEMA "+schema)
import atexit
@atexit.register
def cleanup():
    with psycopg.connect(dsn) as conn:
        conn.execute("DROP SCHEMA "+schema+" CASCADE")
os.environ["BILLING_DATABASE_URL"]=make_conninfo(dsn,options="-c search_path="+schema)
import server as app

class Billing(unittest.TestCase):
 def test_usage_and_payments(self):
    app.KEY="fake";app.SECRET="ws_testing";app.MERCHANT="biz_test"
    app.VARIANTS={"starter":"plan_starter","credit_100":"plan_refill"};app.AGENTS={"agent_1":"store"}
    with app.transaction() as db:
      db.execute("INSERT INTO dealers(id,email,name,password,plan,marketing,auto) VALUES('store','qa@example.invalid','Test','unused','starter',0,1)")
      dealer=app.one(db,"SELECT * FROM dealers")
      order=app.start_order(db,dealer,"subscription",798,"plan_starter")
      sub={"type":"payment.succeeded","data":{"id":"pay_sub","account_id":"biz_test","variant_id":"plan_starter","subtotal":{"amount":"798","currency":"usd"},"membership_id":"mem_test","member_id":"mber_test","paid_at":"2026-11-25T00:00:00Z","metadata":{"adsi_order":order["id"]}}}
      app.whop_event(db,sub);app.whop_event(db,sub)
      dealer=app.one(db,"SELECT * FROM dealers");self.assertEqual(dealer["status"],"active")
      card=app.start_order(db,dealer,"card",0,"setup")
      app.whop_event(db,{"type":"setup_intent.succeeded","data":{"id":"set_1","account_id":"biz_test","metadata":{"adsi_order":card["id"]},"member_id":"mber_test","payment_method_id":"payt_test"}})
      call={"agent_id":"agent_1","conversation_id":"call_1","metadata":{"call_duration_secs":8760,"start_time_unix_secs":dealer["cycle"]+300}}
      app.meter(db,call);app.meter(db,call)
      refill=app.one(db,"SELECT * FROM orders WHERE kind='auto'")
      self.assertEqual(refill["amount"],100)
      refill_event={"type":"payment.succeeded","data":{"id":"pay_refill","account_id":"biz_test","member_id":"mber_test","variant_id":"plan_refill","subtotal":{"amount":"100.00","currency":"usd"},"metadata":{"adsi_order":refill["id"]}}}
      app.whop_event(db,refill_event);app.whop_event(db,refill_event)
      app.meter(db,{**call,"conversation_id":"call_2","metadata":{"call_duration_secs":300,"start_time_unix_secs":dealer["cycle"]+9300}})
      self.assertEqual(app.one(db,"SELECT balance FROM dealers")["balance"],100*6000-60*35)
      self.assertEqual(app.one(db,"SELECT COUNT(*) FROM payments")["count"],2)
      db.execute("UPDATE dealers SET balance=0,cap=100")
      app.queue_refill(db,app.one(db,"SELECT * FROM dealers"))
      self.assertEqual(app.one(db,"SELECT COUNT(*) FROM orders WHERE kind='auto'")["count"],1)
      self.assertEqual(app.billed(60000*60,0),5000*60*35+15000*60*30+40000*60*27)
      from hashlib import sha256
      import base64,hmac,time
      stamp=str(int(time.time()));raw=b'{"ok":true}'
      sig=base64.b64encode(hmac.digest(b"ws_testing",b'id.'+stamp.encode()+b'.'+raw,'sha256')).decode()
      headers={"webhook-id":"id","webhook-timestamp":stamp,"webhook-signature":"v1,"+sig}
      self.assertTrue(app.verify_whop(headers,raw));self.assertFalse(app.verify_whop(headers,b'changed'))

if __name__=="__main__":unittest.main()
