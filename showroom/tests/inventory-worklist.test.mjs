import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const desk=vm.runInNewContext(readFileSync(new URL("../web/inventory-worklist.js",import.meta.url),"utf8")+"\nInventoryWorklist");
test("merchandising queues use actual lot dates, stock numbers and cover types",()=>{
  const car={id:"a",stock:" Lot-7 ",price:4999,miles:0,image:"photo.jpg",lotDate:"2026-09-27"};
  const data=[car,{...car,id:"b",stock:"lot-7",imageType:"stock",miles:"",price:0,lotDate:null},{...car,id:"c"},{...car,id:"d",stock:"3",lotDate:"2026-10-28"}];
  const rows=desk.records(data,id=>id==="c"?"sold":"current","2026-11-26");
  assert.equal(rows[0].days,60);assert.equal(rows[3].days,29);assert.equal(rows[1].days,null);
  assert.deepEqual([...rows[0].issues],["duplicate"]);assert.deepEqual([...rows[1].issues],["photo","price","miles","duplicate"]);
  assert.deepEqual([...rows[2].issues],[]);
  const select=filters=>Array.from(desk.select(rows,{queue:"current",issue:"",date:"",sort:"age",search:"",...filters}),r=>r.car.id);
  assert.deepEqual(select({}),["a","d","b"]);assert.deepEqual(select({date:"aged"}),["a"]);assert.deepEqual(select({queue:"attention",issue:"photo"}),["b"]);
  assert.deepEqual(select({queue:"sold"}),["c"]);assert.deepEqual(select({date:"unknown"}),["b"]);
  assert.equal(desk.today("America/Los_Angeles",new Date("2026-11-27T03:00:00Z")),"2026-11-26");
});
