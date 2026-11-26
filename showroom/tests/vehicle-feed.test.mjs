import assert from "node:assert/strict";
import test from "node:test";
import {vehicleFeedItem,readVehicleFeed} from "../worker/vehicle-feed.mjs";
import {DealerSitePages} from "../dist/server/index.js";

const origin="https://dealer.example";
const car={vin:"2C4RC1BG1VR599700",stock:"101",year:"2024",make:"Chrysler",model:"Pacifica",color:"Black",
  condition:"Certified pre-owned",miles:"12001",status:"Available",image:"assets/vehicle-photos/test.jpg",price:"18000.37"};
test("eligible US in-store offer matches cash price, canonical vehicle and actual rooftop photo",()=>{
  const {values}=vehicleFeedItem(car,origin);
  assert.equal(values.price,"18000.37 USD");assert.equal(values.condition,"used");
  assert.equal(values.image_link,origin+"/assets/vehicle-photos/test.jpg");assert.equal(values.mileage,"12001 Miles");
  assert.equal(values.link_template,origin+"/vehicle.html?stock="+car.vin+"&store={store_code}");
  assert.equal(values.google_product_category,"916");assert.equal(values.vehicle_msrp,undefined);
});
test("unverified details, representative stock images and reserved cars stay out",()=>{
  const flags=vehicleFeedItem({...car,miles:"",color:"Unknown",condition:"New",price:null,image_type:"stock",status:"Reserved"},origin).issues;
  for(const expected of ["Odometer reading in miles","Exterior color","MSRP for new vehicle","Positive cash selling price","Photo of the actual vehicle","Available on the lot"])assert.ok(flags.includes(expected));
});
test("Merchant XML handles special characters, an empty lot and unpublished config",async()=>{
  let code="East01",stock=[{...car,model:"R&D <Limited>"}];
  const db={query:async sql=>({rows:sql.includes("FROM client_profile")?[{code,options:{},name:"R&D"}]:stock})};
  const xml=await readVehicleFeed(db,origin,true,false);
  assert.match(xml,/<g:model>R&amp;D &lt;Limited&gt;<\/g:model>/);
  assert.match(xml,/<g:store_code>East01<\/g:store_code>/);
  stock=[];assert.doesNotMatch(await readVehicleFeed(db,origin,true,false),/<item>/);
  code="";assert.equal(await readVehicleFeed(db,origin,true,false),null);
});
test("template page defaults respect dealer overrides and never enable unconfigured OEM offers or APR",()=>{
  const get=(key,edits={})=>DealerSitePages.list({profile:{siteTemplate:key},pages:edits},true,false).filter(p=>p.enabled).map(p=>p.key);
  assert.ok(get("franchise").includes("certified-pre-owned"));assert.ok(!get("franchise").includes("new-specials"));
  assert.ok(!get("franchise",{"new-vehicles":{enabled:false}}).includes("new-vehicles"));
  assert.ok(get("independent").includes("under-20k"));assert.ok(!get("bhph").includes("apply-financing"));
  assert.deepEqual(get("other"),["all-inventory"]);
});
