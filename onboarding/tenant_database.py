"""Provision UUID-named dealer databases and copy legacy tenant rows before routing traffic."""
import os
import uuid

import psycopg
from psycopg import sql

TABLES = {
    "appointments": "key text PRIMARY KEY, confirmation text UNIQUE NOT NULL, body jsonb NOT NULL, notes jsonb NOT NULL DEFAULT '{}'",
    "inventory_vin_drafts": "vin text PRIMARY KEY, specs jsonb, created_at timestamptz NOT NULL DEFAULT now()",
    "inventory_lot_dates": "vin text PRIMARY KEY,stocked_on date NOT NULL",
    "inventory_status": "vin text PRIMARY KEY,status text NOT NULL CHECK(status IN ('sold','deleted'))",
    "bhph_offers": "vehicle text PRIMARY KEY,revision integer NOT NULL,offer jsonb NOT NULL",
    "homepage_banners": "id integer PRIMARY KEY,revision integer NOT NULL,config jsonb NOT NULL",
    "client_cars": "vin text PRIMARY KEY,body jsonb NOT NULL",
    "website_page_review_events": "id uuid PRIMARY KEY,page_key text NOT NULL,action text NOT NULL,draft_stamp text NOT NULL,actor text NOT NULL,note text NOT NULL,content jsonb NOT NULL,edition integer,recorded_at timestamptz NOT NULL DEFAULT now()",
    "website_page_editions": "page_key text NOT NULL,edition integer NOT NULL,content jsonb NOT NULL,stamp text NOT NULL,actor text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(page_key,edition)",
    "client_profile": "id integer PRIMARY KEY,settings jsonb NOT NULL,etag text NOT NULL",
    "vehicle_photo_assets": "site text NOT NULL,digest text NOT NULL,jpeg bytea NOT NULL,PRIMARY KEY(site,digest)",
    "oem_program_revisions": "program_id uuid NOT NULL, revision integer NOT NULL, state text NOT NULL, details jsonb NOT NULL, actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(program_id,revision)",
    "oem_banner_reviews": "digest text PRIMARY KEY, program_id uuid NOT NULL, program_revision integer NOT NULL, creative jsonb NOT NULL, actor text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now()",
    "marketing_campaigns": "id uuid PRIMARY KEY, revision integer NOT NULL, state text NOT NULL, brief jsonb NOT NULL, history jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()",
    "sales_opportunities": "id uuid PRIMARY KEY,thread_key text UNIQUE NOT NULL,name text NOT NULL,phone text,email text,owner jsonb,stage text NOT NULL DEFAULT 'New',revision int NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),history jsonb NOT NULL DEFAULT '[]'",
    "sales_client_intakes": "request uuid PRIMARY KEY,client_id uuid NOT NULL REFERENCES sales_opportunities,source text NOT NULL,vin text NOT NULL,car jsonb,note text NOT NULL,actor text NOT NULL,at timestamptz NOT NULL DEFAULT now()",
    "sales_client_contracts": "client_id uuid NOT NULL REFERENCES sales_opportunities,vin text NOT NULL,stage text NOT NULL,cents bigint CHECK(cents>0),revision int NOT NULL,history jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(client_id,vin)",
    "dealer_review_settings": "id int PRIMARY KEY CHECK(id=1),link text NOT NULL,revision int NOT NULL,automatic boolean NOT NULL DEFAULT false",
    "purchase_review_optouts": "address text PRIMARY KEY,at timestamptz NOT NULL DEFAULT now()",
    "purchase_review_emails": "id uuid PRIMARY KEY,token uuid UNIQUE NOT NULL,client_id uuid NOT NULL,vin text NOT NULL,address text NOT NULL,dealer text NOT NULL,domain_id text NOT NULL,domain text NOT NULL,origin text NOT NULL,google_link text NOT NULL,permission_actor text NOT NULL,purchased_at timestamptz NOT NULL,due_at timestamptz NOT NULL,state text NOT NULL DEFAULT 'scheduled',provider_id text,stars int CHECK(stars BETWEEN 1 AND 5),comment text,responded_at timestamptz,resolved_at timestamptz,resolved_by text,UNIQUE(client_id,vin)",
    "staff_calls": "id uuid PRIMARY KEY,opportunity uuid NOT NULL,owner_id text NOT NULL,actor text NOT NULL,phone text NOT NULL,sender text NOT NULL,account text NOT NULL,state text NOT NULL,parent_sid text UNIQUE,child_sid text UNIQUE,seconds int,created_at timestamptz NOT NULL DEFAULT now()",
    "staff_mail_messages": "message uuid PRIMARY KEY,grant_id uuid NOT NULL,owner_id text NOT NULL,sender text NOT NULL,rfc_id text NOT NULL,thread_id text,UNIQUE(grant_id,rfc_id)",
    "sales_email_messages": "id uuid PRIMARY KEY,opportunity uuid NOT NULL,provider_id text UNIQUE,direction text NOT NULL,address text NOT NULL,subject text NOT NULL,body text NOT NULL,state text NOT NULL,actor text,created_at timestamptz NOT NULL DEFAULT now()",
    "sms_usage_evidence": "message uuid PRIMARY KEY,sid text UNIQUE NOT NULL,segments int,cost numeric(18,7),currency text,status text NOT NULL,checked_at timestamptz NOT NULL DEFAULT now()",
    "inquiry_sms_messages": "id uuid PRIMARY KEY,sid text UNIQUE,phone text NOT NULL,sender text NOT NULL,inquiry uuid,stock text,direction text NOT NULL,body text NOT NULL,state text NOT NULL,actor text,created_at timestamptz NOT NULL DEFAULT now()",
    "inquiry_sms_contacts": "phone text PRIMARY KEY,blocked boolean NOT NULL,changed_at timestamptz NOT NULL",
    "shopper_leads": "id uuid PRIMARY KEY,body jsonb NOT NULL",
}


def provision(control, site_id, name, legacy=False, template="independent"):
    # Caller holds the site's registry row lock until this function returns and commits.
    database = "client_" + site_id.hex
    dsn = os.environ["CLIENT_DATABASE_URL"]
    with psycopg.connect(dsn, autocommit=True) as admin:
        if not admin.execute("SELECT 1 FROM pg_database WHERE datname=%s", (database,)).fetchone():
            admin.execute(sql.SQL("CREATE DATABASE {} TEMPLATE template0").format(sql.Identifier(database)))
    with psycopg.connect(dsn, dbname=database) as target:
        for table, columns in TABLES.items():
            ident = sql.Identifier(table)
            target.execute(sql.SQL("CREATE TABLE IF NOT EXISTS {} ({})").format(ident, sql.SQL(columns)))
            if table == "dealer_review_settings":
                target.execute("ALTER TABLE dealer_review_settings ADD COLUMN IF NOT EXISTS automatic boolean NOT NULL DEFAULT false")
            if not legacy:
                continue
            if table == "vehicle_photo_assets":
                source = sql.SQL("SELECT * FROM public.vehicle_photo_assets WHERE site={}").format(sql.Literal(str(site_id)))
            elif table in ("marketing_campaigns","oem_program_revisions","oem_banner_reviews","website_page_editions","website_page_review_events","inventory_lot_dates","inventory_vin_drafts","inquiry_sms_contacts","inquiry_sms_messages","sms_usage_evidence","sales_opportunities","sales_email_messages","staff_mail_messages","staff_calls","shopper_leads","sales_client_intakes","sales_client_contracts","dealer_review_settings","purchase_review_optouts","purchase_review_emails") and not control.execute(
                "SELECT to_regclass(%s) AS name", (database + "." + table,)
            ).fetchone()["name"]:
                continue
            else:
                source = sql.SQL("SELECT * FROM {}.{}").format(sql.Identifier(database), ident)
            # A previous attempt can have committed the copy before publishing the route.
            if table == "sales_opportunities":
                # A retry may already have both referencing tables in the unpublished target.
                deps = [sql.Identifier(n) for n in ("sales_client_intakes","sales_client_contracts") if target.execute("SELECT to_regclass(%s)",(n,)).fetchone()[0]]
                target.execute(sql.SQL("TRUNCATE {}").format(sql.SQL(", ").join([ident,*deps])))
            else:
                target.execute(sql.SQL("TRUNCATE {}").format(ident))
            if table == "dealer_review_settings" and not control.execute("SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name='automatic'",(database,table)).fetchone():
                source = sql.SQL("SELECT id,link,revision,false FROM {}.{}").format(sql.Identifier(database),ident)
            with control.cursor().copy(sql.SQL("COPY ({}) TO STDOUT (FORMAT BINARY)").format(source)) as reader:
                with target.cursor().copy(sql.SQL("COPY {} FROM STDIN (FORMAT BINARY)").format(ident)) as writer:
                    for block in reader:
                        writer.write(block)
            expected = control.execute(sql.SQL("SELECT count(*) AS n FROM ({}) AS source_rows").format(source)).fetchone()["n"]
            if target.execute(sql.SQL("SELECT count(*) FROM {}").format(ident)).fetchone()[0] != expected:
                raise RuntimeError("Copy verification failed for " + table)
        target.execute("CREATE INDEX IF NOT EXISTS review_due ON purchase_review_emails(state,due_at)")
        target.execute("CREATE INDEX IF NOT EXISTS sales_email_thread ON sales_email_messages(opportunity,created_at DESC)")
        target.execute("CREATE INDEX IF NOT EXISTS sms_phone_time ON inquiry_sms_messages(phone,created_at DESC)")
        if not legacy:
            from psycopg.types.json import Jsonb
            target.execute("INSERT INTO client_profile VALUES(1,%s,%s)", (Jsonb({"dealerName":name,"profile":{"skin":"midnight","siteTemplate":template},"pages":{}}),uuid.uuid4().hex))
    control.execute("UPDATE public.client_sites SET database_name=%s WHERE id=%s", (database,site_id))


if __name__ == "__main__":
    from psycopg.rows import dict_row
    with psycopg.connect(os.environ["CLIENT_DATABASE_URL"], row_factory=dict_row) as control:
        sites = control.execute("SELECT id FROM public.client_sites WHERE database_name IS NULL ORDER BY id").fetchall()
        control.commit()
        for site in sites:
            with control.transaction():
                row = control.execute("SELECT name,database_name FROM public.client_sites WHERE id=%s FOR UPDATE", (site["id"],)).fetchone()
                if row and row["database_name"] is None:
                    provision(control,site["id"],row["name"],legacy=True)
                    print("Verified database for", row["name"])
