import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {governedSlides,oemBinding,oemProgramsApi} from "../worker/oem.mjs";

test("unlinked banners are held on a franchise site; corrupt bindings fail closed",async()=>{
  const slide={image:"example",alt:"Inventory event",link:""};
  const db={query(){throw Error("Unlinked banners do not need a program database lookup.");}};
  assert.equal((await governedSlides(db,[slide],true,"UTC"))[0].status,"Program required");
  assert.equal((await governedSlides(db,[slide],false,"UTC"))[0].status,"Standard banner");
  assert.equal((await governedSlides(db,[{...slide,program:{id:"broken"}}],false,"UTC"))[0].status,"Program needs approval");
  assert.equal(oemBinding({program:{id:[randomUUID()],revision:1}}),null);
});

test("dealer program revisions, reviewer roles, exact creative evidence and local expiry in PostgreSQL",
  {skip:!process.env.OEM_TEST_DATABASE_URL},async()=>{
  const {default:pg}=await import("pg"),db=new pg.Client({connectionString:process.env.OEM_TEST_DATABASE_URL});
  await db.connect();
  try{
    await db.query("CREATE TEMP TABLE homepage_banners(id integer PRIMARY KEY,revision int,config jsonb); SET search_path TO pg_temp");
    const id=randomUUID(),details={title:"Dealer open house",brand:"Fixture Brand",market:"Ohio",source:"Bulletin 07",version:"v1",startsOn:"2020-01-01",endsOn:"2099-03-15",disclosure:"Available to eligible shoppers at this location.",acceptance:""};
    const cmd=(action,revision,input={},canReview=true)=>oemProgramsApi({db,method:"POST",actor:"fixture",canReview,input:{id,action,revision,...input}});
    assert.equal((await cmd("save",0,{details:{...details,endsOn:"2041-02-30"}})).status,422);
    assert.equal((await cmd("save",0,{details},false)).status,200);
    assert.equal((await cmd("approve",1,{checked:true},false)).status,403);
    assert.equal((await cmd("approve",1)).status,422);
    assert.deepEqual((await Promise.all([cmd("approve",1,{checked:true}),cmd("approve",1,{checked:true})])).map(v=>v.status).sort(),[200,409]);
    const slide={image:"data:image/jpeg;base64,fixture",alt:"Open house",link:"/inventory/",program:{id,revision:2}};
    await db.query("INSERT INTO homepage_banners VALUES(1,1,$1)",[{enabled:true,slides:[slide]}]);
    const inspect=async(value=slide,zone="America/New_York")=>(await governedSlides(db,[value],true,zone))[0];
    assert.equal((await inspect()).status,"Artwork needs review");
    const review={index:0,bannerRevision:1,checked:true};
    assert.equal((await cmd("approve-artwork",2,review,false)).status,403);
    assert.equal((await cmd("approve-artwork",2,{...review,bannerRevision:3})).status,409);
    assert.equal((await cmd("approve-artwork",2,review)).status,200);
    assert.equal((await cmd("approve-artwork",2,review)).status,200);
    const approved=await inspect();assert.equal(approved.status,"Approved");assert.equal(approved.disclosure,details.disclosure);
    assert.equal(approved.expiresAt,"2099-03-16T04:00:00.000Z");
    for(const [key,value] of [["alt","Different claim"],["link","/other/"],["image","replacement"]])assert.equal((await inspect({...slide,[key]:value})).status,"Artwork needs review");
    const clock=test.mock.method(Date,"now",()=>Date.parse(approved.expiresAt));
    try{
      assert.equal((await inspect()).status,"Expired");
      clock.mock.mockImplementation(()=>Date.parse("2019-01-01"));
      assert.equal((await inspect()).status,"Scheduled");
    }finally{clock.mock.restore();}
    assert.equal((await cmd("withdraw",2)).status,200);assert.equal((await inspect()).status,"Program needs approval");
    const evidence=(await oemProgramsApi({db,method:"GET",exportId:id})).data;
    assert.deepEqual(evidence.revisions.map(r=>r.state),["draft","approved","withdrawn"]);
    assert.equal(evidence.approvals.length,1);assert.deepEqual(evidence.approvals[0].creative,slide);
  }finally{await db.end();}
});
