import assert from "node:assert/strict";

import pg from "pg";

const host="http://dealer.qa.test:8080", second="http://other.qa.test:8080";
const db=new pg.Pool({connectionString:"postgres://showroom@database/showroom"});
const schema="client_10000000000000000000000000000001";
const admin={authorization:"Basic "+Buffer.from("dealer:qa").toString("base64")};
const otherAdmin={authorization:"Basic "+Buffer.from("dealer:second-fixture").toString("base64")};
const page="/dealer-preview?layout=", api="/api/storefront-preview/";
const png="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLp8AAAAASUVORK5CYII=";
const read=(path,headers=admin,origin=host)=>fetch(origin+path,{headers});
const vin="1A000000000000087";
try {
  await db.query("UPDATE "+schema+".client_profile SET settings=settings || $1::jsonb || jsonb_build_object('profile', (settings->'profile') || $2::jsonb) WHERE id=1",[
    {dealerName:"Pine Ridge Motors",financingEnabled:true,pages:{"contact":{enabled:true,title:"Contact Pine Ridge"},"certified-pre-owned":{enabled:false}}},
    {siteTemplate:"independent",skin:"midnight",salesPhone:"740-555-0186"}]);
  await db.query("INSERT INTO "+schema+".inventory_status(vin,status) SELECT vin,'sold' FROM "+schema+".client_cars ON CONFLICT(vin) DO NOTHING");
  const car={vin,id:vin,stock:"PREVIEW-87",make:"Ford",model:"F-150",year:2020,miles:35000,body:"SUV",condition:"Used",price:17500,status:"Available",image:"assets/ford.jpg"};
  await db.query("INSERT INTO "+schema+".client_cars (vin,body) VALUES ($1,$2)",[vin,car]);
  await db.query("INSERT INTO "+schema+".homepage_banners(id,revision,config) VALUES(1,1,$1) ON CONFLICT(id) DO UPDATE SET config=excluded.config",[
    {enabled:true,heroMode:"vehicle",slides:[{image:png,alt:"Independent store promotion",link:""}]}]);
  const bhph=await fetch(host+"/api/bhph?vehicle="+vin,{method:"PUT",headers:{...admin,origin:host,"content-type":"application/json"},body:JSON.stringify({revision:0,enabled:true,cash:1750000,price:1950000,down:300000,override:null,choices:[{months:24,frequency:"Weekly"}]})});
  assert.equal(bhph.status,200,await bhph.text());
  // An authorized mark from an earlier franchise layout must be visible only in the private franchise preview.
  await db.query("CREATE TABLE IF NOT EXISTS public.oem_brand_references(id text PRIMARY KEY,name text,guidance jsonb,reviewed date)");
  await db.query("CREATE TABLE IF NOT EXISTS public.oem_brand_reference_art(brand text,object_id int,label text,source_url text,source_digest text,digest text,image bytea)");
  await db.query("INSERT INTO public.oem_brand_references VALUES('preview-mark','Preview Marque',$1,current_date) ON CONFLICT DO NOTHING",[{market:"US",note:"QA",sources:[]}]);
  const markUpdate=input=>fetch(host+"/api/oem-brand-library?brand=preview-mark",{method:"POST",headers:{...admin,origin:host,"content-type":"application/json"},body:JSON.stringify(input)});
  assert.equal((await markUpdate({revision:0,png,sourceNote:"Fixture asset",rightsNote:"QA footer"})).status,200);
  await db.query("UPDATE "+schema+".client_profile SET settings=jsonb_set(settings,'{profile,siteTemplate}',to_jsonb('franchise'::text))");
  assert.equal((await markUpdate({action:"publish-footer",revision:1,sequence:0,surface:"light",checked:true,endsOn:null})).status,200);
  await db.query("UPDATE "+schema+".client_profile SET settings=jsonb_set(settings,'{profile,siteTemplate}',to_jsonb('independent'::text))");
  const config=async()=>(await db.query("SELECT settings,etag FROM "+schema+".client_profile WHERE id=1")).rows[0];
  const before=await config();
  for(const path of [page+"franchise",api+"banners?layout=bhph",api+"website-offers?layout=independent",api+"manufacturer-marks/fixture/1-"+"1".repeat(64)+".png?layout=franchise"]){
    assert.equal((await read(path,{})).status,403);
  }
  assert.equal((await read(page+"franchise&skin=made-up")).status,400);
  assert.equal((await read(page+"made-up")).status,400);
  assert.equal((await fetch(host+page+"independent",{method:"POST",headers:admin})).status,405);
  assert.equal((await read(api+"dealer-profile?layout=independent")).status,404);
  for(const [layout,skin] of [["franchise","pearl"],["bhph","navy"],["classic","forest"],["independent","sand"]]){
    const r=await read(page+layout+"&skin="+skin);
    assert.equal(r.status,200);assert.match(r.headers.get("cache-control"),/private, no-store/);
    assert.match(r.headers.get("x-robots-tag"),/noindex/);assert.match(r.headers.get("content-security-policy"),/form-action 'none'/);
    const html=await r.text();
    assert.ok(html.includes('data-preview-layout="'+layout+'" data-preview-skin="'+skin+'"'));
    assert.match(html,/<body inert/);assert.doesNotMatch(html,/<script[^>]+src="assistant\.js|rel="canonical"/);
    // The canonical homepage initially renders only the first 24 current cars.
    assert.ok(html.includes("Pine Ridge Motors"));
    const impact=JSON.parse(html.match(/id="preview-pages">([^<]+)<\/script>/)[1]);
    if(layout==="franchise"){assert.ok(impact.added.some(row=>row.path==="/inventory/new/"));assert.ok(impact.removed.some(row=>row.path==="/inventory/under-20000/"));assert.ok(!impact.added.some(row=>row.path==="/inventory/certified/"));}
    if(layout==="independent")assert.deepEqual(impact,{added:[],removed:[]});
    const mark=html.match(/src="([^"]*manufacturer-marks\/preview-mark\/[^"]+)"/)?.[1];
    if(layout==="franchise"){
      assert.ok(mark?.startsWith(api));assert.equal((await read(mark)).status,200);
      assert.equal((await read(mark,{})).status,403);
      assert.equal((await read(mark.replace(api,"/").split("?")[0],{})).status,404);
    }else assert.equal(mark,undefined);
    const banners=await(await read(api+"banners?layout="+layout)).json();
    assert.equal(banners.slides.some(row=>row.alt==="Independent store promotion"),layout!=="franchise");
  }
  const live=await(await read("/?layout=franchise&skin=pearl",{})).text();
  assert.match(live,/data-store-template="independent"/);assert.doesNotMatch(live,/data-preview-layout|id="preview-pages"/);
  assert.match(live,/src="assistant\.js/);
  const secondPreview=await read(page+"franchise",otherAdmin,second);assert.equal(secondPreview.status,200);
  const other=await secondPreview.text();assert.ok(other.includes('id="preview-pages"'));assert.ok(!other.includes("Pine Ridge Motors")&&!other.includes(vin));
  assert.deepEqual(await config(),before);
  assert.equal((await read("/api/storefront-preview/website-offers?layout=bhph")).status,200);
  console.log("Verified read-only per-dealer previews, four layouts, page changes, governed slides, public isolation and unchanged PostgreSQL settings.");
} finally {await db.end();}
