import assert from "node:assert/strict";
import pg from "pg";

const site="http://dealer.qa.test:8080",other="http://other.qa.test:8080";
const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const otherDb=new pg.Pool({connectionString:"postgres://showroom@database/client_10000000000000000000000000000002"});
const vin=n=>"1A0000000000000"+n;
const path=n=>"/vehicle.html?stock="+vin(n);
const schema="client_10000000000000000000000000000001";
const put=(url,body)=>fetch(site+url,{method:"PUT",headers:{origin:site,authorization:"Basic ZGVhbGVyOnFh","content-type":"application/json"},body:JSON.stringify(body)});
async function save(url,payload){const r=await put(url,payload);assert.equal(r.status,200,await r.text());}
async function profile(template,opts){
  const {settings,revision}=await(await fetch(site+"/api/dealer-profile")).json();
  await save("/api/dealer-profile",{...settings,revision,profile:{...settings.profile,siteTemplate:template},options:{...settings.options,...opts}});
}
async function page(n,code=200,host=site){
  const r=await fetch(host+path(n));assert.equal(r.status,code);
  if(code===404){assert.match(r.headers.get("x-robots-tag"),/noindex/);assert.match(r.headers.get("cache-control"),/no-store/);}
  return r.text();
}
const section=html=>html.match(/<section id="similar-vehicles"[\s\S]*?<\/section>/)?.[0]||"";
const listed=html=>[...section(html).matchAll(/href="\/vehicle.html\?stock=([^"]+)"/g)].map(m=>m[1]);
async function counts(){return (await db.query("SELECT (SELECT count(*) FROM "+schema+".shopper_leads) AS leads,(SELECT count(*) FROM "+schema+".appointments) AS visits")).rows[0];}

try{
  const before=await counts();
  const base={model:"Contour",make:"Fixture",body:"Coupe",year:2022,price:18000,status:"Available",image:"assets/ford.jpg",miles:32410};
  for(const [n,fields] of [[70,{}],[71,{price:12000,trim:"Sport <R>"}],[72,{price:18500}],[73,{model:"Summit",price:18100,image:""}],[74,{model:"Traverse",body:"Truck"}],[75,{status:"Reserved"}],[76,{status:"In transit"}],[77,{}],[78,{}]]){
    await save("/api/client-inventory",{...base,...fields,vin:vin(n),id:vin(n),stock:"LOT-"+n,inventoryIntent:"add"});
  }
  await save("/api/inventory-status",{vin:vin(77),status:"sold"});
  await save("/api/inventory-status",{vin:vin(78),status:"deleted"});
  await save("/api/bhph?vehicle="+vin(71),{revision:0,enabled:true,cash:1799975,price:1950000,down:100000,override:null,choices:[{months:24,frequency:"Weekly"}]});
  await db.query("UPDATE "+schema+".client_cars SET body=body || '{\"imageType\":\"stock\"}' WHERE vin=$1",[vin(71)]);
  for(const template of ["independent","bhph","franchise"]){
    await profile(template,{cash:true,pricing:true,relatedVehicles:true});
    const html=await page(70),cards=section(html);
    assert.match(html,new RegExp('data-store-template="'+template+'"'));
    assert.deepEqual(listed(html),[71,72,73].map(vin));
    assert.match(cards,/\$17,999.75/);assert.match(cards,/Sport &lt;R&gt;/);assert.match(cards,/Representative photo/);assert.match(cards,/Photo unavailable/);
    assert.match(cards,/Same model/);assert.match(cards,/Same body style/);assert.match(cards,/32,410 mi/);
    const sold=await page(77,404);assert.match(sold,/This vehicle has sold/);assert.match(sold,/class="return-inventory" href="\/inventory\/"/);
    assert.deepEqual(listed(sold),[70,71,72].map(vin));assert.ok(!sold.includes(vin(77)));assert.doesNotMatch(sold,/id="request-drive"|application\/ld\+json|rel="canonical"/);
  }
  await profile("independent",{cash:false});
  const privatePrices=section(await page(70));assert.doesNotMatch(privatePrices,/Cash price|\$|17,999/);
  await profile("independent",{cash:true,pricing:false});
  assert.doesNotMatch(section(await page(70)),/Cash price|\$/);
  await profile("independent",{pricing:true,relatedVehicles:false});
  assert.equal(section(await page(70)),"");assert.equal(section(await page(77,404)),"");
  await profile("independent",{relatedVehicles:true});
  await save("/api/inventory-status",{vin:vin(71),status:"sold"});
  assert.deepEqual(listed(await page(70)),[72,73,74].map(vin));
  await save("/api/inventory-status",{vin:vin(71),status:"available"});
  const deleted=await page(78,404),unknown=await page(89,404);
  for(const doc of [deleted,unknown]){assert.match(doc,/<h1>Vehicle unavailable<\/h1>/);assert.doesNotMatch(doc,/This vehicle has sold|LOT-78|id="request-drive"/);}
  assert.equal(deleted,unknown);
  // The inventory desk fixture created only its tables in this separate dealer database.
  await otherDb.query("CREATE TABLE IF NOT EXISTS bhph_offers(vehicle text PRIMARY KEY,revision integer NOT NULL,offer jsonb NOT NULL)");
  const foreign=await page(70,404,other);assert.match(foreign,/Vehicle unavailable/);assert.doesNotMatch(foreign,/LOT-7|Fixture Contour/);
  const head=await fetch(site+path(77),{method:"HEAD"});assert.equal(head.status,404);assert.equal(await head.text(),"");
  await otherDb.query("INSERT INTO inventory_status(vin,status) SELECT vin,'sold' FROM client_cars ON CONFLICT DO NOTHING");
  const empty=await page(89,404,other);assert.equal(section(empty),"");assert.match(empty,/Browse inventory/);
  assert.deepEqual(await counts(),before);
}finally{await Promise.all([db.end(),otherDb.end()]);}
console.log("Verified live, sold, deleted and missing vehicle pages, price visibility, ranked alternatives and dealership isolation.");
