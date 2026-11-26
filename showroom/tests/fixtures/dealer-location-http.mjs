import assert from "node:assert/strict";
const host="http://dealer.qa.test:8080",other="http://other.qa.test:8080";
const profilePath="/api/dealer-profile";
async function profile(){return (await fetch(host+profilePath)).json();}
function put(data,auth=true){return fetch(host+profilePath,{method:"PUT",headers:{"content-type":"application/json",origin:host,...(auth?{authorization:"Basic ZGVhbGVyOnFh"}:{})},body:JSON.stringify(data)});}
const hours=Object.fromEntries(["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(day=>[day,day==="Mon"?["08:30","17:30"]:null]));
const current=await profile();
const data={...current.settings,revision:current.revision,profile:{...current.settings.profile,street:"350 Local Way",city:"Portsmouth",salesPhone:"(740) 555-0183",servicePhone:"(740) 555-0117 ext. 9",driveTimezone:"America/New_York",driveHours:{...hours,Mon:["13:00","14:00"]},salesHours:hours,serviceHours:{...hours,Mon:["06:00","15:00"]},partsHours:{...hours,Mon:["08:00","12:00"]}},pages:{...current.settings.pages,contact:{enabled:true},directions:{enabled:true,body:"Plan your visit to the showroom."}}};
assert.equal((await put(data,false)).status,403);
let res=await put(data);
assert.equal(res.status,200,await res.text());
const homepage=async origin=>(await fetch(origin+"/")).text();
const entity=html=>[...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(match=>JSON.parse(match[1])).find(node=>node["@type"]==="AutoDealer");
for(const path of ["/","/dealership/contact/","/dealership/hours-directions/"]){
  const response=await fetch(host+path),html=await response.text();
  assert.equal(response.status,200);
  assert.match(html,/6:00 AM – 3:00 PM/);assert.match(html,/8:00 AM – 12:00 PM/);
  assert.match(html,/tel:7405550117;ext=9/);
  assert.doesNotMatch(html,/1:00 PM – 2:00 PM/);
  const schema=entity(html);assert.equal(schema.address.streetAddress,"350 Local Way");
  assert.equal(schema["@id"],"https://dealer.qa.test/#dealership");
  assert.equal(schema.department.length,2);
  if(path!=="/"){assert.match(html,/<div id="page-location"><div class="contact-grid location-grid">/);assert.match(html,/<details class="location-hours" data-department="sales" open>/);}
}
assert.ok(!(await homepage(other)).includes("350 Local Way"));
assert.equal((await fetch(other+"/dealership/hours-directions/")).status,404);
const saved=await profile();
assert.deepEqual(saved.settings.profile.partsHours,data.profile.partsHours);
assert.equal((await put({...data,profile:{...data.profile,partsHours:null}})).status,409);
assert.equal((await put({...data,revision:saved.revision,profile:{...data.profile,serviceHours:{...hours,Mon:["16:00","07:00"]}}})).status,400);
assert.equal((await put({...data,revision:saved.revision,profile:{...data.profile,partsHours:null}})).status,200);
const after=await homepage(host);
assert.doesNotMatch(after,/8:00 AM – 12:00 PM/);
assert.equal(entity(after).department.length,1);
assert.deepEqual((await profile()).settings.profile.driveHours,data.profile.driveHours);
console.log("Passed published HTML, structured dealer and department data, contact routes, access, tenant isolation, profile concurrency, schedule validation and withdrawal.");
