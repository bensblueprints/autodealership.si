import assert from "node:assert/strict";
const origin="http://dealer.qa.test:8080";
function call(path,{method="GET",body,admin=false,other=false,headers={}}={}){
  const host=other?"http://other.qa.test:8080":origin;
  return fetch(host+path,{method,headers:{"Content-Type":"application/json",Origin:host,...(admin?{Authorization:"Basic "+Buffer.from(other?"dealer:otherqa":"dealer:qa").toString("base64")} : {}),...headers},body:body&&JSON.stringify(body)});
}
const api="/api/oem-programs",id=crypto.randomUUID();
const send=(action,revision,more={})=>call(api,{admin:true,method:"POST",body:{id,action,revision,...more}});
const draft={brand:"Fixture Motors",market:"US Midwest",title:"Fixture weekend",source:"Private source bulletin #4",version:"4",startsOn:"2020-01-01",endsOn:"2090-12-31",disclosure:"Offer terms for this market.",acceptance:"Private written reference 77"};
async function setLayout(name){
  const profile=await(await call("/api/dealer-profile")).json();
  const body={...profile.settings,revision:profile.revision,profile:{...profile.settings.profile,siteTemplate:name}};
  assert.equal((await call("/api/dealer-profile",{admin:true,method:"PUT",body})).status,200);
}
let revision=(await(await call("/api/banner-editor",{admin:true})).json()).revision;
async function save(slides){
  const r=await call("/api/banner-editor",{admin:true,method:"PUT",body:{enabled:true,slides,revision}});
  assert.equal(r.status,200);revision=(await r.json()).revision;
}
const publicSlides=async()=>(await(await call("/api/banners")).json()).slides;
const slide={image:"data:image/jpeg;base64,/9j/2Q==",alt:"Sale",link:"/inventory/"};
assert.equal((await call(api)).status,403);assert.equal((await call(api+"?export="+id)).status,403);
assert.equal((await call(api,{method:"POST",body:{},admin:true,headers:{Origin:"https://other.example"}})).status,403);
await setLayout("independent");await save([slide]);assert.equal((await publicSlides()).length,1);
await setLayout("franchise");assert.equal((await publicSlides()).length,0);
assert.equal((await send("save",0,{details:draft})).status,200);
assert.equal((await send("approve",1,{checked:true})).status,200);
slide.program={id,revision:2};await save([slide]);
assert.equal((await publicSlides()).length,0);
assert.equal((await send("approve-artwork",2,{index:0,bannerRevision:revision,checked:true})).status,200);
const publicResponse=await call("/api/banners"),text=await publicResponse.text();
assert.match(text,/Offer terms for this market/);assert.doesNotMatch(text,/Private|program_id|fixture weekend/i);
assert.equal((await call("/api/banners",{headers:{"If-None-Match":publicResponse.headers.get("ETag")}})).status,304);
assert.equal((await call(api+"?export="+id,{admin:true,other:true})).status,404);
const history=await call(api+"?export="+id,{admin:true});
assert.match(history.headers.get("content-disposition"),/attachment/);
assert.equal((await history.json()).approvals[0].creative.image,slide.image);
await save([{...slide,link:"/changed/"}]);assert.equal((await publicSlides()).length,0);
await save([slide]);assert.equal((await publicSlides()).length,1);
assert.equal((await send("withdraw",2)).status,200);assert.equal((await publicSlides()).length,0);
await setLayout("independent");assert.equal((await publicSlides()).length,0);
console.log("HTTP checks passed for editor permissions, private evidence isolation, exact artwork, disclosure rendering data, conditional requests, franchise gating and withdrawal.");
