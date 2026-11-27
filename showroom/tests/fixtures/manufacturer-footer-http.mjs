import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import pg from "pg";

const pool=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const schema="client_10000000000000000000000000000001";
const host="http://dealer.qa.test:8080",other="http://other.qa.test:8080";
const api="/api/oem-brand-library", brand="qa-marque", permission="Private file use receipt 528";
const admin={authorization:"Basic "+Buffer.from("dealer:qa").toString("base64")};
const headers={...admin,origin:host,"content-type":"application/json"};
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLp8AAAAASUVORK5CYII=";
const digest=createHash("sha256").update(Buffer.from(png,"base64")).digest("hex");
const write=(input,custom=headers)=>fetch(host+api+"?brand="+brand,{method:"POST",headers:custom,body:JSON.stringify(input)});
const upload=revision=>({revision,png:"data:image/png;base64,"+png,sourceNote:"Fixture identity file",rightsNote:permission});
const publish=(revision,sequence,extra={})=>({action:"publish-footer",checked:true,revision,sequence,surface:"light",endsOn:null,...extra});
const path=sequence=>"/manufacturer-marks/"+brand+"/"+sequence+"-"+digest+".png";
async function mode(template){
  await pool.query("UPDATE "+schema+".client_profile SET settings=jsonb_set(settings,'{profile,siteTemplate}',to_jsonb($1::text)) WHERE id=1",[template]);
}
async function report(){
  const response=await fetch(host+"/api/storefront-reports",{method:"POST",headers,body:JSON.stringify({id:crypto.randomUUID()})});
  assert.equal(response.status,201);return (await response.json()).report;
}
try {
  await pool.query("CREATE TABLE IF NOT EXISTS public.oem_brand_references(id text PRIMARY KEY,name text,guidance jsonb,reviewed date)");
  await pool.query("CREATE TABLE IF NOT EXISTS public.oem_brand_reference_art(brand text,object_id int,label text,source_url text,source_digest text,digest text,image bytea)");
  await pool.query("INSERT INTO public.oem_brand_references VALUES($1,$2,$3,current_date) ON CONFLICT DO NOTHING",[brand,"Example & Co",{market:"US",note:"QA",sources:[]}]);
  await mode("franchise");
  assert.equal((await write(upload(0))).status,200);
  assert.equal((await fetch(host+path(1))).status,404);
  assert.equal((await write(publish(1,0),{origin:host,"content-type":"application/json"})).status,403);
  assert.equal((await write(publish(1,0),{...headers,origin:other})).status,403);
  assert.equal((await write(publish(1,0,{checked:false}))).status,422);
  assert.equal((await write(publish(1,0,{endsOn:"2099-02-31"}))).status,422);
  assert.equal((await write(publish(1,0,{endsOn:"2000-01-01"}))).status,422);
  const soon=new Date(Date.now()+2*864e5).toISOString().slice(0,10);
  const requests=await Promise.all([write(publish(1,0,{endsOn:soon})),write(publish(1,0,{endsOn:soon}))]);
  assert.deepEqual(requests.map(r=>r.status).sort(),[200,409]);
  for(const page of ["/","/inventory/","/dealership/contact/","/vehicle.html?stock=2C4RC1BG1VR599700"]){
    const doc=await(await fetch(host+page)).text();
    assert.ok(doc.includes('class="manufacturer-strip"'),"Missing footer at "+page);
    assert.ok(doc.includes('src="'+path(1)+'" alt="Example &amp; Co"'));
    assert.ok(!doc.includes(permission));
  }
  const bytes=await fetch(host+path(1));assert.equal(bytes.status,200);assert.equal(bytes.headers.get("cache-control"),"no-store");
  assert.equal(createHash("sha256").update(Buffer.from(await bytes.arrayBuffer())).digest("hex"),digest);
  assert.equal((await fetch(host+path(1),{method:"HEAD"})).status,200);
  assert.equal((await fetch(other+path(1))).status,404);
  const evidence=await report();assert.ok(evidence.findings.some(f=>f.level==="upcoming" && f.kind==="brand" && f.digest===digest));
  for(const template of ["independent","bhph"]){
    await mode(template);
    assert.equal((await fetch(host+path(1))).status,404);
    assert.ok(!(await(await fetch(host+"/")).text()).includes('class="manufacturer-strip"'));
    assert.equal((await write(publish(1,1))).status,422);
  }
  await mode("franchise");
  await pool.query("UPDATE "+schema+".oem_brand_placements SET ends_on=current_date-1 WHERE brand=$1 AND sequence=1",[brand]);
  assert.equal((await fetch(host+path(1))).status,404);
  assert.ok((await report()).findings.some(f=>f.kind==="brand" && f.description.startsWith("Expired")));
  assert.equal((await write(publish(1,1,{surface:"dark"}))).status,200);
  assert.equal((await write(upload(1))).status,200);
  assert.equal((await fetch(host+path(2))).status,404);
  assert.ok((await report()).findings.some(f=>f.kind==="brand" && f.description.startsWith("Artwork changed")));
  assert.equal((await write(publish(2,2))).status,200);
  assert.equal((await write({action:"withdraw-footer",revision:2,sequence:3})).status,200);
  assert.equal((await fetch(host+path(3))).status,404);
  const history=api+"?scope=history&brand="+brand;
  assert.equal((await fetch(host+history)).status,403);
  const exported=await fetch(host+history,{headers:admin});assert.equal(exported.status,200);
  assert.match(exported.headers.get("content-disposition"),/attachment/);
  const {history:rows}=await exported.json();assert.deepEqual(rows.map(r=>r.published),[false,true,true,true]);
  assert.ok(rows.every(r=>r.actor && r.digest===digest && r.rights_note===permission));
  console.log("Verified franchise-only marks, revision-bound public images, tenant isolation, local expiration, withdrawal, alerts and private approval history.");
}finally{await pool.end();}
