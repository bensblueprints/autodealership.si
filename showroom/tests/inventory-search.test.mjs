import test from "node:test";
import assert from "node:assert/strict";
import search from "../web/inventory-search.js";

const fields={make:"Make",drivetrain:"Drivetrain",interior:"Interior",miles:"Mileage",year:"Year",features:"Features"};
test("a shared inventory URL preserves combined features, actual zero amounts and payment frequency",()=>{
  const hash="#inventory?q=J%26J&make=Ram&interior=Dark%2FRed&drivetrain=AWD&feature=air+%26+heat&feature=backup+camera&min=0&max=450&mode=finance&bhph=1&down=0&frequency=Biweekly&installment=122.59&sort=miles&view=list&page=2";
  const state=search.read(hash,fields);
  assert.deepEqual(state.equipment,["air & heat","backup camera"]);
  assert.equal(state.query,"J&J");assert.equal(state.down,0);assert.equal(state.installment,122.59);
  assert.deepEqual(search.read(search.write(state),fields),state);
});
test("unrelated fragments and unsupported controls never become parts of a shared link",()=>{
  assert.equal(search.read("#dealer-contact",fields),null);
  const state=search.read("#inventory?year=no&miles=x&frequency=Hourly&mode=loan&driver=Pat&token=private&max=-1&view=cards&page=99999999999999999999&installment=Infinity",fields);
  assert.equal(search.write(state),"");assert.deepEqual(state.selected,[]);assert.equal(state.page,1);
});
test("manufacturer drive types and older VIN details map to drivetrain choices",()=>{
  for(const [source,label] of [["AWD/All-Wheel Drive","AWD"],["4WD/4-Wheel Drive/4x4","4WD"],["Rear-wheel drive","RWD"],["Front Wheel Drive","FWD"],["4x2","2WD"],["Unknown",""]])
    assert.equal(search.drivetrain({drivetrain:source}),label);
  assert.equal(search.drivetrain({vpicDetails:[["Drive Type","AWD"]]}),"AWD");
  assert.equal(search.drivetrain({features:["AWD availability varies by trim"]}),"");
});
