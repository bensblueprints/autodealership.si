const opportunityStages=["New","Working","Appointment","Won","Lost"];
const conversationEmail=value=>typeof value==="string" && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()) && value.trim().length<=254?value.trim().toLowerCase():"";
async function opportunityTables(c){
  if((await c.query("SELECT to_regclass('sales_email_messages') AS t")).rows[0].t)return;
  await c.query("SELECT pg_advisory_xact_lock(81454,2)");
  await c.query(`CREATE TABLE IF NOT EXISTS sales_opportunities(id uuid PRIMARY KEY,thread_key text UNIQUE NOT NULL,name text NOT NULL,phone text,email text,owner jsonb,stage text NOT NULL DEFAULT 'New',revision int NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),history jsonb NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS sales_email_messages(id uuid PRIMARY KEY,opportunity uuid NOT NULL,provider_id text UNIQUE,direction text NOT NULL,address text NOT NULL,subject text NOT NULL,body text NOT NULL,state text NOT NULL,actor text,created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS sales_email_thread ON sales_email_messages(opportunity,created_at DESC)`);
}
async function lockClientIdentity(c){
  await c.query("SELECT pg_advisory_xact_lock(hashtext(current_database()||'.'||current_schema()),81455)");
}
async function clientIdentity(c,lead){
  const supplied=String(lead.phone||"").trim(),digits=supplied.replace(/\D/g,"");
  const phone=InquiryContact.phoneNumber(supplied.replace(/\./g," "))||(/^\+?[\d ().-]+$/.test(supplied) && /^\d{7,15}$/.test(digits)?(supplied.startsWith("+")?"+":"")+digits:null);
  const email=conversationEmail(lead.email)||null;
  let key=phone?"tel:"+phone:email?"email:"+email:"inquiry:"+(lead.id||lead.confirmation);
  // Serialize contact matching within one rooftop, including simultaneous inquiry and booking submissions.
  await lockClientIdentity(c);
  if(email){
    const matches=(await c.query("SELECT thread_key,phone FROM sales_opportunities WHERE email=$1 AND ($2::text IS NULL OR phone IS NULL OR phone=$2) ORDER BY id LIMIT 2",[email,phone])).rows;
    if(matches.length===1 && (!phone || !matches[0].phone)){
      const exact=phone && (await c.query("SELECT 1 FROM sales_opportunities WHERE thread_key=$1",[key])).rowCount;
      if(!exact)key=matches[0].thread_key;
    }
  }
  // A reply to the same store and number stays in the same conversation across different vehicles.
  const owner=lead.followUp?.owner;
  const result=await c.query(`INSERT INTO sales_opportunities(id,thread_key,name,phone,email,owner,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(thread_key) DO UPDATE SET
    updated_at=greatest(sales_opportunities.updated_at,excluded.updated_at),
    name=CASE WHEN sales_opportunities.name=sales_opportunities.phone THEN excluded.name ELSE sales_opportunities.name END,
    email=coalesce(sales_opportunities.email,excluded.email),phone=coalesce(sales_opportunities.phone,excluded.phone),
    thread_key=CASE WHEN sales_opportunities.phone IS NULL AND excluded.phone IS NOT NULL THEN 'tel:'||excluded.phone ELSE sales_opportunities.thread_key END RETURNING id`,
    [crypto.randomUUID(),key,lead.name||phone||email||"Shopper",phone,email,owner||null,Number.isFinite(Date.parse(lead.createdAt))?lead.createdAt:new Date().toISOString()]);
  return result.rows[0].id;
}
async function attachOpportunity(c,lead){
  const id=await clientIdentity(c,lead);
  await c.query("UPDATE shopper_leads SET body=jsonb_set(body,'{opportunityId}',to_jsonb($2::text)) WHERE id=$1",[lead.id,id]);
  return id;
}
export async function recordShopperInquiry(db,lead){
  return db.transaction(async c=>{
    await opportunityTables(c);
    const inserted=await c.query("INSERT INTO shopper_leads(id,body) VALUES($1,$2) ON CONFLICT DO NOTHING",[lead.id,lead]);
    if(inserted.rowCount)await attachOpportunity(c,lead);
    return {status:200,rowCount:inserted.rowCount};
  });
}
async function backfillOpportunities(c){
  await opportunityTables(c);
  if(!(await c.query("SELECT 1 FROM shopper_leads WHERE NOT body ? 'opportunityId' LIMIT 1")).rowCount)return;
  await lockClientIdentity(c);
  const missing=await c.query("SELECT id,body FROM shopper_leads WHERE NOT body ? 'opportunityId' ORDER BY body->>'createdAt',id FOR UPDATE");
  for(const {id,body} of missing.rows)await attachOpportunity(c,{...body,id});
}
async function opportunityFromSms(c,phone,text,control){
  await opportunityTables(c);
  await lockClientIdentity(c);
  // Resolve older requests before creating an SMS-only inquiry.
  const missing=await c.query("SELECT body FROM shopper_leads WHERE NOT body ? 'opportunityId' AND body#>>'{textReplyRequest,number}'=$1 FOR UPDATE",[phone]);
  for(const {body} of missing.rows)await attachOpportunity(c,body);
  const row=(await c.query("SELECT id FROM sales_opportunities WHERE thread_key=$1",["tel:"+phone])).rows[0];
  if(row){
    await c.query("UPDATE sales_opportunities SET updated_at=now() WHERE id=$1",[row.id]);
    if((await c.query("SELECT 1 FROM shopper_leads WHERE body->>'opportunityId'=$1 AND body#>>'{textReplyRequest,number}'=$2 LIMIT 1",[row.id,phone])).rowCount)return;
  }
  if(control)return;
  const at=new Date().toISOString(),lead={id:crypto.randomUUID(),createdAt:at,status:"New",source:"Incoming text",name:phone,phone,message:text,
    textReplyRequest:{number:phone,purpose:"vehicle-inquiry",channel:"inbound-sms",version:InquiryContact.version,requestedAt:at,disclosure:"Shopper initiated this text conversation."}};
  await c.query("INSERT INTO shopper_leads(id,body) VALUES($1,$2)",[lead.id,lead]);await attachOpportunity(c,lead);
}
export async function readSalesConversations(db,{id,queue,search,team,offset=0}){
  return db.transaction(async c=>{
    await backfillOpportunities(c);
    if(!id){
      const {rows}=await c.query(`SELECT o.id,o.name,o.phone,o.email,o.owner,o.stage,o.revision,o.updated_at,
        coalesce((SELECT string_agg(DISTINCT l.body#>>'{car,stock}',', ') FROM shopper_leads l WHERE l.body->>'opportunityId'=o.id::text),'') AS stocks
        FROM sales_opportunities o WHERE ($1='all' OR ($1='mine' AND owner->>'id'=$2) OR ($1='unassigned' AND owner IS NULL))
        AND ($3='' OR position(lower($3) in lower(concat_ws(' ',o.name,o.phone,o.email)))>0 OR EXISTS(SELECT 1 FROM shopper_leads l WHERE l.body->>'opportunityId'=o.id::text AND position(lower($3) in lower(concat_ws(' ',l.body#>>'{car,stock}',l.body#>>'{car,vin}',l.body->>'name')))>0))
        ORDER BY o.updated_at DESC,o.id LIMIT 51 OFFSET $4`,[queue||"all",team.me.id,String(search||"").trim().slice(0,160),offset]);
      return smsResult(200,{items:rows.slice(0,50),more:rows.length>50});
    }
    if(!smsUuid.test(id))return smsError(400,"Choose a conversation.");
    const op=(await c.query("SELECT * FROM sales_opportunities WHERE id=$1",[id])).rows[0];
    if(!op)return smsError(404,"Conversation unavailable.");
    await smsTables(c);
    const leads=(await c.query("SELECT body-'followUp' AS lead FROM shopper_leads WHERE body->>'opportunityId'=$1 ORDER BY body->>'createdAt' DESC,id",[id])).rows.map(r=>r.lead);
    const texts=op.phone?(await c.query("SELECT id,direction,body,state,stock,actor,created_at FROM inquiry_sms_messages WHERE phone=$1 ORDER BY created_at DESC,id DESC LIMIT 100",[op.phone])).rows:[];
    const emails=(await c.query("SELECT id,direction,body,state,subject,address,actor,created_at FROM sales_email_messages WHERE opportunity=$1 ORDER BY created_at DESC,id DESC LIMIT 100",[id])).rows;
    const calls=(await c.query("SELECT to_regclass('staff_calls') AS t")).rows[0].t?(await c.query("SELECT id,actor,state,phone,seconds,created_at FROM staff_calls WHERE opportunity=$1 AND parent_sid IS NOT NULL ORDER BY created_at DESC LIMIT 100",[id])).rows:[];
    const timeline=[...calls.map(v=>({...v,channel:"Call",direction:"out",body:"Outgoing call to "+v.phone+(v.seconds!=null?" · "+v.seconds+" seconds":"")})),...texts.map(v=>({...v,channel:"SMS"})),...emails.map(v=>({...v,channel:"Email"})),
      ...leads.filter(l=>l.source!=="Incoming text").map(l=>({id:l.id,channel:l.source||"Showroom inquiry",direction:"in",body:l.message,stock:l.car?.stock,created_at:l.createdAt}))].sort((a,b)=>+new Date(a.created_at)-+new Date(b.created_at));
    delete op.thread_key;
    return smsResult(200,{opportunity:op,timeline,leads:leads.map(l=>({id:l.id,stock:l.car?.stock,name:l.name,phone:l.phone,email:l.email,source:l.source,textReplyRequest:l.textReplyRequest,textDraft:l.textDraft,car:l.car})),canEdit:team.manager||!op.owner||op.owner.id===team.me.id});
  });
}
export async function changeSalesOpportunity(db,input,team){
  return db.transaction(async c=>{
    await opportunityTables(c);
    if(!smsUuid.test(input?.id||"") || !opportunityStages.includes(input.stage) || !Number.isInteger(input.revision))return smsError(400,"Check the opportunity details.");
    const op=(await c.query("SELECT owner,revision,stage FROM sales_opportunities WHERE id=$1 FOR UPDATE",[input.id])).rows[0];
    if(!op)return smsError(404,"Conversation unavailable.");
    if(op.revision!==input.revision)return smsError(409,"Another team member updated this opportunity. Refresh to continue.");
    if(!team.manager && (op.owner && op.owner.id!==team.me.id || input.owner!==team.me.id))return smsError(403,"A manager can reassign this conversation. Salespeople can claim unassigned conversations.");
    const owner=input.owner===null?null:team.members.find(m=>m.id===input.owner);
    if(input.owner && !owner)return smsError(422,"Select an active dealership team member.");
    if(op.stage===input.stage && (op.owner?.id||null)===(owner?.id||null))return smsResult(200,{revision:op.revision});
    const entry={at:new Date().toISOString(),actor:team.me,owner,stage:input.stage};
    await c.query("UPDATE sales_opportunities SET owner=$2,stage=$3,updated_at=now(),revision=revision+1,history=history||jsonb_build_array($4::jsonb) WHERE id=$1",[input.id,owner,input.stage,entry]);
    return smsResult(200,{revision:op.revision+1});
  });
}
export async function saveOpportunityDraft(db,input,actor){
  return db.transaction(async c=>{
    await opportunityTables(c);
    const lead=await smsLead(c,input.id,true);
    if(!lead || lead.textReplyRequest?.version!==InquiryContact.version)return smsError(409,"This inquiry has no text request.");
    const id=lead.opportunityId||await attachOpportunity(c,lead);
    const owner=(await c.query("SELECT owner FROM sales_opportunities WHERE id=$1 FOR SHARE",[id])).rows[0]?.owner||lead.followUp?.owner;
    if(owner && owner.id!==actor.id && !actor.manager)return smsError(403,"The assigned salesperson or a manager can edit the reply.");
    if((lead.textDraft?.revision||"")!==input.revision)return smsError(409,"Another team member changed this draft. Reopen the conversation.");
    const text=input.text.trim(),draft=text===lead.textDraft?.text?lead.textDraft:{text,revision:crypto.randomUUID(),updatedAt:new Date().toISOString()};
    await c.query("UPDATE shopper_leads SET body=jsonb_set(body,'{textDraft}',$2::jsonb) WHERE id=$1",[input.id,draft]);
    return smsResult(200,draft);
  });
}
export async function queueConversationMail(db,input,actor,mailbox,personal=null){
  if(!smsUuid.test(input?.id||"")||!smsUuid.test(input?.request||"")||typeof input.body!=="string"||!input.body.trim()||input.body.length>5000||typeof input.subject!=="string"||!input.subject.trim()||input.subject.length>200||/[\r\n]/.test(input.subject))return smsError(400,"Enter an email subject and reply.");
  return db.transaction(async (c,control)=>{
    if(typeof personal==="function")personal=await personal(control);
    await opportunityTables(c);
    const op=(await c.query("SELECT email,owner FROM sales_opportunities WHERE id=$1 FOR UPDATE",[input.id])).rows[0];
    if(!op)return smsError(404,"Conversation unavailable.");
    if(op.owner && op.owner.id!==actor.id && !actor.manager)return smsError(403,"The assigned salesperson or a manager can reply.");
    if(input.sender && input.sender!=="shared" && (!personal || personal.id!==input.sender || personal.paused))return smsError(409,"Reconnect your selected mailbox before sending.");
    if((!personal && !mailbox) || !conversationEmail(op.email))return smsError(409,"Connect a verified dealer mailbox and select a shopper with an email address.");
    const args=[input.request,input.id,op.email,input.subject.trim(),input.body.trim(),personal?.address||actor.label,personal?"staff queued":"queued"];
    if(personal && !(await c.query("SELECT to_regclass('staff_mail_messages') AS t")).rows[0].t){
      await c.query("SELECT pg_advisory_xact_lock(81454,3)");
      await c.query("CREATE TABLE IF NOT EXISTS staff_mail_messages(message uuid PRIMARY KEY,grant_id uuid NOT NULL,owner_id text NOT NULL,sender text NOT NULL,rfc_id text NOT NULL,thread_id text,UNIQUE(grant_id,rfc_id))");
    }
    const added=await c.query("INSERT INTO sales_email_messages(id,opportunity,direction,address,subject,body,state,actor) VALUES($1,$2,'out',$3,$4,$5,$7,$6) ON CONFLICT(id) DO NOTHING",args);
    if(added.rowCount && personal)await c.query("INSERT INTO staff_mail_messages(message,grant_id,owner_id,sender,rfc_id) VALUES($1,$2,$3,$4,$5)",[input.request,personal.id,actor.id,personal.address,"<"+input.request+"@"+personal.address.split("@")[1]+">"]);
    if(!added.rowCount){
      const linked=(await c.query("SELECT to_regclass('staff_mail_messages') AS t")).rows[0].t && (await c.query("SELECT grant_id,owner_id FROM staff_mail_messages WHERE message=$1",[input.request])).rows[0];
      if(personal?linked?.grant_id!==personal.id || linked?.owner_id!==actor.id:!!linked)return smsError(409,"Email request already used by a different sender.");
      const same=await c.query("SELECT 1 FROM sales_email_messages WHERE id=$1 AND opportunity=$2 AND address=$3 AND subject=$4 AND body=$5 AND direction='out'",args.slice(0,5));
      if(!same.rowCount)return smsError(409,"Email request already used.");
    }
    await c.query("UPDATE sales_opportunities SET updated_at=now() WHERE id=$1",[input.id]);return smsResult(200,{queued:true});
  });
}
