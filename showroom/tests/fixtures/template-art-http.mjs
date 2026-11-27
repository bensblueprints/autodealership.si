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
const firstArt=await (await request("/")).text();
assert.ok(firstArt.includes('id="published-hero"'));
assert.ok(firstArt.includes(asset(art.id,"mobile").slice(1)));
assert.ok(firstArt.includes(asset(art.id,"desktop").slice(1)));
assert.equal((await (await request("/",{host:other})).text()).includes(art.id),false);
const after=await editor();
assert.equal((await save(after,{heroMode:"artwork",heroArtwork:"0".repeat(64)})).status,400);
assert.equal((await pub()).heroArtwork,art.id);
const frame={desktop:"left center",mobile:"right top"};
assert.equal((await save(after,{heroMode:"dealership",heroFocus:{desktop:"auto",mobile:"top"}})).status,400);
assert.equal((await save(after,{heroMode:"dealership",heroFocus:frame})).status,200);
assert.equal((await pub()).heroImage,jpeg);
const links=await (await request("/api/banners?media=links")).json(),imagePath="/"+links.heroImage;
assert.deepEqual(links.heroFocus,frame);
assert.match(imagePath,/^\/api\/dealership-hero\/\d+\.jpg$/);
for(const page of ["/","/index.html","/dealer-preview?layout=independent&skin=pearl"]){
  const html=await (await request(page,{admin:page.startsWith("/dealer-preview")})).text();
  assert.ok(html.includes('id="published-hero"'),page);
  assert.ok(html.includes('src="'+links.heroImage+'"'),page);
  assert.ok(html.includes('--hero-desktop-position:left center;--hero-mobile-position:right top'),page);
  assert.ok(html.includes('data-hero-resolved aria-label="Featured vehicle" hidden'),page);
  assert.ok(!html.includes(jpeg),page);
}
const image=await request(imagePath);
assert.equal(image.status,200);
assert.equal(image.headers.get("content-type"),"image/jpeg");
assert.equal(Buffer.from(await image.arrayBuffer()).toString("base64"),jpeg.split(",")[1]);
const head=await request(imagePath,{method:"HEAD"});
assert.equal(head.status,200);assert.equal(await head.text(),"");
assert.equal((await request(imagePath,{host:other})).status,404);
const oldClient=await editor();delete oldClient.heroFocus;
assert.equal((await save(oldClient,{})).status,200);
assert.deepEqual((await editor()).heroFocus,frame);
assert.equal((await request(imagePath)).status,404);
assert.equal((await save(after,{heroMode:"dealership",heroFocus:frame})).status,409);
assert.equal((await request(asset(art.id,"desktop"))).status,404);
assert.equal((await save(await editor(),{heroMode:"vehicle",heroImage:""})).status,200);
assert.equal((await pub()).heroImage,null);
assert.ok(!(await (await request("/")).text()).includes('id="published-hero"'));
console.log("Verified server-rendered hero, responsive framing, photograph revision, public isolation and old editor compatibility.");
console.log("Verified private preview, manual selection, both crop routes, separate rooftop access, version conflicts and restoration of the dealer's photo.");
