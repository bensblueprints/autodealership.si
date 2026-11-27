const smsUuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const smsPhone=/^\+[1-9][0-9]{7,14}$/;
const smsSid=/^(SM|MM)[0-9a-f]{32}$/i;
const smsResult=(status,data)=>({status,data});
const smsError=(status,error)=>smsResult(status,{error});
const smsStatuses=["pending","unconfirmed","accepted","queued","sending","sent","delivered","undelivered","failed","canceled"];
const smsFinal=["delivered","undelivered","failed","canceled"];

export function dealerSmsRoute(routes,site) {
  const r=routes?.[site];
  if(!r || !/^AC[0-9a-f]{32}$/i.test(r.account||"") || !/^MG[0-9a-f]{32}$/i.test(r.service||"") || !smsPhone.test(r.from||"") || !/^[a-z0-9]{32}$/i.test(r.authToken||""))return null;
  if(Object.values(routes).some(other=>other!==r && (other.from===r.from || other.account===r.account || other.service===r.service)))return null;
  return r;
}

async function smsTables(c){
  const exists=await c.query("SELECT to_regclass('inquiry_sms_messages') AS messages");
  if(exists.rows[0].messages)return;
  await c.query("SELECT pg_advisory_xact_lock(81454,1)");
  await c.query(`CREATE TABLE IF NOT EXISTS inquiry_sms_contacts(phone text PRIMARY KEY,blocked boolean NOT NULL,changed_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS inquiry_sms_messages(id uuid PRIMARY KEY,sid text UNIQUE,phone text NOT NULL,sender text NOT NULL,inquiry uuid,stock text,direction text NOT NULL,body text NOT NULL,state text NOT NULL,actor text,created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS sms_phone_time ON inquiry_sms_messages(phone,created_at DESC)`);
}

async function smsLead(c,id,lock=false){
  if(!smsUuid.test(id||""))return null;
  return (await c.query("SELECT body FROM shopper_leads WHERE id=$1"+(lock?" FOR UPDATE":""),[id])).rows[0]?.body;
}

async function smsPermission(c,lead,actor,route){
  const pref=lead?.textReplyRequest;
  if(pref?.version!=="inquiry-text-reply-v1" || pref.purpose!=="vehicle-inquiry" || !smsPhone.test(pref.number))return "A shopper request for a text about this inquiry is required.";
  if(lead.status==="Closed")return "Reopen this inquiry before replying.";
  let owner=lead.followUp?.owner;
  if(lead.opportunityId)owner=(await c.query("SELECT owner FROM sales_opportunities WHERE id=$1",[lead.opportunityId])).rows[0]?.owner||owner;
  if(owner && owner.id!==actor.id && !actor.manager)return "The assigned salesperson or a manager can reply.";
  const contact=(await c.query("SELECT blocked,changed_at FROM inquiry_sms_contacts WHERE phone=$1",[pref.number])).rows[0];
  if(contact?.blocked)return "This shopper has opted out of texts.";
  if(contact && !(Date.parse(pref.requestedAt)>new Date(contact.changed_at).getTime()))return "A new shopper text request is required after an opt-out.";
  if(route?.outbound!==true)return "Dealer texting is not connected for sending.";
  return "";
}

export async function dealerSmsThread(db,{id,message,actor,route}){
  return db.transaction(async c=>{
    await smsTables(c);
    if(!id && !message){
      const {rows}=await c.query(`SELECT id,phone,direction,body,state,created_at FROM (
        SELECT DISTINCT ON(phone) id,phone,direction,body,state,created_at FROM inquiry_sms_messages ORDER BY phone,created_at DESC,id DESC
      ) recent ORDER BY created_at DESC,id DESC LIMIT 50`);
      return smsResult(200,{threads:rows});
    }
    const lead=id?await smsLead(c,id):null;
    const phone=lead?.textReplyRequest?.number || (!id && smsUuid.test(message||"") && (await c.query("SELECT phone FROM inquiry_sms_messages WHERE id=$1",[message])).rows[0]?.phone);
    if(!phone)return smsError(404,"Text conversation unavailable.");
    const {rows}=await c.query(`SELECT id,inquiry,stock,direction,body,state,actor,created_at FROM inquiry_sms_messages
      WHERE phone=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[phone]);
    const reason=lead?await smsPermission(c,lead,actor,route):"Open a shopper’s text request to reply.";
    return smsResult(200,{phone,messages:rows.reverse(),reason,from:route?.from||null});
  });
}

async function smsLock(c,phone){await c.query("SELECT pg_advisory_xact_lock(81455,hashtext($1))",[phone]);}
async function smsUpdateDelivery(c,id,sid,state){
  if(!smsStatuses.includes(state) || !smsSid.test(sid||""))return false;
  const row=(await c.query("SELECT sid,state FROM inquiry_sms_messages WHERE id=$1 AND direction='out' FOR UPDATE",[id])).rows[0];
  if(!row || (row.sid && row.sid!==sid))return false;
  if(smsFinal.includes(row.state) || smsStatuses.indexOf(state)<smsStatuses.indexOf(row.state))return true;
  await c.query("UPDATE inquiry_sms_messages SET sid=$2,state=$3 WHERE id=$1",[id,sid,state]);return true;
}

export async function sendInquirySms(db,{id,revision,actor,route,origin},transport=fetch){
  if(!smsUuid.test(id||"") || !smsUuid.test(revision||""))return smsError(400,"Save a reply draft before sending.");
  const reserved=await db.transaction(async c=>{
    await smsTables(c);
    const lead=await smsLead(c,id,true);
    if(!lead)return smsError(404,"Inquiry unavailable.");
    const draft=lead.textDraft;
    if(draft?.revision!==revision || !draft.text?.trim())return smsError(409,"This draft changed. Reopen the conversation to review it.");
    const reason=await smsPermission(c,lead,actor,route);
    if(reason)return smsError(409,reason);
    const phone=lead.textReplyRequest.number;
    if((await c.query("SELECT 1 FROM inquiry_sms_messages WHERE id=$1",[revision])).rowCount)return smsResult(200,{created:false,phone});
    const insert=await c.query(`INSERT INTO inquiry_sms_messages(id,phone,sender,inquiry,stock,direction,body,state,actor)
      VALUES($1,$2,$3,$4,$5,'out',$6,'pending',$7) ON CONFLICT(id) DO NOTHING RETURNING id`,[revision,phone,route.from,id,lead.car?.stock||null,draft.text,actor.label]);
    return smsResult(200,{created:!!insert.rowCount,phone});
  });
  if(reserved.status!==200)return reserved;
  // Commit the attempt ID before contacting Twilio. A retry can read it, never send it again.
  return db.transaction(async c=>{
    const phone=reserved.data.phone;
    await smsLock(c,phone);
    const record=(await c.query("SELECT state,body FROM inquiry_sms_messages WHERE id=$1 FOR UPDATE",[revision])).rows[0];
    if(!reserved.data.created || record.state!=="pending")return smsResult(200,{state:record.state});
    const lead=await smsLead(c,id,true);
    const reason=await smsPermission(c,lead,actor,route);
    if(reason || lead.textDraft?.revision!==revision){
      await c.query("UPDATE inquiry_sms_messages SET state='canceled' WHERE id=$1",[revision]);return smsResult(200,{state:"canceled"});
    }
    const params=new URLSearchParams({From:route.from,To:phone,MessagingServiceSid:route.service,Body:record.body,StatusCallback:origin+"/api/dealer-sms/status?id="+revision});
    let state="unconfirmed";
    try{
      const res=await transport("https://api.twilio.com/2010-04-01/Accounts/"+route.account+"/Messages.json",{
        method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),body:params,headers:{Authorization:"Basic "+btoa(route.account+":"+route.authToken)}});
      const data=await res.json();
      if(res.ok && smsSid.test(data.sid||"")){
        state=smsStatuses.includes(data.status)?data.status:"accepted";
        await smsUpdateDelivery(c,revision,data.sid,state);
      }else if(res.status>=400 && res.status<500 && data.code){
        state="failed";
        if(Number(data.code)===21610)await c.query("INSERT INTO inquiry_sms_contacts VALUES($1,true,now()) ON CONFLICT(phone) DO UPDATE SET blocked=true,changed_at=now()",[phone]);
      }
    }catch{/* A lost response can still mean Twilio accepted the message. Await its signed callback. */}
    if(["failed","unconfirmed"].includes(state))await c.query("UPDATE inquiry_sms_messages SET state=$2 WHERE id=$1",[revision,state]);
    return smsResult(200,{state});
  });
}

export async function dealerSmsWebhook(db,{route,origin,path,params,signature}){
  if(!route || params.get("AccountSid")!==route.account || !/^[A-Za-z0-9+/]{27}=$/.test(signature||""))return smsError(403,"Invalid sender.");
  const keys=[...new Set(params.keys())].sort();
  const signed=origin+path+keys.map(k=>[...new Set(params.getAll(k))].sort().map(v=>k+v).join("")).join("");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(route.authToken),{name:"HMAC",hash:"SHA-1"},false,["verify"]);
  if(!await crypto.subtle.verify("HMAC",key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),new TextEncoder().encode(signed)))return smsError(403,"Invalid signature.");
  const sid=params.get("MessageSid");
  if(!smsSid.test(sid||"") || (params.has("MessagingServiceSid") && params.get("MessagingServiceSid")!==route.service))return smsError(400,"Invalid message.");
  return db.transaction(async c=>{
    await smsTables(c);
    if(path.startsWith("/api/dealer-sms/status?")){
      const id=new URL(path,origin).searchParams.get("id");
      if(!smsUuid.test(id||""))return smsError(400,"Invalid status reference.");
      const row=(await c.query("SELECT sender,phone FROM inquiry_sms_messages WHERE id=$1",[id])).rows[0];
      if(!row || row.sender!==route.from || (params.has("To") && params.get("To")!==row.phone) || (params.has("From") && params.get("From")!==row.sender))return smsError(404,"Message unavailable.");
      const state=params.get("MessageStatus");
      if(!smsStatuses.slice(2).includes(state))return smsResult(200,{});
      await smsLock(c,row.phone);
      const updated=await smsUpdateDelivery(c,id,sid,state);
      if(updated && params.get("ErrorCode")==="21610" && ["failed","undelivered"].includes(state)){
        await c.query("INSERT INTO inquiry_sms_contacts VALUES($1,true,now()) ON CONFLICT(phone) DO UPDATE SET blocked=true,changed_at=now() WHERE NOT inquiry_sms_contacts.blocked",[row.phone]);
      }
      return updated?smsResult(200,{}):smsError(409,"Message reference mismatch.");
    }
    if(path!=="/api/dealer-sms/incoming" || params.get("To")!==route.from || !smsPhone.test(params.get("From")||""))return smsError(403,"Incorrect destination.");
    const phone=params.get("From"),body=params.get("Body")||"";
    await smsLock(c,phone);
    const inserted=await c.query(`INSERT INTO inquiry_sms_messages(id,sid,phone,sender,direction,body,state)
      VALUES($1,$2,$3,$4,'in',$5,'received') ON CONFLICT(sid) DO NOTHING RETURNING id`,[crypto.randomUUID(),sid,phone,route.from,body.slice(0,4000)]);
    if(inserted.rowCount){
      const command=(params.get("OptOutType")||body.trim()).toUpperCase();
      const stop=["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT","REVOKE","OPTOUT"].includes(command);
      await opportunityFromSms(c,phone,body,stop || ["START","UNSTOP","HELP","INFO"].includes(command));
      if(stop || ["START","UNSTOP"].includes(command)){
        if(stop)await c.query("INSERT INTO inquiry_sms_contacts VALUES($1,true,now()) ON CONFLICT(phone) DO UPDATE SET blocked=true,changed_at=now()",[phone]);
        else await c.query("UPDATE inquiry_sms_contacts SET blocked=false,changed_at=now() WHERE phone=$1 AND blocked",[phone]);
      }
    }
    return smsResult(200,{});
  });
}
