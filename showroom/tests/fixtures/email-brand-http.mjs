import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import pg from "pg";
const origin="http://dealer.qa.test:8080";
const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const admin={authorization:"Basic ZGVhbGVyOnFh"};
async function invoke(path,headers={},method="GET",site=origin,same=site){
  return fetch(site+path,{method,headers:{...headers,origin:same,"content-type":"application/json"},body:method==="POST"?"{}":undefined});
}
try {
  for(const [headers,site,same] of [[{},origin,origin],[admin,origin,"http://other.qa.test:8080"],[admin,"http://other.qa.test:8080","http://other.qa.test:8080"]]){
    assert.equal((await invoke("/api/dealer-email/setup",headers,"POST",site,same)).status,403);
  }
  const response=await invoke("/api/dealer-email/setup",admin,"POST");
  assert.equal(response.status,200);
  const {url}=await response.json();
  assert.match(url,/^https:\/\/autodealership\.si\/onboarding\/email#[A-Za-z0-9_-]{43}$/);
  const hash=createHash("sha256").update(new URL(url).hash.slice(1)).digest("hex");
  assert.equal((await db.query("SELECT site::text FROM public.dealer_email_tickets WHERE token=$1 AND expires>now()", [hash])).rows[0].site,"10000000-0000-0000-0000-000000000001");
  assert.equal((await invoke("/api/oem-brand-library")).status,403);
  const library=await invoke("/api/oem-brand-library",admin);
  const json=await library.json();assert.equal(library.status,200);
  assert.equal(json.brands.length,31);assert.equal(json.brands.reduce((sum,b)=>sum+b.artwork.length,0),6);
} finally {await db.end();}
console.log("Verified manager-only rooftop email setup handoff and private 31-brand catalog over HTTP.");
