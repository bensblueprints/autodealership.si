"""Dealer-owned Resend OAuth grants and verified sender domains."""
import base64
import hashlib
import json
import os
import re
import secrets
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet

BASE = "https://api.resend.com"
PAGE = "https://autodealership.si/onboarding/email"
CALLBACK = PAGE + "/callback"
SCOPE = "full_access"  # Resend requires this for its domain verification API.
SCHEMA = """
CREATE TABLE IF NOT EXISTS public.dealer_email_tickets (
    token text PRIMARY KEY, site uuid NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
    expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.dealer_email_sessions (
    token text PRIMARY KEY, site uuid NOT NULL REFERENCES public.client_sites(id) ON DELETE CASCADE,
    expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.dealer_email_requests (
    site uuid PRIMARY KEY REFERENCES public.client_sites(id) ON DELETE CASCADE,
    state text UNIQUE NOT NULL, session text NOT NULL, verifier text NOT NULL, expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.dealer_email_grants (
    site uuid PRIMARY KEY REFERENCES public.client_sites(id) ON DELETE CASCADE,
    credentials text NOT NULL, domain text UNIQUE, domain_id text UNIQUE, verified boolean NOT NULL DEFAULT false,
    reconnect boolean NOT NULL DEFAULT false);
"""


class Problem(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(message)


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def cipher():
    return Fernet(os.environ["RESEND_TOKEN_KEY"].encode())


def call(path, form=None, *, method=None, bearer=None, data=None):
    headers = {"User-Agent": "AutoDealership.SI/1", "Accept": "application/json"}
    payload = None
    if form is not None:
        payload = urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        auth = os.environ["RESEND_CLIENT_ID"] + ":" + os.environ["RESEND_CLIENT_SECRET"]
        headers["Authorization"] = "Basic " + base64.b64encode(auth.encode()).decode()
    elif data is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(data).encode()
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    try:
        with urlopen(Request(BASE + path, data=payload, method=method, headers=headers), timeout=10) as res:
            return json.loads(res.read() or "{}")
    except HTTPError as exc:
        try:
            error = json.loads(exc.read(8192))
        except ValueError:
            error = {}
        if error.get("error") == "invalid_grant" or (bearer and exc.code in (401,403)):
            raise Problem(401, "Reconnect this dealership’s Resend team to continue.") from exc
        if exc.code == 429:
            raise Problem(429, "Resend is handling too many requests. Try again shortly.") from exc
        if exc.code in (400, 409, 422) and path.startswith("/domains"):
            raise Problem(422, "Resend could not accept this domain. Check the team, domain spelling and plan allowance.") from exc
        raise Problem(502, "Resend could not complete the request. Check the connection and try again.") from exc
    except (URLError, OSError, ValueError) as exc:
        raise Problem(503, "Resend is temporarily unavailable. Try again shortly.") from exc


def issue(db, site):
    raw = secrets.token_urlsafe(32)
    db.execute("DELETE FROM public.dealer_email_tickets WHERE expires<=now()")
    db.execute("INSERT INTO public.dealer_email_tickets VALUES (%s,%s,now()+interval '90 seconds')", (digest(raw), site))
    return {"url": PAGE + "#" + raw}


def redeem(db, ticket):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{43}", str(ticket)):
        raise Problem(403, "Open email setup from your dealer dashboard.")
    used = db.execute("DELETE FROM public.dealer_email_tickets WHERE token=%s AND expires>now() RETURNING site", (digest(ticket),)).fetchone()
    if not used:
        raise Problem(403, "This setup link expired. Open email setup again from your dealer dashboard.")
    token = secrets.token_urlsafe(32)
    db.execute("DELETE FROM public.dealer_email_sessions WHERE expires<=now()")
    db.execute("INSERT INTO public.dealer_email_sessions VALUES (%s,%s,now()+interval '25 minutes')", (digest(token), used["site"]))
    return token


def session(db, token):
    row = db.execute("""SELECT t.id, t.name, t.slug FROM public.dealer_email_sessions s
        JOIN public.client_sites t ON t.id=s.site WHERE s.token=%s AND s.expires>now()""", (digest(token),)).fetchone()
    if not row:
        raise Problem(403, "Open email setup from your dealer dashboard to continue.")
    return row


def lock_site(db, site):
    db.execute("SELECT id FROM public.client_sites WHERE id=%s FOR UPDATE", (site,))


def begin(db, site, token):
    lock_site(db, site)
    if db.execute("SELECT 1 FROM public.dealer_email_grants WHERE site=%s AND NOT reconnect", (site,)).fetchone():
        raise Problem(409, "Disconnect the current team before connecting another.")
    verifier = secrets.token_urlsafe(64)
    state = secrets.token_urlsafe(32)
    db.execute("""INSERT INTO public.dealer_email_requests VALUES (%s,%s,%s,%s,now()+interval '10 minutes')
        ON CONFLICT(site) DO UPDATE SET state=excluded.state,session=excluded.session,
        verifier=excluded.verifier,expires=excluded.expires""", (site,digest(state),digest(token),verifier))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    return {"url": BASE + "/oauth/authorize?" + urlencode({
        "client_id": os.environ["RESEND_CLIENT_ID"], "response_type":"code", "scope":SCOPE,
        "redirect_uri":CALLBACK, "state":state, "code_challenge_method":"S256","code_challenge":challenge})}


def seal(tokens):
    if not tokens.get("access_token") or not tokens.get("refresh_token") or tokens.get("token_type","").lower() != "bearer" or SCOPE not in tokens.get("scope","").split():
        raise Problem(502, "Resend did not grant the requested domain permissions.")
    plain = {"access":tokens["access_token"], "refresh":tokens["refresh_token"],
             "expires":time.time()+int(tokens["expires_in"])}
    return cipher().encrypt(json.dumps(plain).encode()).decode()


def finish(db, site, token, params):
    lock_site(db, site)
    row = db.execute("""DELETE FROM public.dealer_email_requests WHERE site=%s AND state=%s
        AND session=%s AND expires>now() RETURNING verifier""",
        (site, digest(params.get("state","")), digest(token))).fetchone()
    if not row:
        raise Problem(403, "This approval expired or belongs to another setup session.")
    if params.get("error") or not params.get("code"):
        return "canceled"
    tokens = call("/oauth/token", {"grant_type":"authorization_code", "code":params["code"],
        "redirect_uri":CALLBACK, "code_verifier":row["verifier"]})
    db.execute("""INSERT INTO public.dealer_email_grants(site,credentials) VALUES (%s,%s)
        ON CONFLICT(site) DO UPDATE SET credentials=excluded.credentials,reconnect=false,
        domain=NULL,domain_id=NULL,verified=false""", (site,seal(tokens)))
    return "connected"


def grant(db, site):
    row = db.execute("SELECT * FROM public.dealer_email_grants WHERE site=%s FOR UPDATE", (site,)).fetchone()
    if not row:
        raise Problem(409, "Connect the dealership’s Resend team first.")
    return row


def access(connect, site):
    # Commit a successful refresh before making another provider request. Rotating tokens are single-use.
    with connect() as db:
        row = grant(db,site)
        if row["reconnect"]:
            raise Problem(401, "Reconnect this dealership’s Resend team to continue.")
        tokens = json.loads(cipher().decrypt(row["credentials"].encode()))
        if tokens["expires"] > time.time()+60:
            return tokens["access"]
        try:
            new = call("/oauth/token", {"grant_type":"refresh_token", "refresh_token":tokens["refresh"]})
        except Problem as err:
            if err.status == 401:
                db.execute("UPDATE public.dealer_email_grants SET reconnect=true,verified=false WHERE site=%s", (site,))
                db.commit()
            raise
        db.execute("UPDATE public.dealer_email_grants SET credentials=%s WHERE site=%s", (seal(new),site))
        return new["access_token"]


def status(db, site):
    row = db.execute("SELECT domain,verified,reconnect FROM public.dealer_email_grants WHERE site=%s", (site["id"],)).fetchone()
    return {"site":str(site["id"]), "name":site["name"], "slug":site["slug"], "connected":bool(row),
            **(row or {"domain":None,"verified":False,"reconnect":False})}


def check_domain(name):
    name = str(name or "").strip().lower()
    if len(name)>253 or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}",name):
        raise Problem(422,"Enter a dedicated sending subdomain, such as mail.dealership.com.")
    return name


def manage_domain(db, site, bearer, name, verify=False):
    name = check_domain(name)
    row = grant(db, site)
    if row["domain"] and name != row["domain"]:
        raise Problem(409,"Disconnect and reconnect the team to configure a different sending domain.")
    if not row["domain_id"]:
        # Serialize ownership before any provider-side create.
        db.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("resend:"+name,))
        if db.execute("SELECT 1 FROM public.dealer_email_grants WHERE domain=%s AND site<>%s", (name,site)).fetchone():
            raise Problem(409,"This sending domain is already connected to another dealership.")
        cursor = ""
        while True:
            page = call("/domains?limit=100" + cursor, bearer=bearer)
            items = page["data"]
            match = next((d for d in items if d["name"].lower()==name), None)
            if match or not page.get("has_more") or not items:
                break
            cursor = "&after=" + quote(items[-1]["id"],safe="")
        domain_id = (match or call("/domains", bearer=bearer, data={"name":name}))["id"]
    else:
        domain_id = row["domain_id"]
    path = "/domains/" + quote(domain_id,safe="")
    if verify:
        call(path + "/verify", bearer=bearer, method="POST")
    details = call(path,bearer=bearer)
    if details["name"].lower() != name:
        raise Problem(409,"The sending domain changed on Resend. Reconnect to continue.")
    ready = details["status"]=="verified" and details.get("capabilities",{}).get("sending","enabled")=="enabled"
    db.execute("UPDATE public.dealer_email_grants SET domain=%s,domain_id=%s,verified=%s WHERE site=%s",
               (name,domain_id,ready,site))
    records = [{k:r.get(k) for k in ("record","type","name","value","priority","status")} for r in details.get("records",[])]
    return {"domain":name,"verified":ready,"records":records}


def disconnect(db, site):
    lock_site(db,site)
    db.execute("DELETE FROM public.dealer_email_requests WHERE site=%s",(site,))
    row = grant(db,site)
    refresh = json.loads(cipher().decrypt(row["credentials"].encode()))["refresh"]
    try:
        call("/oauth/revoke", {"token":refresh, "token_type_hint":"refresh_token"})
    except Problem as exc:
        if exc.status!=401:
            raise
    db.execute("DELETE FROM public.dealer_email_grants WHERE site=%s", (site,))
