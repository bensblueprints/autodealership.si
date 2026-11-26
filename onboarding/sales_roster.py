"""Refresh assignment choices from accepted Clerk organization memberships."""
import os
from urllib.parse import quote


def members(organization, fetch):
    result = {}
    offset = 0
    while True:
        page = fetch("organizations/" + quote(organization, safe="") + "/memberships?limit=100&offset=" + str(offset))
        batch = page["data"]
        for member in batch:
            info = member["public_user_data"]
            if member.get("role") not in ("org:admin", "org:member"):
                continue
            identifier = "clerk:" + info["user_id"]
            name = " ".join(filter(None, [info.get("first_name"), info.get("last_name")])).strip()
            label = name or info.get("identifier") or info["user_id"]
            result[identifier] = {"id": identifier, "label": label[:200]}
        offset += len(batch)
        if offset >= page["total_count"]:
            return sorted(result.values(), key=lambda row: (row["label"].casefold(), row["id"]))
        if not batch:
            raise ValueError("Incomplete Clerk directory page")


def main():
    import psycopg
    from psycopg.types.json import Jsonb
    from clerk_auth import provider
    with psycopg.connect(os.environ["CLIENT_DATABASE_URL"], autocommit=True) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS public.dealer_sales_rosters (
            site text PRIMARY KEY, organization text NOT NULL, members jsonb NOT NULL, synced_at timestamptz NOT NULL)""")
        sites = db.execute("SELECT id::text,clerk_org_id FROM public.client_sites WHERE clerk_org_id IS NOT NULL AND clerk_org_id<>''").fetchall()
        failures = 0
        for site, organization in sites:
            try:
                roster = members(organization, provider)
                db.execute("""INSERT INTO public.dealer_sales_rosters(site,organization,members,synced_at)
                    SELECT id::text,clerk_org_id,%s,now() FROM public.client_sites WHERE id=%s AND clerk_org_id=%s
                    ON CONFLICT(site) DO UPDATE SET organization=excluded.organization,members=excluded.members,synced_at=excluded.synced_at""",
                    (Jsonb(roster), site, organization))
            except Exception as exc:
                print("Directory refresh failed for",site,type(exc).__name__,flush=True)
                failures += 1
        print("Checked",len(sites),"dealership directories;",failures,"failed.",flush=True)
        return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())
