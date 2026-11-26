import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {oemBrandLibrary} from "../worker/oem.mjs";

const catalog=JSON.parse(await readFile(new URL("../brand-library/catalog.json",import.meta.url)));
test("manufacturer references distinguish website standards from program access and provide the reviewed logo mapping",()=>{
  assert.equal(new Set(catalog.brands.map(b=>b.id)).size,31);
  const used=new Set();
  for(const brand of catalog.brands){
    assert.ok(brand.sources.length && brand.note);
    for(const key of brand.sources){assert.match(catalog.sources[key].url,/^https:\/\//);used.add(key);}
  }
  assert.equal(used.size,Object.keys(catalog.sources).length);
  assert.equal(catalog.artwork.assets.length,6);
  assert.deepEqual(catalog.artwork.assets.map(a=>a.object),[11,12,13,14,15,16]);
  assert.match(catalog.artwork.sha256,/^[0-9a-f]{64}$/);
});

test("seeded PostgreSQL private references and multi-dealer artwork", {skip:!process.env.BRAND_LIBRARY_TEST_URL}, async()=>{
  const {default:pg}=await import("pg");
  const pool=new pg.Pool({connectionString:process.env.BRAND_LIBRARY_TEST_URL});
  const clients=[],schemas=[];
  try{
    for(let i=0;i<2;i++){
      const schema="brandtest_"+randomUUID().replaceAll("-","");
      await pool.query("CREATE SCHEMA "+schema);schemas.push(schema);
      const client=await pool.connect();clients.push(client);await client.query("SET search_path TO "+schema);
    }
    const call=(body={},tenant=0)=>oemBrandLibrary({db:clients[tenant],platform:pool,method:"GET",actor:"Fixture manager",canReview:true,asset:null,...body});
    const library=(await call()).data.brands;
    assert.equal(library.length,31);
    assert.equal(library.flatMap(b=>b.artwork).length,6);
    const art=library.find(b=>b.id==="kia").artwork[0];
    const bytes=(await call({scope:"library",brand:"kia",asset:art.digest})).image;
    assert.equal(createHash("sha256").update(bytes).digest("hex"),art.digest);
    assert.equal((await call({scope:"library",brand:"hyundai",asset:art.digest})).status,404);
    const form={method:"POST",brand:"kia",input:{revision:0,png:"data:image/png;base64,"+bytes.toString("base64"),sourceNote:"Dealer supplied file",rightsNote:"Private staging only"}};
    assert.equal((await call({...form,canReview:false})).status,403);
    assert.equal((await call({...form,input:{...form.input,rightsNote:""}})).status,422);
    assert.equal((await call(form)).status,200);
    assert.equal((await call(form)).status,409);
    assert.equal((await call({scope:"dealer",brand:"kia",asset:art.digest},1)).status,404);
    assert.equal((await call({scope:"dealer",brand:"kia",asset:art.digest})).status,200);
    const current=(await call()).data.brands.find(b=>b.id==="kia").dealerArtwork;
    assert.equal(current.revision,1);assert.equal(current.rights_note,"Private staging only");
    assert.equal((await call({},1)).data.brands.find(b=>b.id==="kia").dealerArtwork,null);
    assert.equal((await call({...form,input:{...form.input,revision:1}})).status,200);
  }finally{
    for(const c of clients)c.release(true);
    for(const s of schemas)await pool.query("DROP SCHEMA "+s+" CASCADE");
    await pool.end();
  }
});
