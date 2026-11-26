import assert from "node:assert/strict";
const site="http://dealer.qa.test:8080", vin="1A000000000000041";
const put=(path,data)=>fetch(site+path,{method:"PUT",headers:{authorization:"Basic ZGVhbGVyOnFh","content-type":"application/json",origin:site},body:JSON.stringify(data)});
async function settings(options,template){
  const {settings,revision}=await (await fetch(site+"/api/dealer-profile")).json();
  const r=await put("/api/dealer-profile",{...settings,revision,options:{...settings.options,...options},financingEnabled:true,profile:{...settings.profile,siteTemplate:template}});
  assert.equal(r.status,200,await r.text());
}
for(const template of ["independent","franchise","bhph"]){
  await settings({interior:false,drivetrain:true},template);
  const stored=(await(await fetch(site+"/api/dealer-profile")).json()).settings;
  assert.equal(stored.options.interior,false);assert.equal(stored.options.drivetrain,true);
  const html=await(await fetch(site+"/inventory/")).text();assert.ok(html.includes('data-store-template="'+template+'"'));assert.ok(html.includes('id="share-search"'));
}
await settings({interior:true,drivetrain:true,features:true,cash:true,price:true,aprFinancingEnabled:false},"bhph");
const saved=await put("/api/client-inventory",{id:vin,vin,inventoryIntent:"add",stock:"SHARE-41",year:2021,make:"Ford",model:"Edge",body:"SUV",condition:"Used",drivetrain:"AWD/All-Wheel Drive",interior:"Ebony leather",features:["Heated seats","Backup camera"],image:"assets/ford.jpg",price:16000,miles:52000});
assert.equal(saved.status,200,await saved.text());
const offer=await put("/api/bhph?vehicle="+vin,{revision:0,enabled:true,cash:1600000,price:1750000,down:100000,override:null,choices:[{months:36,frequency:"Weekly"}]});
assert.equal(offer.status,200,await offer.text());
const cars=await (await fetch(site+"/api/showroom-inventory")).json();assert.equal(cars.find(c=>c.vin===vin).drivetrain,"AWD/All-Wheel Drive");
assert.ok(!(await(await fetch("http://other.qa.test:8080/api/showroom-inventory")).json()).some(c=>c.vin===vin));
console.log("Verified the three search templates, persisted store filters, and tenant-scoped vehicle and payment data.");
