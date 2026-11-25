import json
import os
from urllib.request import Request, urlopen
import jwt

ISSUER = "https://clerk.autodealership.si"
keys = jwt.PyJWKClient(ISSUER + "/.well-known/jwks.json")

def provider(path):
    req = Request("https://api.clerk.com/v1/" + path, headers={
        "Authorization": "Bearer " + os.environ["CLERK_SECRET_KEY"],
        "User-Agent": "AutoDealership/1",
    })
    with urlopen(req, timeout=8) as response:
        return json.load(response)

def verified_identity(token):
    claims = jwt.decode(token, keys.get_signing_key_from_jwt(token).key,
                        algorithms=["RS256"], issuer=ISSUER,
                        options={"require": ["exp", "iat", "sub", "sid", "azp"]})
    if claims["azp"] != "https://autodealership.si":
        raise ValueError("Unexpected sign-in origin")
    session = provider("sessions/" + claims["sid"])
    if session["status"] != "active" or session["user_id"] != claims["sub"]:
        raise ValueError("Session expired")
    user = provider("users/" + claims["sub"])
    for email in user["email_addresses"]:
        if email["id"] == user["primary_email_address_id"] and email.get("verification", {}).get("status") == "verified":
            return user["id"], email["email_address"].lower()
    raise ValueError("Verify your primary email first")
