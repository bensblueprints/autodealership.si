import assert from "node:assert/strict";
import pg from "pg";
const site="http://dealer.qa.test:8080", other="http://other.qa.test:8080", auth={authorization:"Basic ZGVhbGVyOnFh"};
const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const dedicated=new pg.Pool({connectionString:"postgres://showroom@database/client_10000000000000000000000000000002"});
const put=(path,value,host=site)=>fetch(host+path,{method:"PUT",headers:{...auth,origin:host,"content-type":"application/json"},body:JSON.stringify(value)});
const save=(car,host=site)=>put("/api/client-inventory",car,host),state=(vin,status)=>put("/api/inventory-status",{vin,status});
const get=async(path,headers={},host=site)=>{const r=await fetch(host+path,{headers});assert.equal(r.status,200);return r.json();};
const desk=(host=site)=>get("/api/dealer-inventory",auth,host);
const publicRows=()=>get("/api/showroom-inventory");const ok=async(p,n=200)=>{const r=await p;assert.equal(r.status,n,await r.text());};
const a="1A000000000000031",b="1A000000000000032",c="1A000000000000033",d="1A000000000000034";
const car=(vin,stock,more={})=>({vin,id:vin,stock,year:2020,make:"QA",model:"Touring",price:8595,miles:41000,condition:"Used",status:"Available",inventoryIntent:"add",...more});
try{
  assert.equal((await fetch(site+"/api/dealer-inventory")).status,403);
  await ok(save(car(a,"Desk-7",{lotDate:"2024-10-14"})));
  let item=(await desk()).find(i=>i.vin===a);assert.equal(item.lotDate,"2024-10-14");assert.equal(item.deskStatus,"current");
  const shopper=(await publicRows()).find(i=>i.vin===a);assert.ok(shopper);
  for(const k of ["lotDate","previousLotDate","inventoryIntent","deskStatus"])assert.ok(!(k in shopper));
  await ok(save(car(a,"Desk-7")),409);
  await ok(save(car(a,"Desk-7",{inventoryIntent:"edit",lotDate:"2024-10-16",previousLotDate:null})),409);
  await ok(save(car(a,"Desk-7",{inventoryIntent:"edit",lotDate:"2099-01-01",previousLotDate:"2024-10-14",price:10})),422);
  item=(await desk()).find(i=>i.vin===a);assert.equal(item.price,8595);
  await ok(save(car(a,"Desk-7",{inventoryIntent:"edit",lotDate:null,previousLotDate:"2024-10-14"})));
  assert.equal((await desk()).find(i=>i.vin===a).lotDate,null);
  const competing=await Promise.all([save(car(b," desk-8 ")),save(car(c,"DESK-8"))]);
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  await ok(state(a,"sold"));assert.ok(!(await publicRows()).some(i=>i.vin===a));
  assert.equal((await desk()).find(i=>i.vin===a).deskStatus,"sold");
  const script=await (await fetch(site+"/assets/cdjr-inventory.js")).text();assert.ok(!script.includes(a));
  await ok(save(car(d,"desk-7")));await ok(state(a,"available"),409);
  await ok(save(car(a,"Desk-9",{inventoryIntent:"edit"})));await ok(state(a,"available"));
  assert.ok((await publicRows()).some(i=>i.vin===a));await ok(state(d,"deleted"));
  assert.ok(!(await desk()).some(i=>i.vin===d) && !(await publicRows()).some(i=>i.vin===d));
  await ok(save(car(d,"desk-7",{inventoryIntent:"edit"})),409);
  // New physical dealer databases have their own catalog and can use the same VIN and stock.
  await dedicated.query("CREATE TABLE IF NOT EXISTS client_cars(vin text PRIMARY KEY,body jsonb); CREATE TABLE IF NOT EXISTS inventory_status(vin text PRIMARY KEY,status text)");
  assert.deepEqual(await desk(other),[]);
  await ok(save(car(a,"Desk-9",{lotDate:"2025-03-08"}),other));
  assert.equal((await desk(other))[0].lotDate,"2025-03-08");assert.equal((await desk()).find(i=>i.vin===a).lotDate,null);
  // Import an old incomplete record; repair must remain possible with an existing duplicate stock.
  const schema="client_10000000000000000000000000000001";
  const old="1A000000000000039", legacy=car(old," DESK-9 ",{image:"assets/bmw.jpg",imageType:"stock",miles:null,price:null});delete legacy.inventoryIntent;
  await db.query("INSERT INTO "+schema+".client_cars VALUES($1,$2)",[old,legacy]);
  await ok(save({...legacy,inventoryIntent:"edit",lotDate:"2024-06-01"}));
  console.log("Verified private inventory, sold and deleted exclusions, acquisition dates, competing stock assignments, edit conflicts and isolated physical dealer databases.");
}finally{await db.end();await dedicated.end();}
