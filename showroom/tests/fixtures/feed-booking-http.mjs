// Runs against the disposable PostgreSQL fixture dealer. Requires no Google account.
import assert from "node:assert/strict";
const root="http://dealer.qa.test:8080";
const vin="1A000000000000001";
async function call(path,{admin=false,method="GET",data,host=root}={}){
  return fetch(host+path,{method,headers:{"Content-Type":"application/json",Origin:host,...(admin?{Authorization:"Basic ZGVhbGVyOnFh"}:{})},body:data&&JSON.stringify(data)});
}
const xml=()=>call("/feeds/google-vehicles.xml");
const events=()=>call("/api/conversions.csv",{admin:true}).then(r=>r.text());
const report=()=>call("/api/dealer-marketing",{admin:true}).then(r=>r.json());
const state=value=>call("/api/inventory-status",{admin:true,method:"PUT",data:{vin,status:value}});
const drive="/api/test-drives?vin="+vin;
const book=(entry)=>call(drive,{method:"POST",data:entry});
assert.equal((await call("/api/vehicle-feed-status")).status,403);
assert.equal((await call("/api/conversions.csv")).status,403);
assert.equal((await call("/feeds/google-vehicles.xml",{host:"http://other.qa.test:8080"})).status,404);
assert.equal((await xml()).status,404);
async function settings(template,code="Rooftop01"){
  const profile=await(await call("/api/dealer-profile")).json();
  const data={...profile.settings,revision:profile.revision,profile:{...profile.settings.profile,googleStoreCode:code,siteTemplate:template}};
  const r=await call("/api/dealer-profile",{method:"PUT",admin:true,data});assert.equal(r.status,200,await r.text());
}
for(const [key,link] of [["franchise","/inventory/new/"],["independent","/inventory/under-20000/"],["bhph","/inventory/used/"]]){
  await settings(key);
  const home=await(await call("/")).text();
  assert.ok(home.includes('data-store-template="'+key+'"'));assert.ok(home.includes('href="'+link+'"'));
}
let r=await xml();assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/no-store/);
let text=await r.text();assert.ok(text.includes("<g:vin>"+vin+"</g:vin>"));assert.match(text,/<g:price>7100.37 USD/);
assert.match(text,/&amp;store=\{store_code\}/);assert.match(text,/<g:store_code>Rooftop01</);
const publicPage=await(await call("/vehicle.html?stock="+vin)).text();
assert.equal(JSON.parse(publicPage.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]).offers.price,"7100.37");
const times=(await(await call(drive)).json()).slots;
assert.ok(times.length>=3);
const entry={requestId:crypto.randomUUID(),name:"Test shopper",email:"qa@example.test",phone:"7405550100",message:"QA only",slot:times[0],channel:"concierge"};
const before=(await report()).report.bookings;
const pair=await Promise.all([book(entry),book(entry)]);
assert.deepEqual(pair.map(r=>r.status).sort(),[200,201]);
const [one,two]=await Promise.all(pair.map(r=>r.json()));
assert.equal(one.confirmation,two.confirmation);assert.equal(one.noteToken,two.noteToken);assert.equal(one.eventId,two.eventId);
assert.equal((await book({...entry,message:"Another payload"})).status,409);
assert.equal((await book({...entry,slot:times[1]})).status,409);
assert.equal((await book({...entry,requestId:crypto.randomUUID(),phone:"1"})).status,400);
assert.equal((await report()).report.bookings,before+1);
const contest=await Promise.all([book({...entry,requestId:crypto.randomUUID(),slot:times[1]}),book({...entry,requestId:crypto.randomUUID(),slot:times[1]})]);
assert.deepEqual(contest.map(r=>r.status).sort(),[201,409]);
const csv=await events();assert.equal(csv.split(one.eventId).length,2);assert.ok(csv.includes('"concierge"'));
assert.ok(!csv.includes(entry.email)&&!csv.includes(entry.phone)&&!csv.includes(one.noteToken));
assert.equal((await state("sold")).status,200);
assert.doesNotMatch(await(await xml()).text(),/<item>/);
assert.equal((await call("/vehicle.html?stock="+vin)).status,404);
assert.equal((await book({...entry,requestId:crypto.randomUUID(),slot:times[2]})).status,409);
assert.equal((await book(entry)).status,200);
assert.equal((await report()).report.bookings,before+2);
assert.equal((await state("available")).status,200);
assert.match(await(await xml()).text(),/<item>/);
await settings("franchise","");
assert.equal((await xml()).status,404);
console.log("Passed feed configuration, three templates, rooftop isolation, cash-price/VDP parity, sale/relist, retries, races, invalid requests and conversion export.");
