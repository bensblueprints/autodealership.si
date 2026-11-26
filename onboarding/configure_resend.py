"""Register the platform's confidential OAuth client once on the deployment host."""
import fcntl
import json
import os
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet
from resend_connect import BASE, CALLBACK, SCOPE


def configure():
    path = Path("/etc/autodealership-resend.env")
    with open("/run/lock/autodealership-resend-config.lock","a") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX)
        if path.exists():
            required = {"RESEND_TOKEN_KEY","RESEND_CLIENT_ID","RESEND_CLIENT_SECRET"}
            if not required.issubset(line.partition("=")[0] for line in path.read_text().splitlines()):
                raise RuntimeError("Existing Resend configuration is incomplete.")
            print("Using existing OAuth registration.")
            return
        body = {"client_name":"AutoDealership.SI","client_uri":"https://autodealership.si",
                "redirect_uris":[CALLBACK],"response_types":["code"],
                "grant_types":["authorization_code","refresh_token"],
                "token_endpoint_auth_method":"client_secret_basic","scope":SCOPE}
        request = Request(BASE+"/oauth/register",data=json.dumps(body).encode(),headers={
            "Content-Type":"application/json","User-Agent":"AutoDealership.SI/1"})
        with urlopen(request,timeout=15) as response:
            client=json.load(response)
        fields={"RESEND_CLIENT_ID":client["client_id"],"RESEND_CLIENT_SECRET":client["client_secret"],
                "RESEND_TOKEN_KEY":Fernet.generate_key().decode()}
        with tempfile.NamedTemporaryFile(mode="w",dir=path.parent,delete=False) as out:
            for key,value in fields.items():
                if not value or not all(c.isalnum() or c in "-._~=+/" for c in value):
                    raise ValueError("Unexpected credential format.")
                out.write(key+"="+value+"\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(out.name,path)
        print("Platform OAuth client registered. Credentials saved.")


if __name__ == "__main__":
    configure()
