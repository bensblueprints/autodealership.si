import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {createHmac} from "node:crypto";
const host="http://dealer.qa.test:8080",url="/api/conversations",sid="10000000-0000-0000-0000-000000000001",secret="1".repeat(32);
const account="AC"+secret,app="AP"+secret,voice={enabled:true,app,key:"SK"+secret,secret,from:"+17405550111"};
async function login(email){const r=await fetch(host+"/api/dealer-auth/signin",{method:"POST",headers:{origin:host,"content-type":"application/json"},body:JSON.stringify({email,password:"only-for-local-fixture-169"})});return r.headers.get("set-cookie").split(";")[0];}
const writer=await login("review.writer@example.test"),terry=await login("terry@example.test");
async function request(path,cookie,data,status=200){const r=await fetch(host+path,{method:data?"POST":"GET",headers:{cookie,origin:host,"content-type":"application/json"},body:data?JSON.stringify(data):undefined});const j=await r.json();assert.equal(r.status,status,JSON.stringify(j));return j;}
const id=(await request(url+"?search=Patty",writer)).items[0].id,m={id,request:crypto.randomUUID(),phone:"+17405550999"};
await request(url+"/call",writer,m,409);
await writeFile("/tmp/data/sms-routes.json",JSON.stringify({[sid]:{account,authToken:secret,staffVoice:voice}}));
await request(url+"/call",terry,m,403);
const result=await request(url+"/call",writer,m),[head,encoded,sig]=result.token.split(".");
assert.equal(createHmac("sha256",secret).update(head+"."+encoded).digest("base64url"),sig);
const jwt=JSON.parse(Buffer.from(encoded,"base64url"));assert.equal(jwt.grants.voice.outgoing.application_sid,app);assert.equal(jwt.exp-jwt.iat,120);
await request(url+"/call",writer,m,409);
const parent="CA"+"a".repeat(32),child="CA"+"b".repeat(32),ref="/api/staff-voice/result?id="+m.request;
async function hook(path,data,auth=true,status=200){
 const p=new URLSearchParams({AccountSid:account,CallSid:parent,...data});
 const base="https://qa.autodealership.si"+path+[...p.keys()].sort().map(k=>k+p.get(k)).join("");
 const r=await fetch("http://qa.autodealership.si:8080"+path,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","x-twilio-signature":auth?createHmac("sha1",secret).update(base).digest("base64"):""},body:p});
 assert.equal(r.status,status,path);return r.text();
}
const dial={From:"client:"+jwt.grants.identity,CallRequest:m.request,To:"+17405550999"};
await hook("/api/staff-voice/dial",dial,false,403);await hook("/api/staff-voice/dial",{...dial,From:"client:other"},true,403);
assert.match(await hook("/api/staff-voice/dial",dial),/<Number>\+17405550145<\/Number>/);
await hook(ref,{DialCallStatus:"completed",DialCallSid:child,DialCallDuration:"19"});
await hook(ref,{DialCallStatus:"busy"});
const log=(await request(url+"?id="+id,writer)).timeline.filter(x=>x.channel==="Call");assert.equal(log.length,1);assert.equal(log[0].seconds,19);assert.equal(log[0].state,"completed");
console.log("Verified disabled calling, staff permissions, signed browser token, shopper-bound dial target, signed results and one call log.");
