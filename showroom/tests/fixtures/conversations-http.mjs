import assert from "node:assert/strict";
import pg from "pg";
const site="http://dealer.qa.test:8080",other="http://other.qa.test:8080",admin={authorization:"Basic ZGVhbGVyOnFh"};
const req=(path,data,method="GET",auth=admin,base=site)=>fetch(base+path,{method,headers:{...auth,origin:base,"content-type":"application/json"},body:data?JSON.stringify(data):undefined});
async function read(p,status=200){const r=await p,data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
async function login(email){const r=await req("/api/dealer-auth/signin",{email,password:"only-for-local-fixture-169"},"POST",{});assert.equal(r.status,200);return {cookie:r.headers.get("set-cookie").split(";")[0]};}
const db=new pg.Client({connectionString:"postgres://showroom@database/showroom"});await db.connect();
try{
  const person={name:"Patty Conversation",phone:"7405550145",email:"patty@example.test",source:"Vehicle inquiry",requestTextReply:true,textReplyVersion:"inquiry-text-reply-v1",message:"Can I see this car?"};
  const ids=[];for(const carId of ["1A000000000000070","1A000000000000071"])ids.push((await read(req("/api/inquiries",{...person,carId},"POST",{}),201)).id);
  const list=await read(req("/api/conversations?search=Patty"));assert.equal(list.items.length,1);const id=list.items[0].id;
  assert.match(list.items[0].stocks,/LOT-70/);assert.match(list.items[0].stocks,/LOT-71/);
  const at="/api/conversations?id="+id,get=(auth=admin)=>read(req(at,null,"GET",auth));
  assert.equal((await req(at,null,"GET",{})).status,403);assert.equal((await req(at,null,"GET",admin,other)).status,404);
  const writer=await login("review.writer@example.test"),terry=await login("terry@example.test");
  const change=(owner,stage,revision,auth=admin)=>req("/api/conversations",{id,owner,stage,revision},"PUT",auth);
  const first=await get();assert.equal(first.timeline.length,2);assert.equal(first.leads.length,2);
  await read(change("account:terry@example.test","Working",0));
  assert.equal((await get(writer)).canEdit,false);assert.equal((await get(terry)).canEdit,true);
  assert.equal((await change("account:review.writer@example.test","Won",1,writer)).status,403);
  const mail={id,request:crypto.randomUUID(),subject:"Your visit",body:"We can show you both cars."};
  assert.equal((await req("/api/conversations/email",mail,"POST",writer)).status,403);
  assert.equal((await req("/api/conversations/email",mail,"POST",terry)).status,409);
  const draft=await read(req("/api/inquiries",{action:"save-text-draft",id:ids[0],revision:"",text:"We have both cars on the lot."},"PUT",terry));
  assert.equal((await req("/api/inquiries/texts",{id:ids[0],revision:draft.revision},"POST",writer)).status,409);
  await read(req("/api/inquiries/texts",{id:ids[0],revision:draft.revision},"POST",admin));
  await db.query("CREATE TABLE IF NOT EXISTS public.dealer_mailboxes(site uuid PRIMARY KEY,domain text,domain_id text,enabled_at timestamptz DEFAULT now(),last_id text); INSERT INTO public.dealer_mailboxes(site,domain,domain_id) VALUES('10000000-0000-0000-0000-000000000001','mail.qa.test','domain_qa') ON CONFLICT DO NOTHING");
  await db.query("CREATE TABLE IF NOT EXISTS public.dealer_email_grants(site uuid PRIMARY KEY,credentials text,domain text,domain_id text,verified boolean,reconnect boolean); INSERT INTO public.dealer_email_grants(site,credentials,domain,domain_id,verified,reconnect) VALUES('10000000-0000-0000-0000-000000000001','fixture','mail.qa.test','domain_qa',true,false) ON CONFLICT(site) DO UPDATE SET domain=excluded.domain,domain_id=excluded.domain_id,verified=true,reconnect=false");
  await read(req("/api/conversations/email",mail,"POST",terry));await read(req("/api/conversations/email",mail,"POST",terry));assert.equal((await req("/api/conversations/email",{...mail,body:"Other message"},"POST",terry)).status,409);
  const detailed=await get();assert.equal(detailed.timeline.filter(m=>m.channel==="Email").length,1);assert.equal(detailed.timeline.filter(m=>m.channel==="SMS").length,1);
  await read(change("account:review.writer@example.test","Appointment",1));assert.equal((await get(terry)).canEdit,false);assert.equal((await get(writer)).canEdit,true);
  assert.equal((await change(null,"Lost",1)).status,409);
  assert.equal((await read(req("/api/conversations?queue=mine&search=Patty",null,"GET",writer))).items.length,1);
  const unknown=(await read(req("/api/conversations?search=17405550194"))).items;assert.equal(unknown.length,1);
  const inbound=await read(req("/api/conversations?id="+unknown[0].id));assert.equal(inbound.leads[0].textReplyRequest.channel,"inbound-sms");assert.equal(inbound.timeline[0].body,"Is the showroom open?");
  console.log("Verified unified SMS and email timelines, automatic opportunities, owner replies, rep reassignment, conflict detection and tenant isolation.");
}finally{await db.end();}
