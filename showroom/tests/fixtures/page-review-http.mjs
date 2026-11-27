import assert from "node:assert/strict";

const site="http://dealer.qa.test:8080",other="http://other.qa.test:8080",manager={authorization:"Basic ZGVhbGVyOnFh"};
const profile="/api/dealer-profile", key="community", pageUrl="/dealership/community/", path="/api/website-pages?key="+key;
const queue="/api/website-pages?view=review-queue";
const req=(url,auth={},method="GET",data,host=site)=>fetch(host+url,{method,headers:{origin:host,"content-type":"application/json",...auth},body:data===undefined?undefined:JSON.stringify(data)});
async function check(response,code=200){const r=await response;assert.equal(r.status,code,await r.clone().text());return r;}
async function json(p){return (await check(p)).json();}
async function login(email){
  const data={email,password:"only-for-local-fixture-169"};
  const r=await check(req("/api/dealer-auth/signin",{},"POST",data));
  return {cookie:r.headers.get("set-cookie").split(";")[0]};
}
async function changeProfile(template,auth=manager,patch={}){
  const {settings,revision}=await json(req(profile));
  return req(profile,auth,"PUT",{...settings,revision,profile:{...settings.profile,siteTemplate:template},...patch});
}
const doc=(auth=manager)=>json(req(path,auth));
const act=(action,version,auth,extra={})=>req(path,auth,"POST",{action,version,...extra});
await check(req("/api/dealer-auth/users",manager,"POST",{email:"review.writer@example.test",password:"only-for-local-fixture-169"}),201);
const writer=await login("review.writer@example.test"),colleague=await login("terry@example.test");
await check(changeProfile("franchise",writer),403);await check(changeProfile("franchise"));
await check(req(queue),403);await check(req(path+"&export=review-history"),403);
const first=await doc(writer);assert.equal(first.franchise,true);assert.equal(first.manager,false);assert.equal((await doc(manager)).manager,true);
const values={enabled:true,title:"Local buying guide",body:"First draft with a claim for review.",url:"https://example.test/walkthrough"};
await check(act("draft",first.version,writer,{values}));
assert.ok((await json(req(queue,manager))).drafts.some(row=>row.key===key && row.title===values.title));
const v=(await doc(writer)).version;
await check(act("publish",v,writer,{checked:true,manager:true}),403);
await check(act("submit",v,writer));let pending=await doc(writer);
assert.equal(pending.canWithdraw,true);assert.equal((await doc(colleague)).canWithdraw,false);
assert.ok((await json(req(queue,manager))).pages.some(r=>r.key===key && r.state==="pending"));
assert.ok(!(await json(req(queue,manager))).drafts.some(r=>r.key===key));
await check(act("withdraw",pending.version,colleague),403);await check(act("return",pending.version,writer,{note:"Writer"}),403);
await check(act("draft",pending.version,manager,{values}),409);await check(act("publish",pending.version,manager),422);
await check(act("return",pending.version,manager,{note:" "}),422);
await check(act("withdraw",pending.version,writer));await check(act("submit",(await doc()).version,writer));
pending=await doc();
await check(act("return",pending.version,manager,{note:"Use the published dealer hours."}));
let returned=await doc(writer);assert.equal(returned.review.state,"returned");assert.equal(returned.review.note,"Use the published dealer hours.");
await check(act("publish",returned.version,manager,{checked:true}),409);await check(act("draft",returned.version,writer,{values}),422);
const final={...values,body:"Shop online or see our published sales hours before visiting."};
await check(act("draft",returned.version,writer,{values:final}));await check(act("submit",(await doc()).version,writer));
await check(act("publish",pending.version,manager,{checked:true}),409);
const settings=(await json(req(profile))).settings;
for(const auth of [writer,manager])await check(changeProfile("franchise",auth,{pages:{...settings.pages,[key]:final}}),409);
await check(changeProfile("bhph",writer),403);await check(changeProfile("franchise",writer));
assert.ok(!(await(await req(pageUrl)).text()).includes(final.body));
const next=(await doc()).version;
const results=await Promise.all([act("publish",next,manager,{checked:true}),act("publish",next,manager,{checked:true})]);
assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
const html=await(await check(req(pageUrl))).text();assert.ok(html.includes(final.body));assert.ok(!html.includes("Use the published dealer hours."));
const exported=await json(req(path+"&export=review-history",manager));
assert.deepEqual(exported.records.map(r=>r.action),["submit","withdraw","submit","return","submit","approve"]);
assert.equal(exported.records[0].content.body,values.body);assert.equal(exported.records.at(-1).content.body,final.body);
assert.equal(exported.records.at(-1).author,"review.writer@example.test");assert.equal(exported.records.at(-2).revision,exported.records.at(-1).revision);assert.ok(exported.records.at(-1).edition>0);
assert.deepEqual((await json(req(path+"&export=review-history",manager,"GET",undefined,other))).records,[]);
assert.ok(!(await json(req(queue,manager))).pages.some(r=>r.key===key));
for(const template of ["independent","bhph"]){
  await check(changeProfile(template));const d=await doc(writer);
  await check(act("draft",d.version,writer,{values:{...final,title:template+" buying guide"}}));await check(act("publish",(await doc()).version,writer));
}
await check(changeProfile("franchise"));const d=await doc(writer);
await check(act("draft",d.version,writer,{values:{...final,title:"Franchise review preview"}}));await check(act("submit",(await doc()).version,writer));
console.log("Verified franchise page review, revision requests, approval evidence, stale writes, role enforcement, legacy profile protection and independent publishing.");
