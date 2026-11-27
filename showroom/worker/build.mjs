import { readdirSync,readFileSync,writeFileSync,mkdirSync } from "node:fs";
import { extname,join } from "node:path";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
const types={".json":"application/json",".css":"text/css",".html":"text/html; charset=utf-8",".js":"text/javascript",".mjs":"text/javascript",".svg":"image/svg+xml",".jpg":"image/jpeg",".pdf":"application/pdf",".md":"text/plain",".txt":"text/plain"};
const files={};
function add(dir, prefix) {
  for(const item of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,item.name), route=prefix+"/"+item.name;
    if(item.isDirectory()){add(path,route);continue;}
    const type=types[extname(path)];
    if(!type)throw new Error("Specify a MIME type for "+route);
    const raw=readFileSync(path), zipped=gzipSync(raw,{level:9}), gzip=zipped.length<raw.length*0.92;
    files[route]=[type,(gzip?zipped:raw).toString("base64"),gzip];
  }
}
add("web","");
const context={window:{}};vm.runInNewContext(readFileSync("web/assets/cdjr-inventory.js","utf8"),context);
const bookingIndex="const bookingVins=new Set("+JSON.stringify(context.window.CdjrInventory.map(car=>car.vin))+");";
mkdirSync("dist/server",{recursive:true});
writeFileSync("dist/server/index.js","const files="+JSON.stringify(files)+";\n"+readFileSync("web/sticker-sources.js","utf8")+"\n"+readFileSync("web/inquiry-contact.js","utf8")+"\nexport {InquiryContact};\n"+readFileSync("web/dealer-pages.js","utf8")+"\nexport {DealerSitePages};\n"+readFileSync("web/website-offers.js","utf8")+"\nexport {WebsiteOffers};\n"+readFileSync("web/dealer-location.js","utf8")+"\nexport {DealerLocation};\n"+readFileSync("worker/vehicle-alternatives.mjs","utf8")+"\n"+readFileSync("worker/vehicle-feed.mjs","utf8")+"\n"+readFileSync("worker/storefront-reports.mjs","utf8")+"\n"+readFileSync("worker/oem.mjs","utf8")+"\n"+readFileSync("worker/conversations.mjs","utf8")+"\n"+readFileSync("worker/sales-clients.mjs","utf8")+"\n"+readFileSync("worker/reputation.mjs","utf8")+"\n"+readFileSync("worker/purchase-feedback.mjs","utf8")+"\n"+readFileSync("worker/dealer-sms.mjs","utf8")+"\n"+readFileSync("worker/staff-calls.mjs","utf8")+"\n"+readFileSync("worker/twilio-numbers.mjs","utf8")+"\n"+readFileSync("worker/sms-usage.mjs","utf8")+"\n"+readFileSync("worker/lead-followup.mjs","utf8")+"\n"+readFileSync("worker/vin-drafts.mjs","utf8")+"\n"+readFileSync("worker/inventory-desk.mjs","utf8")+"\n"+readFileSync("worker/page-evidence.mjs","utf8")+"\n"+readFileSync("worker/page-workflow.mjs","utf8")+"\n"+readFileSync("worker/visit-desk.mjs","utf8")+"\n"+readFileSync("worker/marketing.mjs","utf8")+"\n"+readFileSync("worker/profile.mjs","utf8")+"\n"+bookingIndex+"\n"+readFileSync("worker/appointments.mjs","utf8")+"\n"+readFileSync("worker/handler.mjs","utf8"));
