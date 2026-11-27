import assert from "node:assert/strict";
import pg from "pg";
const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const table="client_10000000000000000000000000000001.client_profile",host="http://dealer.qa.test:8080";
const original=(await db.query("SELECT settings FROM "+table+" WHERE id=1")).rows[0].settings;
const linkPaths=html=>[...html.matchAll(/<a href="([^"]+)"/g)].map(m=>m[1]);
try{
  for(const template of ["franchise","independent","bhph"]){
    const settings={...original,profile:{...original.profile,siteTemplate:template},pages:{...original.pages,about:{enabled:true,title:"Our <store>"},contact:{enabled:true,title:"Visit & call"}, "all-inventory":{enabled:true,title:"Vehicle catalog"},"pre-owned":{enabled:true,title:"Used cars"}}};
    await db.query("UPDATE "+table+" SET settings=$1 WHERE id=1",[settings]);
    for(const [route,target,paths,title] of [
      ["/dealership/contact/","content",["/","/dealership/"],"Visit & call"],
      ["/inventory/used/?search=Ford","inventory",["/","/inventory/"],"Used cars"],
      ["/inventory/","inventory",["/"],"Vehicle catalog"]
    ]){
      const r=await fetch(host+route);assert.equal(r.status,200);
      const html=await r.text();assert.ok(html.includes('data-store-template="'+template+'"'));
      assert.ok(html.includes('class="content-skip" href="'+route+'#'+target+'"'));
      const nav=/<nav class="page-trail" aria-label="Breadcrumb">([\s\S]+?)<\/nav>/.exec(html)?.[1];assert.ok(nav);
      assert.deepEqual(linkPaths(nav),paths);
      const data=[...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map(m=>JSON.parse(m[1])).filter(o=>o["@type"]==="BreadcrumbList");
      assert.equal(data.length,1);const items=data[0].itemListElement;
      assert.deepEqual(items.map(x=>new URL(x.item).pathname),[...paths,route.split("?")[0]]);
      assert.deepEqual(items.map(x=>x.position),items.map((_,i)=>i+1));
      assert.ok(items.every(x=>new URL(x.item).origin==="https://dealer.qa.test"));assert.equal(items.at(-1).name,title);
      if(target==="content"){assert.ok(nav.includes("Our &lt;store&gt;"));assert.ok(nav.includes("Visit &amp; call"));}
    }
    settings.pages.about.enabled=false;
    await db.query("UPDATE "+table+" SET settings=$1 WHERE id=1",[settings]);
    const html=await(await fetch(host+"/dealership/contact/")).text();
    assert.deepEqual(linkPaths(/<nav class="page-trail"[^>]*>([\s\S]+?)<\/nav>/.exec(html)[1]),["/"]);
    assert.equal((await fetch(host+"/dealership/")).status,404);
  }
  const missing=await fetch(host+"/vehicle.html?stock=no-such-stock");assert.equal(missing.status,404);
  assert.match(await missing.text(),/class="content-skip" href="#vehicle-page"/);
}finally{try{await db.query("UPDATE "+table+" SET settings=$1 WHERE id=1",[original]);}finally{await db.end();}}
console.log("Verified storefront navigation across three templates, disabled parents, canonical hierarchy, escaped labels, filtered inventory and unavailable listings.");
