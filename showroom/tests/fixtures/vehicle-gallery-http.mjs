import assert from "node:assert/strict";
import pg from "pg";

const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const host="http://dealer.qa.test:8080", vin="1A000000000000001", table="client_10000000000000000000000000000001.";
const entities=html=>[...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(m=>JSON.parse(m[1]));
const css=await (await fetch(host+"/vehicle.css")).text();assert.ok(css.includes("#photo-strip"));
try{
  await db.query("UPDATE "+table+"client_cars SET body=body || $1::jsonb WHERE vin=$2",[JSON.stringify({image:"assets/ford.jpg",photos:["assets/ford.jpg","assets/bmw.jpg","assets/jeep.jpg"],features:["Heated seats"]}),vin]);
  const get=async()=>{const r=await fetch(host+"/vehicle.html?stock="+vin);assert.equal(r.status,200);return r.text();};
  for(const template of ["independent","franchise","bhph"]){
    await db.query("UPDATE "+table+"client_profile SET settings=jsonb_set(settings,'{profile,siteTemplate}',to_jsonb($1::text)) WHERE id=1",[template]);
    const html=await get(),tree=entities(html);
    assert.ok(html.includes('data-store-template="'+template+'"'));
    assert.ok(html.includes('class="initial-photo"'));
    const vehicle=tree.find(n=>n["@type"]==="Vehicle"),crumb=tree.find(n=>n["@type"]==="BreadcrumbList");
    assert.equal(vehicle.vehicleIdentificationNumber,vin);assert.equal(vehicle.image,"https://dealer.qa.test/assets/ford.jpg");
    assert.equal(crumb.itemListElement.at(-1).name,vehicle.name);assert.equal(crumb.itemListElement.at(-1).item,vehicle.url);
    for(const [i,n] of crumb.itemListElement.entries()){assert.equal(n.position,i+1);assert.ok(n.item.startsWith("https://dealer.qa.test/"));}
  }
  await db.query("UPDATE "+table+"client_cars SET body=body || '{\"imageType\":\"stock\"}' WHERE vin=$1",[vin]);
  const stock=await get();assert.ok(stock.includes("Representative manufacturer photo"));assert.ok(!entities(stock).find(n=>n["@type"]==="Vehicle").image);
  await db.query("UPDATE "+table+"client_cars SET body=body - 'imageType' WHERE vin=$1",[vin]);
  assert.equal((await fetch("http://other.qa.test:8080/vehicle.html?stock="+vin)).status,404);
}finally{await db.end();}
console.log("Verified dealer-hosted gallery cover, visible breadcrumb and search markup across BHPH, independent and franchise listings.");
