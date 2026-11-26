import os
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import psycopg
from cryptography.fernet import Fernet
from psycopg.rows import dict_row
import platform_mail as mail
from resend_connect import Problem


@unittest.skipUnless(os.environ.get("RESEND_TEST_DATABASE_URL"),"requires an isolated PostgreSQL database")
class PlatformMailTest(unittest.TestCase):
    def db(self):
        return psycopg.connect(os.environ["RESEND_TEST_DATABASE_URL"],row_factory=dict_row)

    def setUp(self):
        with self.db() as db:
            self.assertIsNone(db.execute("SELECT to_regclass('public.platform_mail_settings') AS existing").fetchone()["existing"])
            db.execute(mail.SCHEMA)
        self.addCleanup(self.cleanup)
        env=patch.dict(os.environ,PLATFORM_RESEND_CLIENT_ID="platform-client",PLATFORM_RESEND_TOKEN_KEY=Fernet.generate_key().decode())
        env.start();self.addCleanup(env.stop)
        self.out=[]
        self.fail_once=False
        mock=patch.object(mail,"call",side_effect=self.provider)
        self.calls=mock.start();self.addCleanup(mock.stop)
        self.data={"email":"Buyer@example.com","kind":"education","subject":"Vehicle inquiries","body":"Thank you.",
                   "permission":"Requested the guide at the dealership demo."}

    def cleanup(self):
        with self.db() as db:
            db.execute("DROP TABLE public.platform_mail_messages,public.platform_mail_contacts,public.platform_mail_states,public.platform_mail_settings")

    def provider(self,path,form=None,**kw):
        if path=="/oauth/token":
            self.assertEqual(kw["prefix"],mail.PREFIX)
            return {"token_type":"Bearer","scope":"emails:send","access_token":"mail-only","refresh_token":"rotating",
                    "expires_in":5 if form["grant_type"]=="authorization_code" else 900}
        if path=="/emails":
            self.assertEqual(kw["bearer"],"mail-only")
            self.out.append((kw["idempotency"],kw["data"]))
            if self.fail_once:
                self.fail_once=False
                raise Problem(503,"unconfirmed")
            return {"id":"provider-"+kw["idempotency"].split("/")[-1]}
        if path=="/oauth/revoke":
            self.assertEqual(kw["prefix"],mail.PREFIX);return {}
        raise AssertionError(path)

    def connect_team(self):
        with self.db() as db:
            q=parse_qs(urlsplit(mail.begin(db,"owner browser")["url"]).query)
            self.assertEqual(q["scope"],["emails:send"])
            self.assertEqual(q["redirect_uri"],[mail.CALLBACK])
            self.assertEqual(q["client_id"],["platform-client"])
            params={"state":q["state"][0],"code":"code"}
            with self.assertRaises(Problem):mail.authorize(db,"different browser",params)
            mail.authorize(db,"owner browser",params)
            with self.assertRaises(Problem):mail.authorize(db,"owner browser",params)
            with self.assertRaises(Problem):mail.save(db,{"sender":"me@dealer.example","address":"111 Main Street"})
            mail.save(db,{"sender":"sales@autodealership.si","address":"123 Example Street, Test City (fixture)"})

    def test_preview_send_suppression_and_replay(self):
        self.connect_team()
        with self.db() as db:
            draft=mail.stage(db,self.data)
            self.assertEqual(len(self.out),0)
            self.assertIn("sales@autodealership.si",draft["sender"])
            saved=mail.config(db)
            self.assertNotIn("rotating",saved["credentials"])
        self.fail_once=True
        with self.assertRaises(Problem):mail.send(self.db,draft["id"])
        accepted=mail.send(self.db,draft["id"])
        self.assertEqual(accepted,mail.send(self.db,draft["id"]))
        self.assertEqual(len(self.out),2)
        self.assertEqual(self.out[0],self.out[1])
        self.assertEqual(self.out[0][1]["text"],draft["body"])
        self.assertNotIn("Requested the guide",draft["body"])
        self.assertIn("List-Unsubscribe-Post",self.out[0][1]["headers"])
        with self.db() as db:
            follow=mail.stage(db,{**self.data,"kind":"followup"})
            token=db.execute("SELECT opt_token FROM public.platform_mail_contacts").fetchone()["opt_token"]
            mail.unsubscribe(db,token);mail.unsubscribe(db,token)
            with self.assertRaises(Problem):mail.stage(db,{**self.data,"kind":"demo"})
        with self.assertRaises(Problem):mail.send(self.db,follow["id"])
        self.assertEqual(len(self.out),2)

    def test_expired_attempt_and_team_change(self):
        self.connect_team()
        with self.db() as db:
            draft=mail.stage(db,self.data)
            db.execute("UPDATE public.platform_mail_messages SET first_attempt=now()-interval '25 hours'")
        with self.assertRaises(Problem):mail.send(self.db,draft["id"])
        with self.db() as db:
            draft=mail.stage(db,self.data);mail.disconnect(db)
        self.connect_team()
        with self.assertRaises(Problem):mail.send(self.db,draft["id"])
        self.assertFalse(self.out)
