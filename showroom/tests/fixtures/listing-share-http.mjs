import assert from "node:assert/strict";
import pg from "pg";

const site = "http://dealer.qa.test:8080";
const db = new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const schema = "client_10000000000000000000000000000001";
const profile = schema + ".client_profile";
const cars = schema + ".client_cars";
const vin = "1A000000000000085";
const path = "/vehicle.html?stock=" + vin;
const car = {vin,id:vin,stock:"RS & 85",year:2022,make:"Example",model:"Summit",trim:"Touring",miles:45000,condition:"Used",price:18000,status:"Available",image:"assets/ford.jpg"};
const original = (await db.query("SELECT settings FROM " + profile + " WHERE id=1")).rows[0].settings;
try {
  await db.query("INSERT INTO " + cars + "(vin,body) VALUES ($1,$2)",[vin,car]);
  for (const template of ["franchise","independent","bhph"]) {
    await db.query("UPDATE " + profile + " SET settings=$1 WHERE id=1",[{...original,profile:{...original.profile,siteTemplate:template}}]);
    const response = await fetch(site + path + "&utm_source=private");
    assert.equal(response.status,200);
    const html = await response.text();
    assert.ok(html.includes('data-store-template="' + template + '"'));
    assert.ok(html.includes('<meta property="og:url" content="https://dealer.qa.test' + path + '">'));
    assert.match(html,/<meta property="og:title" content="2022 Example Summit Touring/);
    assert.match(html,/<meta property="og:description" content="Stock #RS &amp; 85/);
    assert.match(html,/<meta property="og:image" content="https:\/\/dealer.qa.test\/assets\/ford.jpg">/);
    assert.match(html,/id="share-vehicle"/);
    assert.doesNotMatch(html,/<meta property="og:[^"]+" content="[^"]*utm_source/);
  }
  for (const changes of [{imageType:"stock"}, {image:"javascript:void(0)"}, {image:""}]) {
    await db.query("UPDATE " + cars + " SET body=$1 WHERE vin=$2",[{...car,...changes},vin]);
    assert.doesNotMatch(await (await fetch(site + path)).text(),/<meta property="og:image/);
  }
  await db.query("INSERT INTO " + schema + ".inventory_status(vin,status) VALUES ($1,'sold')",[vin]);
  for (const host of [site,"http://other.qa.test:8080"]) {
    const missing = await fetch(host + path);
    assert.equal(missing.status,404);
    assert.doesNotMatch(await missing.text(),/<meta property="og:|id="share-vehicle"/);
  }
  await db.query("DELETE FROM " + schema + ".inventory_status WHERE vin=$1",[vin]);
  await db.query("UPDATE " + cars + " SET body=$1 WHERE vin=$2",[car,vin]);
} finally {
  await db.query("UPDATE " + profile + " SET settings=$1 WHERE id=1",[original]);
  await db.end();
}
console.log("Verified canonical listing previews for all three templates, real-photo rules, sold stock and tenant isolation.");
