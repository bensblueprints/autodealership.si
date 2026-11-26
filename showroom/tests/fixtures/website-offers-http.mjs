import assert from "node:assert/strict";
import pg from "pg";
const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const site="http://dealer.qa.test:8080",other="http://other.qa.test:8080",vin="1A000000000000001",id=crypto.randomUUID();
const auth={authorization:"Basic ZGVhbGVyOnFh",Origin:site,"content-type":"application/json"};
const r=(path,method,body,headers=auth)=>fetch(site+path,{method,headers,body:JSON.stringify(body)});
const program=(action,revision,extra={})=>r("/api/oem-programs","POST",{id,action,revision,...extra});
const ok=async(p,code=200)=>{const res=await p;assert.equal(res.status,code,await res.text());};
const read=async(host=site)=>{const res=await fetch(host+"/api/website-offers");assert.equal(res.status,200);assert.match(res.headers.get("cache-control"),/no-store/);return res.json();};
const text=async path=>(await fetch(site+path)).text();
const details={title:"Internal manager title",brand:"QA",market:"Midwest",source:"Private document",version:"bulletin 7",acceptance:"Private reference",startsOn:"2020-01-01",endsOn:"2099-12-31",disclosure:"Dealer eligibility terms & exclusions.",websiteOffer:{page:"used-specials",headline:"Dealer event <weekend>",vins:[vin]}};
const table="client_10000000000000000000000000000001.";
async function page(enabled){
  await db.query("UPDATE "+table+"client_profile SET settings=jsonb_set(settings,'{pages,used-specials}',$1) WHERE id=1",[{title:"Pre-owned offers",body:"Current store offers.",enabled}]);
}
try{
  await page(true);
  await db.query("UPDATE "+table+"client_profile SET settings=jsonb_set(settings,'{profile,driveTimezone}','\"America/New_York\"')");
  await ok(program("save",0,{details:{...details,websiteOffer:{...details.websiteOffer,vins:["1A000000000000011"]}}}),422);
  await ok(program("save",0,{details}));
  assert.equal((await read()).length,0);await ok(program("approve",1,{checked:true}));let offers=await read();
  const report=async()=>(await (await fetch(site+"/api/oem-programs",{headers:auth})).json()).programs.find(p=>p.program_id===id)?.website;
  assert.deepEqual(await report(),{status:"Live",page:"used-specials",vehicles:1});
  assert.equal(offers.length,1);assert.equal(offers[0].expiresAt,"2100-01-01T05:00:00.000Z");
  assert.equal(offers[0].cars[0].vin,vin);assert.equal(offers[0].page,"used-specials");
  assert.doesNotMatch(JSON.stringify(offers),/Internal manager|Private|bulletin|program_id|acceptance/);
  assert.deepEqual(await read(other),[]);
  for(const name of ["franchise","bhph","independent"]){
    await db.query("UPDATE "+table+"client_profile SET settings=jsonb_set(settings,'{profile,siteTemplate}',to_jsonb($1::text))",[name]);
    const vdp=await text("/vehicle.html?stock="+vin),special=await text("/specials/used/");
    for(const html of [vdp,special]){assert.match(html,/Dealer event &lt;weekend&gt;/);assert.match(html,/Dealer eligibility terms &amp; exclusions/);assert.doesNotMatch(html,/Private document/);}
    assert.ok(special.includes("Stock QA-1"));assert.ok(!vdp.includes("Dealer event <weekend>"));
  }
  await page(false);assert.equal((await read())[0].page,null);assert.equal((await fetch(site+"/specials/used/")).status,404);
  await page(true);
  const bannerConfig=await (await fetch(site+"/api/banner-editor",{headers:auth})).json();
  const slide={image:"data:image/jpeg;base64,/9j/2Q==",alt:"QA special",link:"/specials/used/",program:{id,revision:2}};
  const br=await r("/api/banner-editor","PUT",{...bannerConfig,enabled:true,slides:[slide]});assert.equal(br.status,200);
  await ok(program("approve-artwork",2,{index:0,bannerRevision:(await br.json()).revision,checked:true}));
  const banners=async()=>(await (await fetch(site+"/api/banners")).json()).slides;
  assert.equal((await banners()).length,1);
  await ok(r("/api/inventory-status","PUT",{vin,status:"sold"}));assert.deepEqual(await read(),[]);assert.doesNotMatch(await text("/specials/used/"),/Dealer event/);
  assert.equal((await report()).status,"No eligible placement");assert.equal((await banners()).length,0);
  await ok(r("/api/inventory-status","PUT",{vin,status:"available"}));
  const finance={...details,websiteOffer:{...details.websiteOffer,page:"finance-specials"}};
  await ok(program("save",2,{details:finance}));assert.deepEqual(await read(),[]);await ok(program("approve",3,{checked:true}));assert.equal((await read()).length,1);
  await db.query("UPDATE "+table+"client_cars SET body=body||'{\"aprFinancingEnabled\":false}' WHERE vin=$1",[vin]);assert.deepEqual(await read(),[]);
  await db.query("UPDATE "+table+"client_cars SET body=body-'aprFinancingEnabled' WHERE vin=$1",[vin]);
  await db.query("UPDATE "+table+"client_profile SET settings=settings||'{\"financingEnabled\":false}'");assert.deepEqual(await read(),[]);
  await db.query("UPDATE "+table+"client_profile SET settings=settings||'{\"financingEnabled\":true}'");
  await ok(program("withdraw",4));assert.deepEqual(await read(),[]);
  for(const [rev,startsOn,endsOn] of [[5,"2019-01-01","2020-12-31"],[7,"2090-01-01","2099-12-31"]]){
    await ok(program("save",rev,{details:{...details,startsOn,endsOn}}));await ok(program("approve",rev+1,{checked:true}));assert.deepEqual(await read(),[]);assert.equal((await report()).status,rev===5?"Expired":"Scheduled");
  }
  const general={...details,websiteOffer:{...details.websiteOffer,vins:[]}};
  await ok(program("save",9,{details:general}));await ok(program("approve",10,{checked:true}));assert.equal((await read())[0].cars.length,0);
  assert.doesNotMatch(await text("/vehicle.html?stock="+vin),/Dealer event/);assert.match(await text("/specials/used/"),/Dealer event/);
  await ok(program("withdraw",11));
  // Leave a pending revision for the browser to select stock, review, approve, and withdraw.
  await ok(program("save",12,{details:{...details,title:"Browser review",websiteOffer:null}}));
  console.log("Verified public specials on three templates, approved VINs, source privacy, sold removal, local expiry, APR settings, page visibility and revocation.");
}finally{await db.end();}
