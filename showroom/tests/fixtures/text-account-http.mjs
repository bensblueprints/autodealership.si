import assert from "node:assert/strict";
import pg from "pg";
const base="http://dealer.qa.test:8080",admin={authorization:"Basic ZGVhbGVyOnFh"};
const req=(data,auth=admin,host=base)=>fetch(host+"/api/text-account",{method:data?"POST":"GET",headers:{...auth,origin:host,"content-type":"application/json"},body:data?JSON.stringify(data):undefined});
async function read(response,status=200){const r=await response;const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body;}
const db=new pg.Client({connectionString:"postgres://showroom@database/showroom"});await db.connect();
try{
  assert.equal((await req(null,{})).status,403);
  const sign=await fetch(base+"/api/dealer-auth/signin",{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({email:"review.writer@example.test",password:"only-for-local-fixture-169"})});
  assert.equal((await req(null,{cookie:sign.headers.get("set-cookie").split(";")[0]})).status,403);
  const first=await read(req());assert.equal(first.connected,true);
  const {numbers}=await read(req({action:"list"}));assert.equal(numbers.length,2);assert.ok(numbers.every(n=>/^PN/.test(n.sid)));assert.ok(!JSON.stringify(numbers).includes("authToken"));
  const select={action:"import",sid:numbers[0].sid};await read(req(select));await read(req(select));assert.equal((await read(req())).numbers.length,1);
  await read(req({action:"import",sid:"PN"+"0".repeat(32)}),400);
  await db.query("SET search_path TO client_10000000000000000000000000000001");
  const id="b0000000-0000-0000-0000-000000000001",sid="SM"+"7".repeat(32);
  await db.query("INSERT INTO inquiry_sms_messages(id,sid,phone,sender,direction,body,state,stock) VALUES($1,$2,'+17405550145','+17405550111','out','Usage fixture','delivered','QA-SMS')",[id,sid]);
  for(let i=0;i<2;i++)await read(req({action:"reconcile"}));
  const report=await read(req()),line=report.lines.find(r=>r.sid===sid);
  assert.equal(line.segments,3);assert.equal(Number(line.cost),0.0249);assert.equal(line.currency,"USD");assert.equal(report.eligible,3);
  const csv=await fetch(base+"/api/text-account?format=csv",{headers:admin});assert.match(csv.headers.get("content-type"),/text\/csv/);assert.match(await csv.text(),/QA-SMS/);
  assert.equal(Number(report.usd_cost),0.0249);assert.ok(report.pending>=1);
  console.log("Verified authorized import, repeat-safe reconciliation, actual segments and USD costs, unknown prices and salesperson restrictions.");
}finally{await db.end();}
