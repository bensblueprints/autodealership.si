"""Run against a disposable PostgreSQL database specified by RESEND_TEST_DATABASE_URL."""
import hashlib
import os
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch
from uuid import uuid4
import psycopg
from psycopg.rows import dict_row
from cryptography.fernet import Fernet
import resend_connect as email


@unittest.skipUnless(os.getenv("RESEND_TEST_DATABASE_URL"), "requires an isolated PostgreSQL database")
class DealerEmailTest(unittest.TestCase):
    def setUp(self):
        self.pg = os.environ["RESEND_TEST_DATABASE_URL"]
        # The production queries are schema-qualified. Use a disposable, empty database.
        self.a,self.b = uuid4(),uuid4()
        with self.db() as db:
            self.assertIsNone(db.execute("SELECT to_regclass('public.client_sites') AS existing").fetchone()["existing"])
            db.execute("CREATE TABLE public.client_sites(id uuid PRIMARY KEY,name text,slug text UNIQUE)")
            db.execute("INSERT INTO public.client_sites VALUES (%s,'First','first'),(%s,'Second','second')",(self.a,self.b))
            db.execute(email.SCHEMA)
        self.addCleanup(self.clean)
        env = patch.dict(os.environ,RESEND_TOKEN_KEY=Fernet.generate_key().decode(),RESEND_CLIENT_ID="fixture")
        env.start();self.addCleanup(env.stop)
        self.provider = patch.object(email,"call",side_effect=self.respond)
        self.calls=self.provider.start();self.addCleanup(self.provider.stop)
        self.refreshes=0

    def db(self):
        return psycopg.connect(self.pg,row_factory=dict_row)

    def clean(self):
        with self.db() as db:
            db.execute("DROP TABLE public.dealer_email_grants,public.dealer_email_requests,public.dealer_email_sessions,public.dealer_email_tickets,public.client_sites")

    def respond(self,path,form=None,**kw):
        if path=="/oauth/token":
            if form["grant_type"]=="refresh_token":
                self.assertEqual(form["refresh_token"],"secret-refresh-0")
                self.refreshes+=1
            return {"token_type":"Bearer","access_token":"test-access-"+str(self.refreshes),"refresh_token":"secret-refresh-"+str(self.refreshes),"scope":"full_access","expires_in":5 if not self.refreshes else 900}
        if path.startswith("/domains?"):
            return {"data":[{"id":"known","name":"mail.first.example"}]}
        if path in ("/domains/known","/domains/added"):
            return {"name":"mail.first.example" if path.endswith("known") else "mail.second.example","status":"verified","records":[{"name":"dkim","type":"TXT","value":"public dns"}]}
        if path=="/domains":
            self.assertEqual(kw["data"],{"name":"mail.second.example"})
            return {"id":"added"}
        if path.endswith("/verify") or path=="/oauth/revoke":
            return {}
        self.fail(path)

    def test_dealer_lifecycle(self):
        with self.db() as db:
            ticket=email.issue(db,self.a)["url"].split("#")[1]
            session=email.redeem(db,ticket)
            with self.assertRaises(email.Problem): email.redeem(db,ticket)
            self.assertEqual(email.session(db,session)["id"],self.a)
            params=parse_qs(urlsplit(email.begin(db,self.a,session)["url"]).query)
            state=params["state"][0]
            with self.assertRaises(email.Problem): email.finish(db,self.b,session,{"state":state,"code":"x"})
            with self.assertRaises(email.Problem): email.finish(db,self.a,"other",{"state":state,"code":"x"})
            self.assertEqual(email.finish(db,self.a,session,{"state":state,"code":"test"}),"connected")
            verifier=self.calls.call_args.args[1]["code_verifier"]
            import base64
            self.assertEqual(params["code_challenge"][0],base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("="))
            with self.assertRaises(email.Problem): email.finish(db,self.a,session,{"state":state,"code":"test"})
            stored=email.grant(db,self.a)["credentials"]
            self.assertNotIn("secret-refresh",stored)
            self.assertFalse(email.status(db,{"id":self.b,"name":"Second","slug":"second"})["connected"])
        bearer=email.access(self.db,self.a)
        self.assertEqual(bearer,email.access(self.db,self.a))
        self.assertEqual(self.refreshes,1)
        with self.db() as db:
            self.assertTrue(email.manage_domain(db,self.a,bearer,"mail.first.example",True)["verified"])
            self.assertEqual(len(email.manage_domain(db,self.a,bearer,"mail.first.example")["records"]),1)
            state=parse_qs(urlsplit(email.begin(db,self.b,"second")["url"]).query)["state"][0]
            self.assertEqual(email.finish(db,self.b,"second",{"state":state,"error":"denied"}),"canceled")
            state=parse_qs(urlsplit(email.begin(db,self.b,"second")["url"]).query)["state"][0]
            email.finish(db,self.b,"second",{"state":state,"code":"test"})
            with self.assertRaises(email.Problem): email.manage_domain(db,self.b,bearer,"mail.first.example")
            self.assertTrue(email.manage_domain(db,self.b,bearer,"mail.second.example")["verified"])
            email.disconnect(db,self.a)
            with self.assertRaises(email.Problem): email.grant(db,self.a)
            self.assertIsNotNone(email.grant(db,self.b))
