import assert from "node:assert/strict";
import pg from "pg";
import {followupTeam} from "/app/showroom.mjs";

const host="http://dealer.qa.test:8080",other="http://other.qa.test:8080";
const basic={authorization:"Basic ZGVhbGVyOnFh"},demoVin="1A000000000000001";
const request=(path,{base=host,method="GET",auth=basic,data,origin=base}={})=>fetch(base+path,{method,headers:{...auth,origin,"content-type":"application/json"},body:data?JSON.stringify(data):undefined});
async function json(response,status){const r=await response;const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
const post=(path,data,auth)=>request(path,{method:"POST",auth,data});
const put=(data,auth,options={})=>request("/api/inquiries",{method:"PUT",auth,data,...options});
const members=[];
for (const name of ["pat","terry"]){
  const data={email:name+"@example.test",password:"only-for-local-fixture-169"};
  const r=await post("/api/dealer-auth/users",data,basic);assert.ok(r.ok,await r.text());
  const login=await post("/api/dealer-auth/signin",data,{});assert.equal(login.status,200);
  members.push({id:"account:"+data.email,auth:{cookie:login.headers.get("set-cookie").split(";")[0]}});
}
const [pat,terry]=members;
const team=await json(request("/api/inquiries/team"),200);
assert.ok(team.members.some(m=>m.id===pat.id) && team.manager);
assert.equal((await json(request("/api/inquiries/team",{auth:pat.auth}),200)).me.id,pat.id);
assert.equal((await request("/api/inquiries/team",{auth:{}})).status,403);
assert.equal((await request("/api/inquiries/team",{base:other,auth:pat.auth})).status,403);
const car={carId:demoVin,name:"Follow-up fixture",phone:"7405550199",message:"Is it available?"};
const lead=await json(post("/api/inquiries",{...car,source:"Vehicle inquiry"},{}),201);
const voice=await json(post("/api/inquiries",{...car,name:"Voice fixture",source:"Voice concierge",requestId:crypto.randomUUID()},{}),201);
const body={id:lead.id,action:"save-follow-up",revision:0,status:"New",owner:pat.id,taskAction:"schedule",kind:"Call shopper",dueAt:"2025-09-30T17:00:00.000Z",note:"Wants to bring a trade."};
assert.equal((await put(body,{},{})).status,403);
assert.equal((await put(body,basic,{origin:other})).status,403);
assert.equal((await put({...body,owner:"account:another-rooftop@example.test"},basic)).status,422);
assert.equal((await put({...body,owner:terry.id},pat.auth)).status,403);
const race=await Promise.all([put(body,basic),put(body,basic)]);
assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
assert.equal((await put({...body,revision:1},terry.auth)).status,403);
assert.equal((await put({...body,revision:1,taskAction:"keep",owner:null},pat.auth)).status,422);
assert.equal((await put({...body,revision:1,status:"Contacted",taskAction:"complete",note:"Called and spoke to the shopper."},pat.auth)).status,200);
const list=await json(request("/api/inquiries"),200),saved=list.find(r=>r.id===lead.id);
assert.equal(saved.status,"Contacted");assert.equal(saved.followUp.task,null);assert.equal(saved.followUp.history,undefined);
const activity=()=>json(request("/api/inquiries/history?id="+lead.id),200);
let events=await activity();assert.equal(events.length,2);assert.equal(events[1].actor.id,pat.id);assert.equal(events[1].completed,true);
assert.equal(events[1].previousTask.kind,"Call shopper");
assert.equal((await request("/api/inquiries/history?id="+lead.id,{auth:{}})).status,403);
assert.equal((await put({...body,id:voice.id,note:"Verified request from web voice."},pat.auth)).status,200);
assert.equal((await put({id:voice.id,status:"Closed"},pat.auth)).status,200);
const closed=(await json(request("/api/inquiries"),200)).find(r=>r.id===voice.id);
assert.equal(closed.followUp.task,null);
assert.equal((await put({...body,revision:2,owner:terry.id,taskAction:"keep"},pat.auth)).status,200);
assert.equal((await put({...body,revision:3},pat.auth)).status,403);
await post("/api/dealer-auth/disable",{email:"pat@example.test"},basic);
assert.equal((await put({...body,revision:3},basic)).status,422);

const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
try{
  await db.query("INSERT INTO public.dealer_sales_rosters VALUES('qa-roster','org_fixture',$1,now())", [JSON.stringify([{id:"clerk:user_a",label:"Fixture staff"}])]);
  const fetchRoster=organization=>followupTeam(db,{site:"qa-roster",organization,manager:false,actor:{id:"clerk:user_a",label:"Dealership staff"}});
  assert.equal((await fetchRoster("org_fixture")).me.label,"Fixture staff");
  assert.equal((await fetchRoster("org_other")).directoryReady,false);
  await db.query("UPDATE public.dealer_sales_rosters SET synced_at=now()-interval '30 minutes' WHERE site='qa-roster'");
  assert.equal((await fetchRoster("org_fixture")).directoryReady,false);
}finally{await db.end();}
console.log("Passed two-rooftop isolation, active staff, expired directories, competing claims, staff handoff, deadline completion, private history and legacy closure for voice and web inquiries.");
