import assert from "node:assert/strict";
import pg from "pg";
const root="http://dealer.qa.test:8080",other="http://other.qa.test:8080",admin={authorization:"Basic ZGVhbGVyOnFh"};
async function ask(path,input,method=input?"POST":"GET",auth=admin,host=root,expected=200){
  const r=await fetch(host+path,{method,headers:{...auth,origin:host,"content-type":"application/json"},body:input?JSON.stringify(input):undefined});
  const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d;
}
const db=new pg.Client({connectionString:"postgres://showroom@database/showroom"});await db.connect();
try{
  await db.query("SET search_path TO client_10000000000000000000000000000001");
  const view="/api/reputation",feedback="/api/purchase-feedback",link="https://g.page/r/example/review",vin="1A000000000000070";
  if(process.argv[2]==="delivered"){
    for(const stars of [2,5]){
      const item=(await db.query("SELECT * FROM purchase_review_emails WHERE address=$1",["stars"+stars+"@example.test"])).rows[0];
      assert.equal(item.state,"accepted");const token=item.token;
      await ask(feedback,{action:"view",token},"POST",{},other,404);
      assert.equal((await ask(feedback,{action:"view",token},"POST",{})).link,link);
      const rating={action:"rate",stars,comment:"Shared in private",token};
      assert.equal((await ask(feedback,rating,"POST",{})).link,link);
      assert.equal((await ask(feedback,rating,"POST",{})).submitted,true);
      await ask(feedback,{...rating,stars:4},"POST",{},root,409);
      await ask(feedback,{action:"stop",token},"POST",{});
    }
    const open=await ask(view+"?view=open");assert.equal(open.mail.length,1);assert.equal(open.mail[0].stars,2);
    await ask(view,{action:"resolve",id:open.mail[0].id});assert.equal((await ask(view+"?view=open")).mail.length,0);
    console.log("Verified equal Google links before and after both ratings, tenant isolation, private low-rating follow-up, resolution and opt-out.");
  }else{
    const settings=await ask(view);
    await ask(view,{link,revision:settings.revision,automatic:true},"PUT");
    for(const stars of [2,5,3]){
      const {id}=await ask("/api/clients",{action:"intake",request:crypto.randomUUID(),name:"Buyer "+stars,phone:"740555012"+stars,email:"stars"+stars+"@example.test",vin,note:"",source:"Phone call"});
      const signed={id,vin,stage:"signed",revision:0,cents:1630066,note:"",reviewPermission:stars!==3};
      await ask("/api/clients",signed,"PUT");await ask("/api/clients",{...signed,revision:1,note:"Value confirmed"},"PUT");
    }
    const rows=(await db.query("SELECT address,extract(epoch FROM (due_at-purchased_at))::int AS delay,state FROM purchase_review_emails ORDER BY address")).rows;
    assert.deepEqual(rows.map(x=>[x.address,x.delay,x.state]),[["stars2@example.test",86400,"scheduled"],["stars5@example.test",86400,"scheduled"]]);
    console.log("Verified purchase email opt-in, exactly 24 hours, contract retries and no backfill.");
  }
}finally{await db.end();}
