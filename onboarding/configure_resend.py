"""Register the platform's confidential OAuth client once on the deployment host."""
import fcntl
import json
import os
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet
from resend_connect import BASE, CALLBACK, SCOPE


def configure(platform=False):
    prefix = "PLATFORM_RESEND_" if platform else "RESEND_"
    path = Path("/etc/autodealership-resend-platform.env" if platform else "/etc/autodealership-resend.env")
    with open("/run/lock/autodealership-resend-config.lock","a") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX)
        if path.exists():
            required = {prefix+name for name in ("TOKEN_KEY","CLIENT_ID","CLIENT_SECRET")}
            if not required.issubset(line.partition("=")[0] for line in path.read_text().splitlines()):
                raise RuntimeError("Existing Resend configuration is incomplete.")
            print("Using existing OAuth registration.")
            return
        body = {"client_name":"AutoDealership.SI Sales" if platform else "AutoDealership.SI","client_uri":"https://autodealership.si",
                "redirect_uris":["https://autodealership.si/onboarding/sales-email/callback" if platform else CALLBACK],"response_types":["code"],
                "grant_types":["authorization_code","refresh_token"],
                "token_endpoint_auth_method":"client_secret_basic","scope":"emails:send" if platform else SCOPE}
        request = Request(BASE+"/oauth/register",data=json.dumps(body).encode(),headers={
            "Content-Type":"application/json","User-Agent":"AutoDealership.SI/1"})
        with urlopen(request,timeout=15) as response:
            client=json.load(response)
        fields={prefix+"CLIENT_ID":client["client_id"],prefix+"CLIENT_SECRET":client["client_secret"],
                prefix+"TOKEN_KEY":Fernet.generate_key().decode()}
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
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform",action="store_true",help="Register the separate AutoDealership.SI sales application")
    configure(parser.parse_args().platform)
