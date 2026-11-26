"""Provision UUID-named dealer databases and copy legacy tenant rows before routing traffic."""
import os
import uuid

import psycopg
from psycopg import sql

TABLES = {
    "appointments": "key text PRIMARY KEY, confirmation text UNIQUE NOT NULL, body jsonb NOT NULL, notes jsonb NOT NULL DEFAULT '{}'",
    "inventory_status": "vin text PRIMARY KEY,status text NOT NULL CHECK(status IN ('sold','deleted'))",
    "bhph_offers": "vehicle text PRIMARY KEY,revision integer NOT NULL,offer jsonb NOT NULL",
    "homepage_banners": "id integer PRIMARY KEY,revision integer NOT NULL,config jsonb NOT NULL",
    "client_cars": "vin text PRIMARY KEY,body jsonb NOT NULL",
    "client_profile": "id integer PRIMARY KEY,settings jsonb NOT NULL,etag text NOT NULL",
    "vehicle_photo_assets": "site text NOT NULL,digest text NOT NULL,jpeg bytea NOT NULL,PRIMARY KEY(site,digest)",
    "oem_program_revisions": "program_id uuid NOT NULL, revision integer NOT NULL, state text NOT NULL, details jsonb NOT NULL, actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(program_id,revision)",
    "oem_banner_reviews": "digest text PRIMARY KEY, program_id uuid NOT NULL, program_revision integer NOT NULL, creative jsonb NOT NULL, actor text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now()",
    "marketing_campaigns": "id uuid PRIMARY KEY, revision integer NOT NULL, state text NOT NULL, brief jsonb NOT NULL, history jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()",
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
            if not legacy:
                continue
            if table == "vehicle_photo_assets":
                source = sql.SQL("SELECT * FROM public.vehicle_photo_assets WHERE site={}").format(sql.Literal(str(site_id)))
            elif table in ("marketing_campaigns","oem_program_revisions","oem_banner_reviews") and not control.execute(
                "SELECT to_regclass(%s) AS name", (database + "." + table,)
            ).fetchone()["name"]:
                continue
            elif table == "shopper_leads":
                continue
            else:
                source = sql.SQL("SELECT * FROM {}.{}").format(sql.Identifier(database), ident)
            # A previous attempt can have committed the copy before publishing the route.
            target.execute(sql.SQL("TRUNCATE {}").format(ident))
            with control.cursor().copy(sql.SQL("COPY ({}) TO STDOUT (FORMAT BINARY)").format(source)) as reader:
                with target.cursor().copy(sql.SQL("COPY {} FROM STDIN (FORMAT BINARY)").format(ident)) as writer:
                    for block in reader:
                        writer.write(block)
            expected = control.execute(sql.SQL("SELECT count(*) AS n FROM ({}) AS source_rows").format(source)).fetchone()["n"]
            if target.execute(sql.SQL("SELECT count(*) FROM {}").format(ident)).fetchone()[0] != expected:
                raise RuntimeError("Copy verification failed for " + table)
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
