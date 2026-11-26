import test from "node:test";
import assert from "node:assert/strict";
import {DealerLocation} from "../dist/server/index.js";

test("public hours, extensions, split departments and closed days agree with search metadata",()=>{
  const profile={street:"18 Main",city:"Dayton",region:"OH",postal:"45402",salesPhone:"+1 (937) 555-0100 ext. 41",
    driveHours:{Sun:["06:00","23:00"]},driveTimezone:"America/New_York",salesHours:{Mon:["09:00","17:00"],Sun:null},
    serviceHours:{Mon:["06:30","12:00"],Tue:["broken"]},partsPhone:"123",facebook:"https://example.com/store"};
  const facts=DealerLocation.facts(profile),card=DealerLocation.card(facts,true),data=DealerLocation.schema(facts,"Demo","https://store.test");
  assert.match(card,/tel:\+19375550100;ext=41/);
  assert.match(card,/9:00 AM – 5:00 PM/);
  assert.match(card,/6:30 AM – 12:00 PM/);
  assert.match(card,/Sunday<\/dt><dd>Closed/);
  assert.doesNotMatch(card,/11:00 PM|Tuesday|<h3>Parts/);
  assert.equal(data.address.addressLocality,"Dayton");
  assert.deepEqual(data.sameAs,["https://example.com/store"]);
  assert.deepEqual(data.openingHoursSpecification.map(row=>row.opens),["09:00","00:00"]);
  assert.equal(data.department[0].openingHoursSpecification[0].closes,"12:00");
});
test("missing or private fields never become a dealer location or an opening time",()=>{
  const facts=DealerLocation.facts({country:"USA",driveHours:{Tue:["01:00","03:00"]},instagram:"javascript:alert(1)"});
  assert.equal(DealerLocation.card(facts),"");
  assert.equal(DealerLocation.schema(facts,"Empty","https://empty.test"),null);
  const partial=DealerLocation.facts({street:"<script> & Sons",city:"Dayton",servicePhone:"937-555-0122"});
  assert.match(DealerLocation.card(partial),/&lt;script&gt; &amp; Sons/);
  const data=DealerLocation.schema(partial,"Demo","https://test.example");
  assert.equal(data.openingHoursSpecification,undefined);
  assert.equal(data.telephone,undefined);
  assert.equal(data.department[0].telephone,"937-555-0122");
});
