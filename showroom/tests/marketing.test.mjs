import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {dealershipMarketing} from "../worker/marketing.mjs";

const databaseURL = process.env.MARKETING_TEST_DATABASE_URL;
test("campaign governance, activity reporting and rooftop isolation in PostgreSQL",{skip:!databaseURL},async () => {
  const {default:pg} = await import("pg");
  const clients = [];
  const id = randomUUID();
  const brief = {name:"Used inventory",market:"Portsmouth",program:"Used vehicles",channel:"Google Search",monthlyCents:50000,
    landingPath:"/inventory/",copy:"Explore available used vehicles.",origin:"AI-assisted",evidence:""};
  try {
    for (let i=0;i<2;i++) {
      const client=new pg.Client({connectionString:databaseURL});
      await client.connect();
      clients.push(client);
      await client.query("CREATE TEMP TABLE shopper_leads (body jsonb); CREATE TEMP TABLE appointments (body jsonb); SET search_path TO pg_temp");
    }
    const [dealer,other]=clients;
    const read=(db,historyId)=>dealershipMarketing({method:"GET",db,historyId});
    const write=(revision,action,values={},canReview=true)=>dealershipMarketing({db:dealer,method:"POST",actor:canReview?"test-admin":"test-sales",canReview,input:{id,revision,action,...values}});
    await dealer.query("INSERT INTO shopper_leads VALUES ($1), ($2)",[{createdAt:new Date().toISOString()},{createdAt:"2010-01-01T00:00:00.000Z"}]);
    await dealer.query("INSERT INTO appointments VALUES ($1)",[{createdAt:new Date().toISOString(),slot:"2099-01-01"}]);
    let result=await read(dealer);
    assert.equal(result.data.report.inquiries,1);
    assert.equal(result.data.report.bookings,1);
    assert.equal((await write(0,"save",{brief:{...brief,landingPath:"//different.example/"}})).status,400);
    assert.equal((await write(0,"save",{brief})).status,201);
    assert.equal((await write(0,"save",{brief})).status,409);
    assert.equal((await write(1,"submit")).status,422);
    brief.evidence="Stock 101, dealer inventory";
    assert.equal((await write(1,"save",{brief})).status,200);
    assert.equal((await write(2,"submit")).status,200);
    assert.equal((await write(3,"save",{brief})).status,409);
    assert.equal((await write(3,"approve",{verified:true},false)).status,403);
    assert.equal((await write(3,"approve")).status,422);
    assert.equal((await write(3,"return")).status,400);
    assert.equal((await write(3,"return",{note:"Please verify the listed stock."})).status,200);
    assert.equal((await write(4,"submit")).status,200);
    const decisions=await Promise.all([write(5,"approve",{verified:true}),write(5,"approve",{verified:true})]);
    assert.deepEqual(decisions.map(d=>d.status).sort(),[200,409]);
    const approved=(await read(dealer)).data.campaigns[0];
    assert.equal(approved.state,"approved");
    assert.equal(approved.revision,6);
    assert.equal((await write(6,"save",{brief:{...brief,copy:"Updated ad copy."}})).status,200);
    assert.equal((await read(dealer)).data.campaigns[0].state,"draft");
    const history=(await read(dealer,id)).data;
    assert.equal(history.find(entry=>entry.action==="approve").brief.copy,brief.copy);
    result=await read(other);
    assert.equal(result.data.campaigns.length,0);
    assert.equal(result.data.report.inquiries,0);
    assert.equal((await read(other,id)).status,404);
  } finally { await Promise.all(clients.map(client=>client.end())); }
});
