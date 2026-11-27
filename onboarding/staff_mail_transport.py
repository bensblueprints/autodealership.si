"""Direct mailbox transports for one salesperson. Fetch customer replies only."""
import base64
import datetime as dt
import email
from email import policy
from email.message import EmailMessage
from email.utils import parseaddr, format_datetime
from imaplib import IMAP4_SSL
import ipaddress
import json
import re
import smtplib
import socket
import ssl
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

GMAIL="https://gmail.googleapis.com/gmail/v1/users/me"
TIMEOUT=12
MAX_MESSAGE=2_000_000
CTX=ssl.create_default_context()

def public_host(host):
    host=str(host or "").strip().lower().rstrip(".")
    if len(host)>253 or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}",host):
        raise ValueError("Enter the public hostname supplied by the email provider.")
    return host

def dial(host,port,timeout):
    addresses=socket.getaddrinfo(public_host(host),port,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError("The mail server must have a public IP address.")
    last=None
    for family,kind,proto,_,addr in addresses[:3]:
        sock=socket.socket(family,kind,proto);sock.settimeout(timeout)
        try:
            sock.connect(addr)
            return sock
        except OSError as exc:
            last=exc;sock.close()
    raise OSError("Mail server unavailable.") from last

class Inbox(IMAP4_SSL):
    def _create_socket(self,timeout):
        return CTX.wrap_socket(dial(self.host,self.port,timeout),server_hostname=self.host)

class Outgoing(smtplib.SMTP):
    def _get_socket(self,host,port,timeout):
        return dial(host,port,timeout)

class OutgoingSSL(smtplib.SMTP_SSL):
    def _get_socket(self,host,port,timeout):
        return CTX.wrap_socket(dial(host,port,timeout),server_hostname=host)

def login_inbox(c):
    im=Inbox(c["imap"],993,ssl_context=CTX,timeout=TIMEOUT)
    try:
        im.login(c["address"],c["password"])
        if im.select("INBOX",readonly=True)[0]!="OK":raise ValueError("The provider could not open the inbox.")
        return im
    except Exception:
        im.shutdown();raise

def login_sender(c):
    smtp=(OutgoingSSL if c["port"]==465 else Outgoing)(c["smtp"],c["port"],timeout=TIMEOUT)
    try:
        if c["port"]==587:smtp.starttls(context=CTX)
        smtp.login(c["address"],c.get("smtpPassword") or c["password"])
        return smtp
    except Exception:
        smtp.close();raise

def imap_position(im,key):
    values=im.response(key)[1]
    return int(values[0]) if values and values[0] and values[0].isdigit() else None

def verify(c):
    with login_inbox(c) as im:
        validity=imap_position(im,"UIDVALIDITY");next_uid=imap_position(im,"UIDNEXT")
        if not validity or not next_uid:raise ValueError("The provider did not return a sync position.")
    with login_sender(c):pass
    return {"validity":validity,"last":next_uid-1}

def message(mid,address,customer,subject,body,reply=None):
    m=EmailMessage(policy=policy.SMTP);m["From"]=address;m["To"]=customer;m["Subject"]=subject
    m["Message-ID"]=mid;m["Date"]=format_datetime(dt.datetime.now(dt.timezone.utc))
    if reply:m["In-Reply-To"]=reply;m["References"]=reply
    m.set_content(body);return m

def gmail(method,path,token,data=None):
    req=Request(GMAIL+path,method=method,headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"},
                data=json.dumps(data).encode() if data is not None else None)
    with urlopen(req,timeout=TIMEOUT) as r:return json.loads(r.read(MAX_MESSAGE*2+2048))

def send(c,m,thread=None):
    if c["kind"]=="google":
        data={"raw":base64.urlsafe_b64encode(m.as_bytes()).decode()}
        if thread:data["threadId"]=thread
        result=gmail("POST","/messages/send",c["access"],data)
        return result["id"],result["threadId"]
    with login_sender(c) as smtp:smtp.send_message(m)
    return m["Message-ID"],None

def content(m):
    part=m.get_body(preferencelist=("plain","html"))
    if not part:return ""
    try:text=part.get_content()
    except (LookupError,UnicodeError):text=part.get_payload(decode=True).decode("utf8","replace")
    if part.get_content_type()=="text/html":
        from dealer_mail import Text
        parser=Text();parser.feed(text);text="".join(parser.parts)
    return str(text).strip()[:50000]

def ref_ids(m):
    return re.findall(r"<[^<>\s]{1,250}>",str(m.get("References",""))+" "+str(m.get("In-Reply-To","")))
def imap_bytes(im,uid,fields):
    status,parts=im.uid("fetch",str(uid),fields)
    if status!="OK":raise OSError("Message unavailable.")
    return next((x[1] for x in parts if isinstance(x,tuple) and isinstance(x[1],bytes)),b"")

def sync_imap(c,pos,match,receive):
    with login_inbox(c) as im:
        validity=imap_position(im,"UIDVALIDITY");next_uid=imap_position(im,"UIDNEXT")
        if not validity or not next_uid:raise OSError("No mailbox sync position.")
        if pos.get("validity")!=validity:pos={"validity":validity,"last":0}
        start=pos["last"]+1
        if start>=next_uid:return pos
        end=min(start+99,next_uid-1)
        ok,rows=im.uid("search",None,"UID",str(start)+":"+str(end))
        if ok!="OK":raise OSError("Mailbox search unavailable.")
        for uid in (int(x) for x in rows[0].split() if start<=int(x)<=end):
            hdr=email.message_from_bytes(imap_bytes(im,uid,"(BODY.PEEK[HEADER.FIELDS (FROM MESSAGE-ID REFERENCES IN-REPLY-TO SUBJECT DATE)]<0.32000>)"),policy=policy.default)
            sender=parseaddr(str(hdr.get("From","")))[1].lower()
            op=match(sender,ref_ids(hdr))
            if not op:continue
            raw=imap_bytes(im,uid,"(BODY.PEEK[]<0."+str(MAX_MESSAGE)+">)")
            m=email.message_from_bytes(raw,policy=policy.default)
            receive(op,sender,str(m.get("Subject",""))[:300],content(m),str(m.get("Message-ID",""))[:255],str(validity)+":"+str(uid),None)
        return {"validity":validity,"last":end}
