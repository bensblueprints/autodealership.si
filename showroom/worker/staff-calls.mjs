// Browser calls use one short-lived Twilio identity per server-authorized opportunity.
const legSid=/^CA[a-f0-9]{32}$/i;
export function staffVoiceRoute(routes,site){
  const route=routes[site],v=route?.staffVoice;
  if(v?.enabled!==true || !/^AC[a-f0-9]{32}$/i.test(route.account||"") || !/^[a-z0-9]{32}$/i.test(route.authToken||"") ||
    !smsPhone.test(v.from||"") || !/^AP[a-f0-9]{32}$/i.test(v.app||"") || !/^SK[a-f0-9]{32}$/i.test(v.key||"") ||
    typeof v.secret!=="string" || v.secret.length<24)return null;
  if(Object.entries(routes).some(([id,r])=>id!==site && (r.account===route.account || r.from===v.from || r.staffVoice?.from===v.from || r.staffVoice?.app===v.app)))return null;
  return {...v,account:route.account,authToken:route.authToken};
}
async function callTable(c){
  if((await c.query("SELECT to_regclass('staff_calls') AS t")).rows[0].t)return;
  await c.query("SELECT pg_advisory_xact_lock(81454,4)");
  await c.query("CREATE TABLE IF NOT EXISTS staff_calls(id uuid PRIMARY KEY,opportunity uuid NOT NULL,owner_id text NOT NULL,actor text NOT NULL,phone text NOT NULL,sender text NOT NULL,account text NOT NULL,state text NOT NULL,parent_sid text UNIQUE,child_sid text UNIQUE,seconds int,created_at timestamptz NOT NULL DEFAULT now())");
}
export async function reserveStaffCall(db,input,actor,route){
  if(!route)return smsError(409,"Browser calling needs a connected dealership voice number.");
  if(!smsUuid.test(input?.id||"") || !smsUuid.test(input?.request||""))return smsError(400,"Choose a client to call.");
  return db.transaction(async c=>{
    await callTable(c);
    const o=(await c.query("SELECT phone,owner FROM sales_opportunities WHERE id=$1 FOR SHARE",[input.id])).rows[0];
    if(!o)return smsError(404,"Client unavailable.");
    if(o.owner && o.owner.id!==actor.id && !actor.manager)return smsError(403,"The assigned salesperson or manager can call.");
    const phone=InquiryContact.phoneNumber(o.phone||"");
    if(!phone || phone===route.from)return smsError(422,"A valid customer callback number is required.");
    const res=await c.query("INSERT INTO staff_calls(id,opportunity,owner_id,actor,phone,sender,account,state) VALUES($1,$2,$3,$4,$5,$6,$7,'ready') ON CONFLICT DO NOTHING RETURNING id",[input.request,input.id,actor.id,actor.label,phone,route.from,route.account]);
    if(!res.rowCount)return smsError(409,"This call attempt already exists. Refresh the conversation before starting another.");
    return smsResult(200,{id:input.request,from:route.from});
  });
}
export async function staffVoiceWebhook(db,{route,origin,path,params,signature}){
  if(!await validDealerSignature({route,origin,path,params,signature}))return smsError(403,"Invalid call signature.");
  const dial=path==="/api/staff-voice/dial",parent=params.get("CallSid");
  const id=dial?params.get("CallRequest"):new URL(path,origin).searchParams.get("id");
  if(!smsUuid.test(id||"") || !legSid.test(parent||""))return smsError(400,"Invalid call reference.");
  return db.transaction(async c=>{
    await callTable(c);
    const row=(await c.query("SELECT s.*,o.phone AS current_phone,o.owner FROM staff_calls s JOIN sales_opportunities o ON o.id=s.opportunity WHERE s.id=$1 FOR UPDATE OF s",[id])).rows[0];
    if(!row || row.account!==route.account || row.sender!==route.from)return smsError(403,"Call does not match the dealership.");
    if(dial){
      if(params.get("From")!=="client:adsi_"+id.replaceAll("-","") || row.state!=="ready" && !(row.state==="dialing" && row.parent_sid===parent) ||
        Date.now()-new Date(row.created_at).getTime()>120000 || row.phone!==InquiryContact.phoneNumber(row.current_phone||""))return smsError(403,"Call request expired.");
      await c.query("UPDATE staff_calls SET state='dialing',parent_sid=$2 WHERE id=$1",[id,parent]);
      return smsResult(200,{xml:'<Response><Dial answerOnBridge="true" timeout="30" timeLimit="3600" callerId="'+row.sender+'" action="'+origin+'/api/staff-voice/result?id='+id+'" method="POST"><Number>'+row.phone+'</Number></Dial></Response>'});
    }
    const status=params.get("DialCallStatus"),child=params.get("DialCallSid"),duration=params.get("DialCallDuration");
    if(row.parent_sid!==parent || !["completed","busy","no-answer","failed","canceled"].includes(status) || child && !legSid.test(child) ||
       duration && !/^\d{1,6}$/.test(duration))return smsError(403,"Invalid call result.");
    if(row.state==="dialing"){
      await c.query("UPDATE staff_calls SET state=$2,child_sid=$3,seconds=$4 WHERE id=$1",[id,status,child||null,duration?Number(duration):null]);
      await c.query("UPDATE sales_opportunities SET updated_at=now() WHERE id=$1",[row.opportunity]);
    }
    return smsResult(200,{xml:"<Response/>"});
  });
}
