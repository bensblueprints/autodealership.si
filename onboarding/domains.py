import json,os,re,secrets,subprocess,pathlib,socket,urllib.request
import psycopg
IP="95.216.117.238"
WEB=pathlib.Path("/var/www/autodealership-si")
def txt(name):
    with urllib.request.urlopen("https://dns.google/resolve?type=TXT&name="+name,timeout=8) as r:
        return [a["data"].strip('"') for a in json.load(r).get("Answer",[]) if a["type"]==16]
def reload():
    subprocess.run(["nginx","-t"],check=True);subprocess.run(["systemctl","reload","nginx"],check=True)
def enable(host):
    if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}",host):return False
    target=pathlib.Path("/etc/nginx/conf.d")/("adsi-client-"+host+".conf")
    cert=pathlib.Path("/etc/letsencrypt/live")/host
    if target.exists() and "listen 443 ssl" in target.read_text() and (cert/"fullchain.pem").exists():return True
    if IP not in socket.gethostbyname_ex(host)[2]:return False
    if not target.exists():
        target.write_text("server { listen 80; server_name "+host+"; location ^~ /.well-known/acme-challenge/ {root "+str(WEB)+";} location / {return 503;} }")
        reload()
    subprocess.run(["certbot","certonly","--webroot","-w",str(WEB),"-d",host,"--cert-name",host,"--non-interactive","--keep-until-expiring"],check=True,timeout=150)
    target.write_text("server { listen 80; server_name "+host+"; location ^~ /.well-known/acme-challenge/ {root "+str(WEB)+";} location / {return 308 https://"+host+"$request_uri;} }\nserver { listen 443 ssl; server_name "+host+"; ssl_certificate "+str(cert/"fullchain.pem")+"; ssl_certificate_key "+str(cert/"privkey.pem")+"; client_max_body_size 7m; location / {proxy_pass http://127.0.0.1:18284; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr;} }")
    reload();return True
with psycopg.connect(os.environ["CLIENT_DATABASE_URL"],autocommit=True) as db:
    for slug,domain in db.execute("SELECT slug,domain FROM public.client_sites").fetchall():
        preview=slug+".autodealership.si"
        for host in [preview,domain]:
            if not host:continue
            try:
                if host!=preview and preview not in txt("_autodealership."+host):continue
                if enable(host) and host!=preview:db.execute("UPDATE public.client_sites SET verified_domain=%s WHERE slug=%s AND domain=%s",(host,slug,host))
            except (OSError,ValueError,subprocess.SubprocessError) as e:print(host,type(e).__name__,flush=True)
