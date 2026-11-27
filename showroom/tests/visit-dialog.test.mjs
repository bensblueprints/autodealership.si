import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("Manage visit shares a visible editor across the Today and Scheduled test drives tabs", () => {
  const html=readFileSync(new URL("../web/dealer.html",import.meta.url),"utf8");
  const endOfTabs=html.indexOf("</main>"),editor=html.indexOf('<dialog id="visit-dialog"');
  assert.ok(endOfTabs>0 && editor>endOfTabs,"The shared editor must be outside the hideable dashboard tabs.");
  assert.equal(html.match(/id="visit-dialog"/g)?.length,1);
  for(const id of ["next-drive","drive-desk"])assert.ok(html.slice(0,endOfTabs).includes('id="'+id+'"'));
});
