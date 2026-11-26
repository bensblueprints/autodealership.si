"""Authenticated setup UI and callback for each dealer's Resend team."""
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlsplit
from pathlib import Path
import resend_connect as email

COOKIE = "__Host-adsi_email"
BASE = "/onboarding/email"


def cookie(handler):
    jar = SimpleCookie()
    jar.load(handler.headers.get("Cookie",""))
    value = jar.get(COOKIE)
    return value.value if value else ""


def redirect(handler, result):
    handler.send_response(303)
    handler.send_header("Location", BASE+"?result="+result)
    handler.send_header("Cache-Control","no-store")
    handler.send_header("Referrer-Policy","no-referrer")
    handler.end_headers()


def get(handler, connect):
    route = urlsplit(handler.path)
    if route.path == BASE:
        return handler.reply(200,Path(__file__).with_name("email.html").read_bytes(),True)
    if route.path == BASE+"/callback":
        token = cookie(handler)
        params = {k:v[0] for k,v in parse_qs(route.query,max_num_fields=12).items() if len(v)==1}
        try:
            with connect() as db:
                site = email.session(db,token)
                try:
                    result = email.finish(db,site["id"],token,params)
                except email.Problem as err:
                    result = "expired" if err.status == 403 else "failed"
            return redirect(handler,result)
        except email.Problem:
            return redirect(handler,"expired")
    return handler.reply(404,{})


def post(handler, connect, operation, data):
    token = cookie(handler)
    try:
        if operation == "enter":
            with connect() as db:
                new = email.redeem(db,data.get("ticket",""))
            handler.session_cookie = COOKIE+"="+new+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1500"
            return handler.reply(200,{})
        if operation == "ticket":
            who = handler.identity()
            if not who:
                raise email.Problem(403,"Sign in to manage this dealership.")
            with connect() as db:
                sql = "SELECT id FROM public.client_sites WHERE slug=%s"
                row = db.execute(sql if who=="owner" else sql+" AND engineer=%s",
                    (data.get("slug"),) if who=="owner" else (data.get("slug"),who)).fetchone()
                if not row:
                    raise email.Problem(403,"This dealership is outside your assignment.")
                result = email.issue(db,row["id"])
            return handler.reply(200,result)
        with connect() as db:
            site = email.session(db,token)
            if operation == "status":
                result = email.status(db,site)
            elif str(site["id"]) != data.get("site"):
                raise email.Problem(409,"Another dealership is open in this browser. Reopen its email settings to continue.")
            elif operation == "connect":
                result = email.begin(db,site["id"],token)
            elif operation == "disconnect":
                email.disconnect(db,site["id"])
                result = email.status(db,site)
            elif operation in ("domain","verify"):
                # A dedicated transaction persists token rotation even if subsequent DNS lookup fails.
                email.lock_site(db,site["id"])
                bearer = email.access(connect,site["id"])
                try:
                    result = email.manage_domain(db,site["id"],bearer,data.get("domain"),operation=="verify")
                except email.Problem as err:
                    if err.status == 401:
                        db.execute("UPDATE public.dealer_email_grants SET reconnect=true,verified=false WHERE site=%s",(site["id"],))
                        db.commit()
                    raise
            else:
                raise email.Problem(404,"Unknown email setup action.")
        return handler.reply(200,result)
    except email.Problem as err:
        return handler.reply(err.status,{"error":str(err)})
