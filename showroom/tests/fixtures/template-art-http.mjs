// Run against the disposable two-dealer PostgreSQL fixture with the template art pack imported.
import assert from "node:assert/strict";
const origin="http://dealer.qa.test:8080", other="http://other.qa.test:8080";
const request=(path,{admin=false,host=origin,method="GET",data}={})=>fetch(host+path,{method,headers:{Origin:host,"Content-Type":"application/json",...(admin?{Authorization:"Basic "+Buffer.from("dealer:qa").toString("base64")}:{})},body:data&&JSON.stringify(data)});
const editor=()=>request("/api/banner-editor",{admin:true}).then(r=>r.json());
const pub=()=>request("/api/banners").then(r=>r.json());
const asset=(id,size)=>"/api/template-art/"+id+"/"+size+".jpg";
const previous=await editor();
const jpeg="data:image/jpeg;base64,/9j/2Q==";
assert.equal(previous.art.length,3);
assert.ok(!(await pub()).art);
const save=(row,changes)=>request("/api/banner-editor",{admin:true,method:"PUT",data:{...row,...changes}});
for(const candidate of previous.art){
  assert.equal((await request(asset(candidate.id,"desktop"))).status,404);
  const path=asset(candidate.id,"mobile");
  const preview=await request(path,{admin:true});
  assert.equal(preview.status,200);assert.equal(preview.headers.get("content-type"),"image/jpeg");
  assert.equal(Buffer.from(await preview.arrayBuffer()).readUInt16BE(0),0xffd8);
}
const art=previous.art[0],one=await save(previous,{heroMode:"artwork",heroArtwork:art.id,heroImage:jpeg});
assert.equal(one.status,200);assert.equal((await pub()).heroArtwork,art.id);assert.equal((await pub()).heroImage,null);
assert.equal((await save(previous,{heroMode:"artwork",heroArtwork:previous.art[1].id})).status,409);
for(const size of ["mobile","desktop"]){
  assert.equal((await request(asset(art.id,size))).status,200);
  assert.equal((await request(asset(art.id,size),{host:other})).status,404);
}
assert.equal((await request(asset(previous.art[1].id,"desktop"))).status,404);
const after=await editor();
assert.equal((await save(after,{heroMode:"artwork",heroArtwork:"0".repeat(64)})).status,400);
assert.equal((await pub()).heroArtwork,art.id);
assert.equal((await save(after,{heroMode:"dealership"})).status,200);
assert.equal((await pub()).heroImage,jpeg);
assert.equal((await request(asset(art.id,"desktop"))).status,404);
assert.equal((await save(await editor(),{heroMode:"vehicle",heroImage:""})).status,200);
assert.equal((await pub()).heroImage,null);
console.log("Verified private preview, manual selection, both crop routes, separate rooftop access, version conflicts and restoration of the dealer's photo.");
