import assert from "node:assert/strict";
import pg from "pg";
import {createHash} from "node:crypto";
const host="http://dealer.qa.test:8080",id="10000000-0000-0000-0000-000000000001",url="/api/conversations";
const db=new pg.Client({connectionString:"postgres://showroom@database/showroom"});await db.connect();
async function req(path,auth,data,status=200){
 const r=await fetch(host+path,{method:data?"POST":"GET",headers:{...auth,origin:host,"content-type":"application/json"},body:data?JSON.stringify(data):undefined});
 const j=await r.json();assert.equal(r.status,status,JSON.stringify(j));return j;
}
async function login(email){const r=await fetch(host+"/api/dealer-auth/signin",{method:"POST",headers:{origin:host,"content-type":"application/json"},body:JSON.stringify({email,password:"only-for-local-fixture-169"})});assert.equal(r.status,200);return {cookie:r.headers.get("set-cookie").split(";")[0]};}
try{
 const writer=await login("review.writer@example.test"),terry=await login("terry@example.test"),shared={authorization:"Basic ZGVhbGVyOnFh"};
 await req(url+"/inbox",{},null,403);await req(url+"/inbox",shared,{},409);
 const {url:setup}=await req(url+"/inbox",writer,{actor:"account:terry@example.test",site:"ignored"});
 const hash=createHash("sha256").update(new URL(setup).hash.slice(1)).digest("hex");
 const ticket=(await db.query("SELECT site,actor FROM public.staff_mail_tickets WHERE token=$1",[hash])).rows[0];
 assert.deepEqual(ticket,{site:id,actor:"account:review.writer@example.test"});
 const {personal}=await req(url+"/inbox",writer);assert.equal(personal.address,"writer@qa.example");assert.equal(personal.credentials,undefined);
 assert.equal((await req(url+"/inbox",terry)).personal,null);
 const lead=(await req(url+"?search=Patty",writer)).items[0];
 const m={id:lead.id,request:crypto.randomUUID(),sender:personal.id,subject:"A personal response",body:"Your vehicle is available."};
 await req(url+"/email",terry,m,403);await req(url+"/email",writer,{...m,sender:crypto.randomUUID()},409);
 await req(url+"/email",writer,m);await req(url+"/email",writer,m);await req(url+"/email",writer,{...m,sender:"shared"},409);
 const timeline=(await req(url+"?id="+lead.id,writer)).timeline.filter(x=>x.subject===m.subject);assert.equal(timeline.length,1);assert.equal(timeline[0].state,"staff queued");assert.equal(timeline[0].actor,personal.address);
 console.log("Verified staff ticket scope, separate senders, permission checks and idempotency.");
}finally{await db.end();}
