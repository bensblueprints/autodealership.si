import assert from "node:assert/strict";
const main="dealer.qa.test",other="other.qa.test",api="/api/inventory-drafts";
const a="2C4RC1BG1VR599700",b="1FTFW1ET1EFA00001",unknown="1A000000000000044",sold="1A000000000000066";
async function request(path,{host=main,admin=true,method="GET",data,origin}={}){
  const base="http://"+host+":8080";
  return fetch(base+path,{method,headers:{origin:origin||base,"content-type":"application/json",...(admin?{authorization:"Basic "+Buffer.from("dealer:"+(host===main?"qa":"second-fixture")).toString("base64")}:{})},body:data?JSON.stringify(data):undefined});
}
const ingest=(text,options={})=>request(api,{method:"POST",data:{text},...options});
const drafts=async(host=main)=>(await(await request(api,{host})).json());
assert.equal((await request(api,{admin:false})).status,403);
assert.equal((await ingest(a,{origin:"https://wrong.example"})).status,403);
assert.equal((await ingest(Array(26).fill(a).join(" "))).status,422);
assert.equal((await drafts()).total,0);
const result=await(await ingest(" \uFEFF"+a.toLowerCase()+" , "+b+"\r\n"+unknown+"\t"+a+";BAD I0000000000000000 "+sold)).json();
assert.deepEqual([...result.added].sort(),[a,b,unknown].sort());
assert.deepEqual(result.invalid,["BAD","I0000000000000000"]);assert.deepEqual(result.repeated,[a]);
assert.deepEqual(result.existing,[sold]);assert.equal(result.needsLookup,1);
const before=await drafts();
assert.equal(before.total,3);assert.equal(before.rows.find(r=>r.vin===a).specs.Model,"Pacifica");
assert.equal(before.rows.find(r=>r.vin===unknown).specs,null);
assert.equal((await drafts(other)).total,0);
const retries=await Promise.all([ingest(a+" "+b),ingest(b+" "+a)]);for(const r of retries)assert.equal((await r.json()).drafts.length,2);
const c="1A000000000000045",d="1A000000000000046";
const overlap=await Promise.all([ingest(c+" "+d),ingest(d+" "+c)]);
const counts=await Promise.all(overlap.map(async r=>(await r.json()).added.length));assert.equal(counts[0]+counts[1],2);
const publicPaths=["/api/showroom-inventory","/api/dealer-inventory","/assets/cdjr-inventory.js","/sitemap.xml","/feeds/google-vehicles.xml"];
for(const path of publicPaths){const res=await request(path,{admin:path==="/api/dealer-inventory"});assert.equal(res.status,200,path);assert.ok(!(await res.text()).includes(a),path);}
assert.deepEqual((await(await ingest(a,{host:other})).json()).added,[a]);
const car={vin:a,inventoryIntent:"publish-draft",year:2027,make:"CHRYSLER",model:"Pacifica",stock:"INTAKE-1",price:9500};
const publish=extra=>request("/api/client-inventory",{method:"PUT",data:{...car,...extra}});
assert.equal((await publish({stock:""})).status,400);
for(const price of [null,0,-1])assert.equal((await publish({price})).status,422);
assert.equal((await publish({stock:"VIN-COLLISION"})).status,409);
assert.ok((await drafts()).rows.some(r=>r.vin===a));
const saves=await Promise.all([publish({}),publish({})]);assert.deepEqual(saves.map(r=>r.status).sort(),[200,409]);
assert.ok(!(await drafts()).rows.some(r=>r.vin===a));assert.equal((await drafts(other)).total,1);
assert.equal((await(await request("/api/showroom-inventory",{admin:false})).json()).filter(c=>c.vin===a).length,1);
assert.deepEqual((await(await ingest(a)).json()).existing,[a]);
console.log("Verified mixed input, known and unavailable VIN details, concurrent imports, isolation, hidden drafts, validation and exactly-once publication.");
