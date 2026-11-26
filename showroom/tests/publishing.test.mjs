import test from "node:test";
import assert from "node:assert/strict";
import {DealerSitePages,InquiryContact} from "../dist/server/index.js";

test("tenant editing, clean routes and visibility use one catalog",()=>{
  const catalog=DealerSitePages.catalog;
  assert.equal(new Set(catalog.map(p=>p.path)).size,catalog.length);
  assert.equal(new Set(catalog.map(p=>p.key)).size,catalog.length);
  const pages=DealerSitePages.list({pages:{events:{body:"Saturday sale",enabled:true},"finance-center":{enabled:true},privacy:{body:""}}},true,false);
  assert.deepEqual(pages.filter(p=>p.enabled).map(p=>p.key),["all-inventory","events"]);
  assert.ok(pages.every(p=>!p.url));
  assert.equal(DealerSitePages.list({},false).find(p=>p.key==="finance-center").url,"https://www.capcitycdjr.com/finance/");
});

test("certified inventory includes condition values used by dealer intake",()=>{
  const eligible=DealerSitePages.inventoryFilters;
  assert.ok(eligible["certified-pre-owned"]({condition:"Certified pre-owned"}));
  assert.ok(eligible["pre-owned"]({condition:"Certified"}));
  assert.ok(!eligible["under-20k"]({condition:"Used",price:null}));
});

test("legacy inquiries and callback numbers never imply a text request",()=>{
  const form={phone:"(614) 555-0100",textReplyVersion:InquiryContact.version,requestTextReply:true};
  assert.equal(InquiryContact.request({...form,requestTextReply:false},"t"),null);
  assert.equal(InquiryContact.request({...form,source:"Voice concierge"},"t"),null);
  assert.equal(InquiryContact.request({...form,textReplyVersion:"obsolete"},"t"),null);
  assert.throws(()=>InquiryContact.request({...form,phone:"missing"},"t"));
  assert.equal(InquiryContact.request(form,"t").number,"+16145550100");
});
