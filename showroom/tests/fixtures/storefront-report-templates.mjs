import assert from "node:assert/strict";
import pg from "pg";
const db=new pg.Pool({connectionString:"postgres://showroom@database/client_10000000000000000000000000000002"});
const origin="http://other.qa.test:8080",schema="public.";
const profile=(await db.query("SELECT settings FROM "+schema+"client_profile WHERE id=1")).rows[0].settings;
try{
  for(const template of ["independent","bhph"]){
    await db.query("UPDATE "+schema+"client_profile SET settings=jsonb_set(settings,'{profile,siteTemplate}',to_jsonb($1::text)) WHERE id=1",[template]);
    const r=await fetch(origin+"/api/storefront-reports",{method:"POST",headers:{origin,authorization:"Basic "+Buffer.from("dealer:second-fixture").toString("base64"),"content-type":"application/json"},body:JSON.stringify({id:crypto.randomUUID()})});
    assert.equal(r.status,201);const {report}=await r.json();
    assert.equal(report.template,template);assert.equal(report.host,"other.qa.test");assert.equal(report.source,"Staff check");
    assert.ok(report.coverage.publishedPages>=1);
    assert.ok(!report.findings.some(f=>f.description.startsWith("Program required")));
  }
  console.log("Verified on-demand reports on independent and Buy Here Pay Here templates.");
}finally{try{await db.query("UPDATE "+schema+"client_profile SET settings=$1 WHERE id=1",[profile]);}finally{await db.end();}}
