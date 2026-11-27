"""Provision a dealership preview and bind its Clerk organization on repeatable setup."""
import json,os,secrets,uuid
from urllib.request import Request,urlopen
from urllib.parse import quote
from urllib.error import HTTPError,URLError

def organization_request(path,data=None):
    req=Request("https://api.clerk.com/v1/"+path,data=json.dumps(data).encode() if data else None,headers={"Content-Type":"application/json","Authorization":"Bearer "+os.environ["CLERK_SECRET_KEY"],"User-Agent":"AutoDealership/1"})
    with urlopen(req,timeout=12) as r:return json.load(r)

def bind(connect,slug,who,provider=organization_request):
    with connect() as db:
        site=db.execute("SELECT id,name,clerk_org_id,engineer,staging_request FROM public.client_sites WHERE slug=%s FOR UPDATE",(slug,)).fetchone()
        if not site or not site["staging_request"] or (who!="owner" and who!=site["engineer"]):raise ValueError("Choose a staging dealership you manage.")
        if site["clerk_org_id"]:return True
        tag=str(site["id"])
        try:
            offset=0
            org=None
            while True:
                batch=provider("organizations?limit=100&query="+quote(site["name"],safe="")+"&offset="+str(offset))["data"]
                for candidate in batch:
                    if candidate.get("private_metadata",{}).get("autodealership_site")==tag:
                        if org is not None:return False
                        org=candidate
                if len(batch)<100:break
                offset+=len(batch)
            if org is None:
                org=provider("organizations",{"name":site["name"],"private_metadata":{"autodealership_site":tag}})
            if org.get("private_metadata",{}).get("autodealership_site")!=tag:return False
            db.execute("UPDATE public.client_sites SET clerk_org_id=%s WHERE id=%s",(org["id"],site["id"]))
            return True
        except (HTTPError,URLError,TimeoutError,KeyError):return False

def stage(connect,create,data,who):
    request=uuid.UUID(str(data.get("request","")))
    slug=str(data.get("slug","")).strip().lower()
    with connect() as db:
        db.execute("SELECT pg_advisory_xact_lock(hashtext(%s),10215)",(slug,))
        row=db.execute("SELECT name,slug,engineer,staging_request FROM public.client_sites WHERE slug=%s OR staging_request=%s",(slug,request)).fetchone()
        if row:
            if row["slug"]!=slug or row["staging_request"]!=request or who!="owner" and who!=row["engineer"]:raise ValueError("Choose an available preview subdomain.")
        else:
            template=str(data.get("siteTemplate","independent"))
            create({"name":str(data.get("name","")),"slug":slug,"password":secrets.token_urlsafe(48),"rate":0,"voice":False,"bhph":template=="bhph","siteTemplate":template,"domain":""},None if who=="owner" else who,staging_request=request)
    return {"slug":slug,"organizationReady":bind(connect,slug,who),"previewReady":False}
