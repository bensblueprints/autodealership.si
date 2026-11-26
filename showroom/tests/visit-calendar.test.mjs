import {readFileSync} from "node:fs";
import vm from "node:vm";
import {test} from "node:test";
import assert from "node:assert/strict";
test("portable calendar file has absolute times, an hour duration, escaped text and folded UTF-8 lines",()=>{
  const source=readFileSync(new URL("../web/visit-calendar.js",import.meta.url),"utf8");
  const calendar=vm.runInNewContext(source+"\nVisitCalendar",{TextEncoder});
  const file=calendar.create({confirmation:"abc",slot:"2026-11-01T06:30:00.000Z",host:"dealer.example",stock:"A;7",
    vehicle:"Sedan\r\nATTENDEE:invalid",dealer:"Dealer, East",address:"São Paulo ".repeat(15)});
  assert.ok(file.endsWith("END:VCALENDAR\r\n"));
  for(const line of file.split("\r\n"))assert.ok(Buffer.byteLength(line)<=75);
  assert.ok(file.includes("DTSTART:20261101T063000Z\r\nDTEND:20261101T073000Z"));
  assert.ok(file.includes("UID:abc@dealer.example"));
  assert.ok(file.includes("Sedan\\nATTENDEE:invalid"));assert.ok(!file.includes("\r\nATTENDEE"));
  assert.ok(file.replace(/\r\n /g,"").includes("LOCATION:Dealer\\, East\\, São Paulo"));
});
