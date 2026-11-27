"""Confirm the public TLS endpoint and tenant identity before releasing a preview."""
import json
import re
import urllib.error
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):return None

def ready(slug,opener=None):
    if not re.fullmatch(r"[a-z][a-z0-9-]{1,48}[a-z0-9]",slug or ""):return False
    origin="https://"+slug+".autodealership.si"
    opener=opener or urllib.request.build_opener(NoRedirect()).open
    def fetch(path,limit,kind):
        req=urllib.request.Request(origin+path,headers={"Accept-Encoding":"identity","Cache-Control":"no-cache","User-Agent":"AutoDealership-Preview-Check/1"})
        with opener(req,timeout=5) as r:
            if r.status!=200 or r.geturl()!=origin+path or kind not in r.headers.get("Content-Type",""):raise ValueError("Unexpected preview response")
            return r.read(limit).decode("utf-8")
    try:
        page=fetch("/",450000,"text/html")
        if 'id="heroname"' not in page and 'id="heroimg"' not in page:return False
        marker=fetch("/assets/cdjr-inventory.js?workspace=1",1000,"javascript")
        prefix="window.postgresInventory=true;window.clientSite="
        if not marker.startswith(prefix):return False
        meta,_=json.JSONDecoder().raw_decode(marker[len(prefix):])
        return isinstance(meta,dict) and meta.get("slug")==slug
    except (OSError,ValueError,TypeError):return False
