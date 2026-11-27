import assert from "node:assert/strict";
import pg from "pg";

const site="http://dealer.qa.test:8080",other="http://other.qa.test:8080";
const desk="/api/website-pages?key=",profile="/api/dealer-profile",queue="/api/website-pages?view=review-queue";
const admin={authorization:"Basic ZGVhbGVyOnFh"},key="comparisons",path="/inventory/comparisons/";
async function request(route,{method="GET",data,auth=admin,status=200,host=site}={}){
  const r=await fetch(host+route,{method,headers:{origin:host,"content-type":"application/json",...auth},body:data===undefined?undefined:JSON.stringify(data)});
  assert.equal(r.status,status,method+" "+route+" "+(r.status===status?"":(await r.text()).slice(0,260)));
  return r;
}
const doc=async(k=key)=>(await request(desk+k)).json();
const pub=async()=>(await request(profile,{auth:{}})).json();
const page=async()=> (await request(path,{auth:{}})).text();
async function edit(action,extra={},status=200,auth=admin,k=key){
  return (await request(desk+k,{method:"POST",auth,data:{action,version:(await doc(k)).version,...extra},status})).json();
}
async function template(name){
  const {settings,revision}=await pub();
  await request(profile,{method:"PUT",data:{...settings,revision,profile:{...settings.profile,siteTemplate:name}}});
}
const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const schema="client_10000000000000000000000000000001.";
const vin="1A000000000000812",stock="SOURCE-812",otherVin="1A000000000000813",id=crypto.randomUUID();
const quote="Stock SOURCE-812 has AWD",incentive="1.9% APR on this vehicle",disclosure="Qualified buyers only. See dealer for terms.";
const program={brand:"QA",market:"Midwest",title:"Reviewed offer",source:"Private bulletin SOURCE-QA",version:"P12",acceptance:"",
  startsOn:"2020-01-01",endsOn:"2099-12-31",disclosure,websiteOffer:{page:"used-specials",headline:incentive,vins:[vin]}};
const spec={type:"vehicle",vin,field:"drivetrain",expected:"AWD",quote};
const offer={type:"financial",quote:incentive,vin,program:id,revision:2};
const evidence={ai:true,claims:[spec,offer]};
const values={enabled:true,title:"Comparing vehicles",url:"",body:quote+".\n"+stock+" · "+incentive+".\n"+disclosure,evidence};
const checked={checked:true,evidenceChecked:true};
const oem=(action,revision,extra={})=>request("/api/oem-programs",{method:"POST",data:{action,id,revision,...extra}});
try{
  const baseline=await pub();
  await request(profile,{method:"PUT",data:{...baseline.settings,revision:baseline.revision,financingEnabled:true,
    options:{...baseline.settings.options,finance:true,aprFinancingEnabled:true},profile:{...baseline.settings.profile,siteTemplate:"franchise"}}});
  for(const [v,s] of [[vin,stock],[otherVin,"OTHER-813"]]){
    await db.query("INSERT INTO "+schema+"client_cars(vin,body) VALUES($1,$2)",[v,{vin:v,stock:s,model:"Trail",drivetrain:"AWD",status:"available"}]);
  }
  const login=await request("/api/dealer-auth/signin",{method:"POST",auth:{},data:{email:"review.writer@example.test",password:"only-for-local-fixture-169"}});
  const staff={cookie:login.headers.get("set-cookie").split(";")[0]};
  await request(desk+key,{auth:{},status:403});
  await request(desk+key+"&export=review-history",{auth:{},status:403});
  await oem("save",0,{details:program});await oem("approve",1,{checked:true});
  await edit("draft",{values:{...values,body:"Our factory warranty is included.",evidence:null}});
  assert.match((await edit("publish",checked,422)).error,/manufacturer source/);
  await edit("draft",{values:{...values,evidence:{ai:true,claims:[spec]}}});
  assert.match((await edit("publish",checked,422)).error,/financial source/);
  for(const [patch,re] of [[{vin:otherVin},/stock number/],[{vin:"1A000000000000814"},/available VIN/],[{expected:"FWD"},/differs/]]){
    await edit("draft",{values:{...values,evidence:{ai:true,claims:[{...spec,...patch},offer]}}});
    assert.match((await edit("submit",{},422)).error,re);
  }
  await edit("draft",{values:{...values,evidence:{ai:true,claims:[spec,{...offer,vin:otherVin}]}}});
  assert.match((await edit("publish",checked,422)).error,/eligible/);
  await edit("draft",{values:{...values,body:values.body.replace(disclosure,"")}});
  assert.match((await edit("publish",checked,422)).error,/complete financial disclosure/);
  await edit("draft",{values},200,staff);
  await edit("draft",{values:{...values,evidence:undefined}},200,staff);
  assert.deepEqual((await doc()).draft.values.evidence,evidence);
  await edit("submit",{},200,staff);
  await edit("publish",checked,403,staff);await edit("publish",{checked:true},422);await edit("publish",checked);
  const edition=(await doc()).history[0].edition;
  assert.ok((await page()).includes(quote));
  const review=(await (await request(desk+key+"&export=review-history")).json()).records.at(-1);
  assert.equal(review.content.checkedSources[1].source,program.source);assert.equal(review.content.checkedSources[0].value,"AWD");
  const current=await pub();
  await request(profile,{method:"PUT",data:{...current.settings,revision:current.revision,options:{...current.settings.options,finance:false}}});
  await request(path,{auth:{},status:404});
  const restricted=await pub();await request(profile,{method:"PUT",data:{...restricted.settings,revision:restricted.revision,options:{...restricted.settings.options,finance:true}}});
  assert.ok((await page()).includes(incentive));
  const visible=await pub();assert.ok(visible.expiresAt);assert.doesNotMatch(JSON.stringify(visible),/SOURCE-QA|checkedSources|evidenceEdition/);
  await request(path,{host:other,auth:{},status:404});
  await db.query("UPDATE "+schema+"client_cars SET body=jsonb_set(body,'{drivetrain}',to_jsonb('FWD'::text)) WHERE vin=$1",[vin]);
  await request(path,{auth:{},status:404});assert.ok(!(await (await request("/sitemap.xml",{auth:{}})).text()).includes(path));
  let withheld=await pub();assert.equal(withheld.revision,visible.revision);assert.notEqual(withheld.pageState,visible.pageState);assert.ok(!JSON.stringify(withheld).includes(quote));
  assert.ok((await doc()).withheld);assert.ok((await (await request(queue)).json()).renewals.some(r=>r.key===key));
  const forged={...withheld.settings.pages,[key]:{...values,evidence:null}};
  await request(profile,{method:"PUT",data:{...withheld.settings,revision:withheld.revision,pages:forged},status:409});
  await template("bhph");
  await edit("draft",{values:{...values,body:"Local inventory",evidence:null}},200,staff);
  await edit("publish",checked,403,staff);await edit("discard");
  await edit("restore",{edition});assert.deepEqual((await doc()).draft.values.evidence,evidence);
  await edit("publish",checked,422);
  await db.query("UPDATE "+schema+"client_cars SET body=jsonb_set(body,'{drivetrain}',to_jsonb('AWD'::text)) WHERE vin=$1",[vin]);
  await request("/api/inventory-status",{method:"PUT",data:{vin,status:"sold"}});
  await request(path,{auth:{},status:404});await edit("publish",checked,422);
  await request("/api/inventory-status",{method:"PUT",data:{vin,status:"available"}});
  await request(path,{auth:{},status:404});
  assert.match((await doc()).withheldReason,/approve a new revision/);
  await db.query("UPDATE "+schema+"oem_program_revisions SET details=jsonb_set(details,'{endsOn}',to_jsonb('2020-01-02'::text)) WHERE program_id=$1 AND revision=2",[id]);
  await request(path,{auth:{},status:404});await edit("publish",checked,422);
  await oem("save",2,{details:program});await oem("approve",3,{checked:true});
  await request(path,{auth:{},status:404});await edit("publish",checked,422);
  await edit("draft",{values:{...values,evidence:{...evidence,claims:[spec,{...offer,revision:4}]}}});
  await edit("publish",checked);assert.ok((await page()).includes(disclosure));
  await oem("withdraw",4);await request(path,{auth:{},status:404});
  await template("independent");
  const inventory={enabled:true,title:"Source-reviewed inventory",url:"",body:quote,evidence:{ai:false,claims:[spec]}};
  await edit("draft",{values:inventory},200,admin,"all-inventory");await edit("publish",checked,200,admin,"all-inventory");
  await request("/api/inventory-status",{method:"PUT",data:{vin,status:"sold"}});
  const fallback=await (await request("/inventory/",{auth:{}})).text();
  assert.ok(!fallback.includes(inventory.title) && !fallback.includes(quote));
  await request("/api/inventory-status",{method:"PUT",data:{vin,status:"available"}});
  console.log("Verified claim evidence, approved wording, VIN scope, expiry, supersession, withdrawal, private audit, legacy clients, template changes, sitemap and functional inventory fallback.");
} finally {await db.end();}
