"""Exercise the legacy inquiry and SMS copy on an isolated fixture PostgreSQL server."""
import os
import uuid
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from tenant_database import TABLES, provision

dsn = os.environ["CLIENT_DATABASE_URL"]
ident = uuid.UUID("30000000-0000-0000-0000-000000000073")
schema = "client_" + ident.hex
lead, msg = uuid.uuid4(), uuid.uuid4()
with psycopg.connect(dsn, row_factory=dict_row) as control:
    assert control.execute("SELECT verified_domain FROM public.client_sites WHERE slug='qa'").fetchone()["verified_domain"] == "dealer.qa.test"
    control.execute("INSERT INTO public.client_sites(id,slug,name,bhph) VALUES(%s,'sms-migration-qa','Migration fixture',false)", (ident,))
    control.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    for name, columns in TABLES.items():
        control.execute(sql.SQL("CREATE TABLE {}.{} ({})").format(sql.Identifier(schema), sql.Identifier(name), sql.SQL(columns)))
    control.execute(sql.SQL("INSERT INTO {}.shopper_leads VALUES(%s,'{{\"name\":\"Pilot\"}}')").format(sql.Identifier(schema)), (lead,))
    control.execute(sql.SQL("INSERT INTO {}.inquiry_sms_contacts VALUES('+17405550187',true,now())").format(sql.Identifier(schema)))
    control.execute(sql.SQL("INSERT INTO {}.inquiry_sms_messages(id,phone,sender,inquiry,stock,direction,body,state) VALUES(%s,'+17405550187','+17405550111',%s,'LOT-70','out','Test reply','sent')").format(sql.Identifier(schema)), (msg,lead))
    provision(control, ident, "Migration fixture", legacy=True)
with psycopg.connect(dsn, dbname=schema) as dest:
    assert dest.execute("SELECT id,body->>'name' FROM shopper_leads").fetchall() == [(lead,"Pilot")]
    assert dest.execute("SELECT id,inquiry,stock FROM inquiry_sms_messages").fetchall() == [(msg,lead,"LOT-70")]
    assert dest.execute("SELECT blocked FROM inquiry_sms_contacts").fetchone() == (True,)
    assert dest.execute("SELECT to_regclass('sms_phone_time') IS NOT NULL").fetchone() == (True,)
print("Verified migration preserves the inquiry, text history and withdrawal in a dedicated dealer database.")
