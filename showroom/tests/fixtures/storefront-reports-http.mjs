import assert from "node:assert/strict";
import pg from "pg";
const pool=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const app=await import("/app/showroom.mjs");
const primary="http://dealer.qa.test:8080", other="http://other.qa.test:8080",api="/api/storefront-reports";
const schemas=["client_10000000000000000000000000000001","client_10000000000000000000000000000002"];
const programId=crypto.randomUUID(),request=crypto.randomUUID(),bulletin="private-test-bulletin-7283",vin="2C4RC1BG1VR599700";
function get(path="",opts={}){
  const {host=primary,admin=true,origin=host,post=false,id,...rest}=opts;
  return fetch(host+api+path,{method:post?"POST":"GET",headers:{origin,"content-type":"application/json",...(admin?{authorization:"Basic "+Buffer.from("dealer:"+(host===primary?"qa":"second-fixture")).toString("base64")}:{})},body:post?JSON.stringify({id,...rest}):undefined});
}
function scoped(schema){
  return {async transaction(fn,options){
    const c=await pool.connect();
    try{await c.query(options?.snapshot?"BEGIN ISOLATION LEVEL REPEATABLE READ":"BEGIN");await c.query("SET LOCAL search_path TO "+schema);const result=await fn(c);await c.query("COMMIT");return result;}
    catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  }};
}
const q=(sql,args)=>pool.query(sql.replaceAll("SITE.",schemas[0]+"."),args);
try{
  await q("UPDATE SITE.client_profile SET settings=jsonb_set(jsonb_set(settings,'{profile,siteTemplate}','\"franchise\"'),'{pages,comparisons}',$1::jsonb)",[JSON.stringify({enabled:true,title:"Compare inventory",body:"Sensitive unpublished draft copy",evidenceEdition:87654})]);
  await q("INSERT INTO SITE.homepage_banners(id,revision,config) VALUES(1,1,$1) ON CONFLICT(id) DO UPDATE SET config=excluded.config",[JSON.stringify({enabled:true,slides:[{alt:"Weekend sale",image:"private-data-image-123",link:""}]})]);
  const day=(await pool.query("SELECT to_char(current_date-1,'YYYY-MM-DD') AS start,to_char(current_date+3,'YYYY-MM-DD') AS end")).rows[0];
  const details={title:"Pilot cash offer",brand:"Pilot",market:"OH",source:bulletin,version:"1",startsOn:day.start,endsOn:day.end,disclosure:"Eligible stock only",websiteOffer:{headline:"Cash offer",page:"used-specials",vins:[vin]}};
  await q("INSERT INTO SITE.oem_program_revisions(program_id,revision,state,details,actor) VALUES($1,1,'approved',$2,'fixture')",[programId,details]);
  assert.equal((await get("",{admin:false})).status,403);
  assert.equal((await get("",{post:true,id:request,origin:"https://wrong.example"})).status,403);
  assert.equal((await get("",{post:true,id:"invalid"})).status,400);
  const both=await Promise.all([get("",{post:true,id:request}),get("",{post:true,id:request})]);
  assert.deepEqual(both.map(r=>r.status).sort(),[200,201]);
  const first=await both[0].json(),doc=first.report;
  assert.equal(doc.site,"10000000-0000-0000-0000-000000000001");assert.equal(doc.host,"dealer.qa.test");assert.equal(doc.template,"franchise");assert.equal(doc.source,"Staff check");
  assert.ok(doc.findings.some(f=>f.kind==="banner" && f.description.includes("Program required")));
  assert.ok(doc.findings.some(f=>f.key==="comparisons" && f.level==="attention" && f.description.includes("hidden")));
  assert.ok(doc.findings.some(f=>f.key===programId && f.level==="upcoming" && f.revision===1));assert.ok(doc.coverage.liveOffers>0);
  let publicOffers=await(await fetch(primary+"/api/website-offers")).json();assert.ok(publicOffers.some(o=>o.headline==="Cash offer"));
  await q("INSERT INTO SITE.inventory_status VALUES($1,'sold') ON CONFLICT(vin) DO UPDATE SET status='sold'",[vin]);
  const next=await(await get("",{post:true,id:crypto.randomUUID()})).json();
  assert.ok(next.report.findings.some(f=>f.key===programId && f.level==="attention" && f.description.includes("No eligible")));
  publicOffers=await(await fetch(primary+"/api/website-offers")).json();assert.ok(!publicOffers.some(o=>o.headline==="Cash offer"));
  const stored=await get("?id="+request+"&download=1");assert.equal(stored.status,200);assert.match(stored.headers.get("content-disposition"),/attachment/);
  const raw=await stored.text();assert.deepEqual(JSON.parse(raw),first);
  for(const privateValue of [bulletin,"private-data-image-123","Sensitive unpublished draft copy"])assert.ok(!raw.includes(privateValue));
  assert.equal((await get("?id="+request,{host:other})).status,404);
  const task=()=>app.runStorefrontReport(scoped(schemas[0]),{id:crypto.randomUUID(),daily:true,tenant:true,store:"Pilot",actor:"Scheduled check"});
  const daily=await Promise.all([task(),task()]);assert.equal(daily[0].data.id,daily[1].data.id);
  assert.equal(daily[0].data.report.source,"Daily check");
  const skipped=await app.runStorefrontReport(scoped(schemas[1]),{id:crypto.randomUUID(),daily:true,tenant:true,store:"Other",actor:"Scheduled check"});
  assert.equal(skipped.status,204);
  assert.ok((await(await get()).json()).reports.some(r=>r.id===first.id));
  console.log("Verified rooftop isolation, scoped exports, withheld copy, banner approval, expiry, sold stock, immutable history and concurrent daily checks.");
}finally{await pool.end();}
