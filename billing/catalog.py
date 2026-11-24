"""Create the approved Whop catalog for a merchant. Output contains variant IDs only."""
import argparse
import json
import os
import uuid
from pathlib import Path
from server import MERCHANT, KEY, PLANS, ROOT, provider
parser=argparse.ArgumentParser()
parser.add_argument("--account",required=True)
args=parser.parse_args()
if args.account!=MERCHANT or not MERCHANT.startswith("biz_") or not KEY:
    parser.error("Pass the same business ID as WHOP_ACCOUNT_ID and configure its API key.")
catalog_file=ROOT/("catalog-"+os.getenv("WHOP_ENV","production")+"-"+MERCHANT+".json")
catalog=json.loads(catalog_file.read_text()) if catalog_file.exists() else {}
offers={}
for key,(amount,minutes) in PLANS.items():
    for marketing in (False,True):
        name=key+("_marketing" if marketing else "")
        cost=amount+(2500 if marketing else 0)
        offers[name]={"title":"AutoDealership.SI "+key.title()+(" + Managed Marketing" if marketing else ""),"billing_type":"renewal","initial_price":cost,"renewal_price":cost,"billing_period":30}
for amount in (100,500):
    offers["credit_"+str(amount)]={"title":"AutoDealership.SI voice credit $"+str(amount),"billing_type":"one_time","initial_price":amount}
for key,variant in offers.items():
    if key in catalog:continue
    idem=str(uuid.uuid5(uuid.NAMESPACE_URL,MERCHANT+"/autodealership/v1/"+key))
    config=provider("/checkout_configurations",{"account_id":MERCHANT,"variant":{**variant,"account_id":MERCHANT,"currency":"usd"}},idem)
    catalog[key]=config["variant"]["id"]
    temp=catalog_file.with_suffix(".tmp")
    temp.write_text(json.dumps(catalog));temp.replace(catalog_file)
print("WHOP_VARIANTS='"+json.dumps(catalog,separators=(",",":"))+"'")
