// Isolated showroom container with the test provider transport installed before startup.
import assert from "node:assert/strict";
import pg from "pg";
import {createHmac,randomBytes} from "node:crypto";
import {writeFile,readFile} from "node:fs/promises";
const site="http://dealer.qa.test:8080",other="http://other.qa.test:8080",staff={authorization:"Basic ZGVhbGVyOnFh"};
const vin="1A000000000000070",phone="+17405550187",sid=()=>"SM"+randomBytes(16).toString("hex");
const registry={};
const ident=n=>"10000000-0000-0000-0000-00000000000"+n;
for(const n of ["1","2"])registry[ident(n)]={account:"AC"+n.repeat(32),service:"MG"+n.repeat(32),authToken:n.repeat(32),from:n==="1"?"+17405550111":"+17405550112",outbound:true};
const route=registry[ident("1")],routeFile="/tmp/data/sms-routes.json";
async function setRoutes(){await writeFile(routeFile,JSON.stringify(registry),{mode:0o600});}
const req=(url,data,method="GET",auth=staff,host=site)=>fetch(host+url,{method,headers:{...auth,origin:host,"content-type":"application/json"},body:data?JSON.stringify(data):undefined});
async function value(p,status){const r=await p,t=await r.text();assert.equal(r.status,status,t.slice(0,400));return t?JSON.parse(t):null;}
async function lead(name,withConsent,carId=vin){return (await value(req("/api/inquiries",{carId,name,phone,source:"Vehicle inquiry",message:"Can I see this vehicle?",requestTextReply:withConsent,textReplyVersion:"inquiry-text-reply-v1"},"POST",{}),201)).id;}
const draft=(id,text,revision="")=>req("/api/inquiries",{action:"save-text-draft",id,text,revision},"PUT");
const send=(id,revision,auth=staff)=>req("/api/inquiries/texts",{id,revision},"POST",auth);
const thread=id=>value(req("/api/inquiries/texts?id="+id),200);
async function hook(path,fields,{slug="qa",credentials=route,sign=true}={}){
  const params=new URLSearchParams({AccountSid:credentials.account,MessagingServiceSid:credentials.service,...fields});
  const signed="https://"+slug+".autodealership.si"+path+[...params.keys()].sort().map(k=>k+params.get(k)).join("");
  return fetch("http://"+slug+".autodealership.si:8080"+path,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","x-twilio-signature":sign?createHmac("sha1",credentials.authToken).update(signed).digest("base64"):"invalid"},body:params});
}
const incoming=(body,from=phone,id=sid(),extra={})=>({MessageSid:id,From:from,To:route.from,Body:body,...extra});
const receive=async message=>assert.equal((await hook("/api/dealer-sms/incoming",message)).status,200);
async function attempts(){return (await readFile("/tmp/sms-attempts.jsonl","utf8")).trim().split("\n").map(s=>JSON.parse(s));}
// Earlier desk fixtures intentionally provisioned only a subset of this second dealer's tables.
const dedicated=new pg.Client({connectionString:"postgres://showroom@database/client_10000000000000000000000000000002"});
await dedicated.connect();await dedicated.query("CREATE TABLE IF NOT EXISTS shopper_leads(id uuid PRIMARY KEY,body jsonb NOT NULL)");await dedicated.end();
const id=await lead("Text conversation fixture",true),unconsented=await lead("Call only",false);
assert.equal((await req("/api/inquiries/texts",null,"GET",{})).status,403);
const first=await value(draft(id,"Thanks for asking about stock LOT-70."),200);
assert.match((await thread(id)).reason,/not connected/);assert.equal((await send(id,first.revision)).status,409);
await setRoutes();
assert.equal((await draft(unconsented,"No request")).status,409);
assert.equal((await send(id,first.revision,{})).status,403);
assert.equal((await req("/api/inquiries/texts?id="+id,null,"GET",staff,other)).status,404);
const racing=await Promise.all([send(id,first.revision),send(id,first.revision)]);
for(const r of racing)assert.equal(r.status,200);
assert.equal((await attempts()).length,1);
let messages=(await thread(id)).messages;assert.equal(messages.length,1);assert.equal(messages[0].state,"queued");assert.equal(messages[0].stock,"LOT-70");
assert.equal((await value(draft(id,first.text,first.revision),200)).revision,first.revision);
assert.equal((await attempts())[0].StatusCallback,"https://qa.autodealership.si/api/dealer-sms/status?id="+first.revision);
const delivery=(revision,providerId,state,extras={})=>hook("/api/dealer-sms/status?id="+revision,{MessageSid:providerId,MessageStatus:state,From:route.from,To:phone,...extras});
const firstSid=(await attempts())[0].sid;
for(const state of ["delivered","sent","delivered"])assert.equal((await delivery(first.revision,firstSid,state)).status,200);
assert.equal((await thread(id)).messages[0].state,"delivered");
const second=await lead("Second vehicle, same phone",true,"1A000000000000071");
const inbound=incoming("Can I visit on Saturday?");
assert.equal((await hook("/api/dealer-sms/incoming",inbound,{sign:false})).status,403);
assert.equal((await hook("/api/dealer-sms/incoming",inbound,{slug:"other"})).status,403);
await receive(inbound);await receive(inbound);
messages=(await thread(second)).messages;assert.equal(messages.length,2);assert.equal(messages[1].stock,null);assert.equal(messages[1].inquiry,null);assert.equal(messages[1].body,inbound.Body);
const stop=incoming("Please stop",phone,sid(),{OptOutType:"STOP"});await receive(stop);
const next=await value(draft(id,"Ready for a visit?",first.revision),200);
assert.equal((await send(id,next.revision)).status,409);assert.match((await thread(second)).reason,/opted out/);
await receive(incoming("START",phone,sid(),{OptOutType:"START"}));await receive(stop);
assert.match((await thread(id)).reason,/new shopper text request/);
const fresh=await lead("Fresh permission",true),uncertain=await value(draft(fresh,"Lost response"),200);
assert.equal((await value(send(fresh,uncertain.revision),200)).state,"unconfirmed");
await value(send(fresh,uncertain.revision),200);assert.equal((await attempts()).length,2);
assert.equal((await delivery(uncertain.revision,(await attempts())[1].sid,"delivered")).status,200);
await receive(incoming("Is the showroom open?","+17405550194"));
const recent=(await value(req("/api/inquiries/texts"),200)).threads;
const unknown=recent.find(r=>r.phone==="+17405550194");
assert.ok(unknown);assert.equal((await value(req("/api/inquiries/texts?message="+unknown.id),200)).messages[0].body,"Is the showroom open?");
const secondTenant=registry[ident("2")];
assert.equal((await hook("/api/dealer-sms/incoming",{MessageSid:sid(),From:phone,To:secondTenant.from,Body:"Other dealership"},{slug:"other",credentials:secondTenant})).status,200);
assert.deepEqual((await value(req("/api/inquiries/texts",null,"GET",staff,other),200)).threads.map(r=>r.body),["Other dealership"]);
const rejected=await value(draft(fresh,"Carrier rejection",uncertain.revision),200);
assert.equal((await value(send(fresh,rejected.revision),200)).state,"failed");assert.match((await thread(fresh)).reason,/opted out/);
registry[ident("1")].outbound=false;await setRoutes();await receive(incoming("Paused sender can still receive"));
await receive(incoming("START",phone,sid(),{OptOutType:"START"}));registry[ident("1")].outbound=true;await setRoutes();
const browserLead=await lead("SMS browser fixture",true);await writeFile("/tmp/sms-browser-id",browserLead);
console.log("Verified consent, signed two-way SMS, provider retries, stock identity, handset withdrawal, paused senders and independent dealer databases.");
