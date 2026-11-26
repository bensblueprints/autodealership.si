"""HTTP endpoints for the platform owner's mail desk."""
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import platform_mail as mail
from resend_connect import Problem

ROOT = Path(__file__).parent
UNSUB = mail.PATH+"/unsubscribe"


def notice(text,button=False):
    action='<form method="post"><button>Unsubscribe from sales emails</button></form>' if button else ''
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>Email preferences | AutoDealership.SI</title>'
        '<main style="max-width:38rem;margin:12vh auto;padding:1rem;font:18px/1.5 system-ui"><h1>Email preferences</h1><p>'+text+'</p>'+action+'</main></html>').encode()


def get(handler):
    route=urlsplit(handler.path)
    if route.path==UNSUB:
        return handler.reply(200,notice("Stop receiving demo invitations, follow-ups and educational email from AutoDealership.SI.",True),True)
    if route.path==mail.PATH+"/callback":
        # The browser now posts on our own origin with its existing Strict owner session cookie.
        return handler.reply(200,(ROOT/"sales-email-callback.html").read_bytes(),True)
    if route.path!=mail.PATH:
        return handler.reply(404,{})
    if handler.identity()!="owner":
        handler.send_response(303);handler.send_header("Location","/onboarding/clerk-login?role=owner")
        handler.send_header("Cache-Control","no-store");handler.end_headers()
        return
    return handler.reply(200,(ROOT/"sales-email.html").read_bytes(),True)


def leave(handler,connect):
    # Mailbox providers send a one-click form POST. A browser link first displays the confirmation.
    try:
        if handler.headers.get_content_type()!="application/x-www-form-urlencoded":
            return handler.reply(415,{})
        size=int(handler.headers.get("Content-Length","0"))
        if size<0 or size>1024:
            return handler.reply(413,{})
        handler.rfile.read(size)
        token=parse_qs(urlsplit(handler.path).query,max_num_fields=2).get("t",[""])[0]
        with connect() as db:mail.unsubscribe(db,token)
        return handler.reply(200,notice("You’re unsubscribed from AutoDealership.SI sales emails."),True)
    except (ValueError,Problem):
        return handler.reply(404,notice("This unsubscribe link is invalid."),True)


def post(handler,connect,data,who):
    if who!="owner":
        return handler.reply(403,{"error":"Sign in as a platform owner."})
    op=handler.path[len(mail.PATH)+1:]
    jar=SimpleCookie()
    jar.load(handler.headers.get("Cookie",""))
    session=jar["onboarding_session"].value if "onboarding_session" in jar else handler.headers.get("Authorization","")
    try:
        if op=="send":
            result=mail.send(connect,data.get("id"))
        else:
            with connect() as db:
                if op=="status":result=mail.status(db)
                elif op=="save":result=mail.save(db,data)
                elif op=="connect":result=mail.begin(db,session)
                elif op=="finish":result=mail.authorize(db,session,data)
                elif op=="disconnect":result=mail.disconnect(db)
                elif op=="preview":result=mail.stage(db,data)
                elif op=="read":result=mail.preview(db,data.get("id"))
                else:return handler.reply(404,{})
        return handler.reply(200,result)
    except Problem as err:
        return handler.reply(err.status,{"error":str(err)})
