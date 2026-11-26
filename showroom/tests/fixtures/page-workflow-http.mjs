import assert from "node:assert/strict";
import pg from "pg";

const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const site="http://dealer.qa.test:8080", other="http://other.qa.test:8080", basePath="/api/website-pages?key=";
const fixture={authorization:"Basic ZGVhbGVyOnFh"};
const get=async(key,host=site,auth=fixture)=>fetch(host+basePath+key,{headers:auth});
const read=async(key,host=site)=>{const r=await get(key,host);assert.equal(r.status,200);return r.json();};
const change=(key,doc,input,host=site)=>fetch(host+basePath+key,{method:"POST",headers:{...fixture,origin:host,"content-type":"application/json"},body:JSON.stringify({version:doc.version,...input})});
const ok=async(p,status=200)=>{const r=await p;assert.equal(r.status,status,await r.text());};
const publicProfile=async()=>(await (await fetch(site+"/api/dealer-profile")).json()).settings;
const otherDb="client_10000000000000000000000000000002";
try {
  // The second site uses a physical database, as newly onboarded dealers do.
  await db.query("CREATE DATABASE "+otherDb);
  const separate=new pg.Pool({connectionString:"postgres://showroom@database/"+otherDb});
  try{await separate.query("CREATE TABLE client_profile(id integer PRIMARY KEY,settings jsonb,etag text)");}
  finally{await separate.end();}
  await db.query("UPDATE public.client_sites SET database_name=$1,admin_hash=encode(sha256($2::bytea),'hex') WHERE slug='other'",[otherDb,fixture.authorization]);
  assert.equal((await get("events",site,{})).status,403);
  assert.equal((await fetch(site+basePath+"events",{method:"POST",headers:{...fixture,origin:other,"content-type":"application/json"},body:"{}"})).status,403);
  const otherStart=await read("events",other);
  assert.equal(otherStart.history.length,0);
  await ok(change("events",otherStart,{action:"draft",values:{title:"Other dealer private draft",body:"Separate DB",enabled:false,url:""}},other));
  assert.equal((await read("events",other)).draft.values.title,"Other dealer private draft");
  const key="events", path="/news/events/", start=await read(key), baseline=start.live;
  const initial=await (await fetch(site+path)).text();
  const values={...baseline,title:"Editorial QA preview",body:"Text for this dealership only.",enabled:true};
  await ok(change(key,start,{action:"draft",values:{...values,url:"javascript:alert(1)"}}),422);
  const contested=await Promise.all([change(key,start,{action:"draft",values}),change(key,start,{action:"draft",values})]);
  assert.deepEqual(contested.map(x=>x.status).sort(),[200,409]);
  const draft=await read(key);
  assert.equal(draft.draft.values.body,values.body);assert.equal(draft.history.length,0);
  assert.equal(JSON.stringify(await publicProfile()).includes(values.body),false);
  assert.equal(await (await fetch(site+path)).text(),initial);
  assert.equal((await read(key,other)).draft.values.title,"Other dealer private draft");
  await ok(change(key,draft,{action:"publish"}));
  await ok(change(key,draft,{action:"publish"}),409);
  const published=await read(key);assert.equal(published.draft,null);assert.equal(published.history.length,2);
  assert.ok((await (await fetch(site+path)).text()).includes(values.body));
  assert.ok((await (await fetch(site+"/sitemap.xml")).text()).includes(path));
  await ok(change(key,published,{action:"restore",edition:1}));const restored=await read(key);
  assert.deepEqual(restored.draft.values,baseline);assert.equal(restored.live.title,values.title);
  await ok(change(key,restored,{action:"publish"}));
  assert.deepEqual((await read(key)).live,baseline);
  const start2=await read(key);
  await ok(change(key,start2,{action:"draft",values:{...values,enabled:false}}));
  const changed=await publicProfile();
  changed.pages[key].title="Legacy editor update";
  await db.query("UPDATE client_10000000000000000000000000000001.client_profile SET settings=$1,etag='changed' WHERE id=1",[changed]);
  const stale=await read(key);assert.equal(stale.draft.stale,true);await ok(change(key,stale,{action:"publish"}),409);
  await ok(change(key,stale,{action:"draft",values:stale.draft.values}));
  await ok(change(key,await read(key),{action:"publish"}));
  const hidden=await read(key);
  assert.equal((await fetch(site+path)).status,404);
  assert.ok(!(await (await fetch(site+"/sitemap.xml")).text()).includes(path));
  assert.ok(hidden.history.some(r=>r.title==="Legacy editor update"));
  await ok(change(key,hidden,{action:"draft",values:{...values,body:""}}));
  await ok(change(key,await read(key),{action:"publish"}),422);
  await ok(change(key,await read(key),{action:"discard"}));
  for(const template of ["franchise","independent","bhph"]){
    await db.query("UPDATE client_10000000000000000000000000000001.client_profile SET settings=jsonb_set(settings,'{profile,siteTemplate}',to_jsonb($1::text))",[template]);
    const page=await read("new-vehicles");assert.equal(page.visible,template==="franchise");
  }
  assert.equal((await read(key,other)).history.length,0);
  console.log("Page drafts, review, publication, rollback, legacy conflicts, public isolation, concurrent edits, dedicated databases, and three templates passed.");
}finally{await db.end();}
