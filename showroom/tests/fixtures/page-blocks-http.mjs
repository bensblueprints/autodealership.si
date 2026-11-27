import assert from "node:assert/strict";

const host="http://dealer.qa.test:8080", other="http://other.qa.test:8080", admin={authorization:"Basic ZGVhbGVyOnFh"};
async function request(path,{auth=admin,method="GET",data,base=host,status=200}={}){
  const r=await fetch(base+path,{method,headers:{origin:base,"content-type":"application/json",...auth},body:data===undefined?undefined:JSON.stringify(data)});
  assert.equal(r.status,status,await r.clone().text());return r;
}
const key="careers", url="/dealership/careers/", desk="/api/website-pages?key=";
const get=async(k=key)=> (await request(desk+k)).json();
const mutate=async(action,extra={},auth=admin,status=200,k=key)=>request(desk+k,{auth,method:"POST",data:{action,version:(await get(k)).version,...extra},status});
const readPublic=async(path=url)=> (await request(path,{auth:{}})).text();
const profile=async(template,changes={})=>{
  const {revision,settings}=await(await request("/api/dealer-profile")).json();
  return request("/api/dealer-profile",{method:"PUT",data:{...settings,revision,profile:{...settings.profile,siteTemplate:template},...changes}});
};
const sign=await request("/api/dealer-auth/signin",{method:"POST",auth:{},data:{email:"review.writer@example.test",password:"only-for-local-fixture-169"}});
const staff={cookie:sign.headers.get("set-cookie").split(";")[0]};
const blocks=[{kind:"section",heading:"Visit our showroom",text:"Call the sales team first."},{kind:"checklist",heading:"For your visit",text:"Bring your license\nBring your questions"},{kind:"question",heading:"Can I choose a time?",text:"Use the schedule on the vehicle page. <b>Dealer note</b>"}];
const content={enabled:true,title:"Visiting the dealership",body:"",url:"",blocks};
await profile("franchise");
await mutate("draft",{values:{...content,blocks:[{kind:"section",heading:"",text:"Unfinished"}]}},staff);
await mutate("submit",{},staff,422);
await mutate("draft",{values:{...content,blocks:Array(13).fill(blocks[0])}},staff,422);
await mutate("draft",{values:content},staff);
await mutate("submit",{},staff);await mutate("publish",{checked:true},staff,403);
await request(url,{auth:{},status:404});
await mutate("return",{note:"Lead with the shopper question."});
const ordered=[blocks[2],blocks[0],blocks[1]];
await mutate("draft",{values:{...content,blocks:ordered}},staff);
await mutate("submit",{},staff);await mutate("publish",{checked:true});
const html=await readPublic();
assert.match(html,/<details class="page-question"><summary>Can I choose a time\?<\/summary>/);
assert.match(html,/<li>Bring your license<\/li><li>Bring your questions<\/li>/);
assert.ok(html.includes("&lt;b&gt;Dealer note&lt;/b&gt;"));assert.ok(html.indexOf("<summary>Can I choose")<html.indexOf("<h2>Visit our showroom"));
const history=await(await request(desk+key+"&export=review-history")).json();assert.deepEqual(history.records.at(-1).content.blocks,ordered);
await request(url,{auth:{},base:other,status:404});
const approved=(await get()).history[0].edition;
await mutate("draft",{values:{...content,body:"Edited using an older client.",blocks:undefined}});
assert.deepEqual((await get()).draft.values.blocks,ordered);
await mutate("discard");
for(const template of ["independent","bhph"]){
  await profile(template);
  await mutate("draft",{values:{...content,body:"Legacy introduction",blocks:[]}},staff);await mutate("publish",{},staff);
  assert.ok(!(await readPublic()).includes("Can I choose a time?"));
  await mutate("restore",{edition:approved},staff);await mutate("publish",{},staff);
  assert.deepEqual((await get()).live.blocks,ordered);
  const {revision,settings}=await(await request("/api/dealer-profile")).json();
  const pages=structuredClone(settings.pages);delete pages[key].blocks;
  await request("/api/dealer-profile",{method:"PUT",data:{...settings,revision,pages}});
  assert.deepEqual((await get()).live.blocks,ordered);
}
const inventory="pre-owned",previous=(await get(inventory)).live;
await mutate("draft",{values:{...previous,enabled:true,blocks:[blocks[1]]}},staff,200,inventory);await mutate("publish",{},staff,200,inventory);
assert.match(await readPublic("/inventory/used/"),/inventory-page-blocks.*<li>Bring your license<\/li>/s);
console.log("Passed block-only pages, editorial review, private drafts, reordering, escaped text, older editors, restoration, inventory HTML, and three dealer templates.");
