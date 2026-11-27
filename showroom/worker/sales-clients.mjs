// Client identity is shared with Conversations. A vehicle has its own sales stage and contract.
const clientStages=["intake","inquiry","scheduled","attended","followup","presented","signed"];
async function clientTables(c){
  await opportunityTables(c);
  if((await c.query("SELECT to_regclass('sales_client_deals') AS t")).rows[0].t)return;
  await c.query("SELECT pg_advisory_xact_lock(81454,9)");
  await c.query(`CREATE TABLE IF NOT EXISTS sales_client_intakes (
      request uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES sales_opportunities, source text NOT NULL,
      vin text NOT NULL, car jsonb, note text NOT NULL, actor text NOT NULL, at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS sales_client_contracts (
      client_id uuid NOT NULL REFERENCES sales_opportunities,vin text NOT NULL,stage text NOT NULL,
      cents bigint CHECK(cents>0),revision int NOT NULL,history jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(client_id,vin));
    CREATE INDEX IF NOT EXISTS client_visit_person ON appointments ((body->>'opportunityId'));
    CREATE INDEX IF NOT EXISTS client_inquiry_person ON shopper_leads ((body->>'opportunityId'));
    CREATE INDEX IF NOT EXISTS client_intake_person ON sales_client_intakes(client_id);
    CREATE OR REPLACE VIEW sales_client_deals AS
    WITH touches AS (
      SELECT body->>'opportunityId' AS person,coalesce(body#>>'{car,vin}',body->>'carId','') AS vin,body->'car' AS car,
        CASE WHEN body->>'source'='Incoming text' THEN 0 ELSE 1 END AS step, body->>'createdAt' AS at FROM shopper_leads
      UNION ALL SELECT body->>'opportunityId',body->>'vin',body->'car',
        CASE coalesce(body#>>'{visit,state}','scheduled') WHEN 'attended' THEN 3 WHEN 'scheduled' THEN 2 ELSE -1 END,
        coalesce(body#>>'{visit,history,-1,at}',body->>'createdAt',body->>'slot') FROM appointments
      UNION ALL SELECT client_id::text,vin,car,0,to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM sales_client_intakes
    ), grouped AS (SELECT person,vin,(array_agg(car ORDER BY at DESC NULLS LAST) FILTER(WHERE car IS NOT NULL))[1] AS car,
      max(step) AS step,bool_or(step=-1) AS needs_followup,max(at) AS at,
      max(at) FILTER(WHERE step IN(2,3)) AS visit_at,
      (array_agg(step ORDER BY at DESC NULLS LAST) FILTER(WHERE step IN(2,3)))[1] AS last_visit_step FROM touches WHERE person IS NOT NULL GROUP BY person,vin)
    SELECT g.person,g.vin,g.car,coalesce(CASE WHEN d.stage='followup' AND g.visit_at::timestamptz>d.updated_at THEN CASE g.last_visit_step WHEN 3 THEN 'attended' ELSE 'scheduled' END ELSE d.stage END,CASE WHEN g.step=3 THEN 'attended' WHEN g.step=2 THEN 'scheduled'
      WHEN g.needs_followup THEN 'followup' WHEN g.step=1 THEN 'inquiry' ELSE 'intake' END) AS stage,
      d.cents,coalesce(d.revision,0) AS revision, greatest(d.updated_at,g.at::timestamptz) AS updated_at
      FROM grouped g LEFT JOIN sales_client_contracts d ON d.client_id::text=g.person AND d.vin=g.vin`);
}
async function clientBackfill(c){
  await clientTables(c);
  await backfillOpportunities(c);
  if(!(await c.query("SELECT 1 FROM appointments WHERE NOT body ? 'opportunityId' LIMIT 1")).rowCount)return;
  await lockClientIdentity(c);
  const old=await c.query("SELECT confirmation,body FROM appointments WHERE NOT body ? 'opportunityId' ORDER BY confirmation FOR UPDATE");
  for(const {confirmation,body} of old.rows){
    const id=await clientIdentity(c,{...body,confirmation});
    await c.query("UPDATE appointments SET body=jsonb_set(body,'{opportunityId}',to_jsonb($2::text)) WHERE confirmation=$1",[confirmation,id]);
  }
}
async function insertClientVisit(c,key,record){
  const saved=await c.query(`INSERT INTO appointments(key,confirmation,body)
    SELECT $1,$2,$3::jsonb || jsonb_build_object('car',jsonb_strip_nulls(jsonb_build_object('year',body->'year','make',body->'make','model',body->'model','stock',body->'stock','image',body->'image')))
    FROM client_cars WHERE vin=$4 AND NOT EXISTS(SELECT 1 FROM inventory_status WHERE vin=$4) ON CONFLICT DO NOTHING`,
    [key,record.confirmation,record,record.vin]);
  if(saved.rowCount && !record.opportunityId){
    const id=await clientIdentity(c,record);
    await c.query("UPDATE appointments SET body=jsonb_set(body,'{opportunityId}',to_jsonb($2::text)) WHERE confirmation=$1",[record.confirmation,id]);
  }
  return saved.rowCount;
}
export async function recordClientVisit(db,key,record){
  return db.transaction(async c=>{
    await opportunityTables(c);
    await lockClientIdentity(c);
    return {status:200,rowCount:await insertClientVisit(c,key,record)};
  });
}
const editableClient=(op,team)=>team.manager || !op.owner || op.owner.id===team.me.id;
async function clientRecord(c,id){
  return (await c.query("SELECT id,name,phone,email,owner FROM sales_opportunities WHERE id=$1 FOR UPDATE",[id])).rows[0];
}
export async function salesClients(db,method,input,team){
  const fail=smsError,ok=data=>smsResult(200,data);
  if(!input || typeof input!=="object")return fail(400,"Invalid client request.");
  return db.transaction(async c=>{
    await clientBackfill(c);
    if(method==="GET" && !input.id && !input.visit){
      const search=String(input.search||"").trim().slice(0,160),stage=input.stage||"",offset=Number(input.offset||0);
      if(stage && !clientStages.includes(stage) || !Number.isSafeInteger(offset)||offset<0||offset>1000000)return fail(400,"Invalid client filter.");
      const rows=(await c.query(`WITH matching AS (
        SELECT DISTINCT ON(o.id) o.id,o.name,o.phone,o.email,o.owner,d.stage,d.car,d.vin,d.updated_at
        FROM sales_opportunities o JOIN sales_client_deals d ON d.person=o.id::text
        WHERE ($2='' OR d.stage=$2) AND ($1='' OR position(lower($1) in lower(concat_ws(' ',o.name,o.phone,o.email,d.car->>'stock',d.vin)))>0)
        ORDER BY o.id,d.updated_at DESC NULLS LAST,d.vin)
        SELECT * FROM matching ORDER BY updated_at DESC NULLS LAST,id LIMIT 51 OFFSET $3`,[search,stage,offset])).rows;
      return ok({items:rows.slice(0,50),more:rows.length>50});
    }
    if(method==="POST" && input.action==="intake"){
      const {name,phone,email="",source,request,vin="",note=""}=input;
      if(typeof name!=="string"||!name.trim()||name.length>100||typeof phone!=="string"||
        !/^\+?[\d ().-]{7,40}$/.test(phone.trim())||!/^\d{7,15}$/.test(phone.replace(/\D/g,""))||
        typeof email!=="string"||email && !conversationEmail(email)||!["Phone call","Walk-in","Referral","Other"].includes(source)||
        !smsUuid.test(request||"")||typeof vin!=="string"||typeof note!=="string"||note.length>2000)return fail(422,"Enter a name, callback number and valid intake details.");
      let car=null;
      if(vin){
        car=(await c.query("SELECT jsonb_build_object('year',body->'year','make',body->'make','model',body->'model','stock',body->'stock','vin',vin) AS car FROM client_cars WHERE vin=$1 AND NOT EXISTS(SELECT 1 FROM inventory_status WHERE vin=$1)",[vin])).rows[0]?.car;
        if(!car)return fail(422,"Choose an available vehicle.");
      }
      const id=await clientIdentity(c,{name:name.trim(),phone,email});
      const op=await clientRecord(c,id);
      if(!editableClient(op,team))return fail(403,"Ask the assigned salesperson or manager to update this client.");
      const entry=[request,id,source,vin,car,note.trim(),team.me.label];
      const saved=await c.query("INSERT INTO sales_client_intakes(request,client_id,source,vin,car,note,actor) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",entry);
      if(!saved.rowCount && !(await c.query("SELECT 1 FROM sales_client_intakes WHERE request=$1 AND client_id=$2 AND source=$3 AND vin=$4 AND note=$5",[request,id,source,vin,note.trim()])).rowCount)return fail(409,"This intake reference is already in use.");
      return ok({id});
    }
    let id=input.id;
    if(method==="GET" && input.visit){
      if(!smsUuid.test(input.visit))return fail(400,"Invalid appointment.");
      id=(await c.query("SELECT body->>'opportunityId' AS id FROM appointments WHERE confirmation=$1",[input.visit])).rows[0]?.id;
      if(!id)return fail(404,"Appointment unavailable.");
    }
    if(!smsUuid.test(id||""))return fail(400,"Choose a client.");
    if(method==="POST" && input.action==="book")await lockClientIdentity(c);
    const op=await clientRecord(c,id);
    if(!op)return fail(404,"Client unavailable at this dealership.");
    if(method==="GET"){
      const deals=(await c.query("SELECT vin,car,stage,cents,revision FROM sales_client_deals WHERE person=$1 ORDER BY updated_at DESC NULLS LAST,vin",[id])).rows;
      const visits=(await c.query(`SELECT confirmation,body->>'vin' AS vin,body->>'createdAt' AS at,body->>'slot' AS slot,body->>'message' AS note,notes,
        coalesce(body#>>'{visit,state}','scheduled') AS state,body#>'{visit,history}' AS history FROM appointments WHERE body->>'opportunityId'=$1`,[id])).rows;
      const inquiries=(await c.query("SELECT body->>'createdAt' AS at,body->>'source' AS source,body->>'message' AS note,body#>>'{car,vin}' AS vin FROM shopper_leads WHERE body->>'opportunityId'=$1",[id])).rows;
      const intakes=(await c.query("SELECT source,note,vin,actor,at FROM sales_client_intakes WHERE client_id=$1",[id])).rows;
      const changes=(await c.query("SELECT vin,jsonb_array_elements(history) AS change FROM sales_client_contracts WHERE client_id=$1",[id])).rows;
      return ok({client:op,deals,visits,inquiries,intakes,changes,canEdit:editableClient(op,team)});
    }
    if(!editableClient(op,team))return fail(403,"The assigned salesperson or manager can update this client.");
    if(method==="POST" && input.action==="book"){
      const {vin,slot,request,note=""}=input;
      if(!op.phone || !smsUuid.test(request||"")||typeof vin!=="string"||typeof slot!=="string"||typeof note!=="string"||note.length>2000)return fail(422,"A callback number, vehicle and appointment time are required.");
      const old=(await c.query("SELECT body FROM appointments WHERE confirmation=$1",[request])).rows[0]?.body;
      if(old)return old.opportunityId===id && old.conversion?.channel==="dealer" && old.vin===vin && (old.originalSlot||old.slot)===slot && old.message===note.trim() && old.visit?.state!=="canceled"?ok({id,confirmation:request,slot:old.slot}):fail(409,"This booking reference has already been used.");
      const profile=(await c.query("SELECT settings->'profile' AS profile FROM client_profile WHERE id=1")).rows[0]?.profile||{};
      if(!driveSlots(profile.driveHours,profile.driveTimezone).includes(slot))return fail(422,"Choose a time within the dealership’s available hours.");
      const at=new Date().toISOString(),record={opportunityId:id,vin,slot,confirmation:request,name:op.name,phone:op.phone,email:op.email||"",message:note.trim(),createdAt:at,bookedBy:team.me.label,
        conversion:{type:"test_drive_booked",eventId:"test_drive_booked:"+request,channel:"dealer",occurredAt:at}};
      return await insertClientVisit(c,"appointments/"+vin+"/"+slot,record)?ok({id,confirmation:request,slot}):fail(409,"This vehicle or time is unavailable. Refresh the available times.");
    }
    if(method!=="PUT")return fail(405,"Unsupported client action.");
    const {vin,stage,revision,cents,note=""}=input;
    if(typeof vin!=="string"||typeof note!=="string"||note.length>2000||!Number.isInteger(revision)||
      !["followup","presented","signed"].includes(stage)||cents!==null && (!Number.isSafeInteger(cents)||cents<=0||cents>99999999999)||
      (stage==="signed" && cents===null)||(!vin && stage!=="followup")||(stage==="followup" && cents!==null))return fail(422,"Choose a sales stage and enter a positive USD contract value for a signed purchase.");
    const deal=(await c.query("SELECT stage,cents,revision FROM sales_client_deals WHERE person=$1 AND vin=$2",[id,vin])).rows[0];
    if(!deal)return fail(404,"This vehicle is not linked to this client.");
    if(deal.revision!==revision)return fail(409,"This deal changed. Reopen the client before saving.");
    if(deal.stage==="signed" && (stage!=="signed" || !team.manager && Number(deal.cents)!==cents))return fail(403,"A manager can correct the value of a signed contract.");
    if(deal.stage===stage && (deal.cents===null?null:Number(deal.cents))===cents && !note.trim())return ok({id,revision});
    const event={at:new Date().toISOString(),stage,cents,note:note.trim(),actor:team.me.label};
    await c.query(`INSERT INTO sales_client_contracts(client_id,vin,stage,cents,revision,history) VALUES($1,$2,$3,$4,1,jsonb_build_array($5::jsonb))
      ON CONFLICT(client_id,vin) DO UPDATE SET stage=excluded.stage,cents=excluded.cents,revision=sales_client_contracts.revision+1,
      updated_at=now(),history=sales_client_contracts.history||excluded.history`,[id,vin,stage,cents,event]);
    return ok({id,revision:revision+1});
  });
}
