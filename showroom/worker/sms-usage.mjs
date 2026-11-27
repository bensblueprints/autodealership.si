const smsMeterMonth = /^\d{4}-(0[1-9]|1[0-2])$/;
async function prepareSmsUsage(c) {
  await smsTables(c);
  await c.query(`CREATE TABLE IF NOT EXISTS sms_usage_evidence (
    message uuid PRIMARY KEY, sid text UNIQUE NOT NULL, segments int, cost numeric(18,7), currency text,
    status text NOT NULL, checked_at timestamptz NOT NULL DEFAULT now())`);
}
export async function reconcileSmsUsage(db, account, transport=fetch) {
  if (!account) return {status:409,data:{error:"Connect the dealership’s Twilio subaccount first."}};
  const items = await db.transaction(async c=>{
    await prepareSmsUsage(c);
    const {rows}=await c.query(`SELECT m.id,m.sid,m.sender,m.phone,m.direction FROM inquiry_sms_messages m
      LEFT JOIN sms_usage_evidence u ON u.message=m.id
      WHERE m.sid IS NOT NULL AND (u.message IS NULL OR (u.checked_at<now()-interval '10 minutes'
      AND (u.cost IS NULL OR u.segments IS NULL OR u.status NOT IN ('delivered','received','failed','undelivered','canceled'))))
      ORDER BY u.checked_at NULLS FIRST,m.created_at LIMIT 25`);
    return {status:200,data:rows};
  });
  let updated=0, errors=0;
  for(const item of items.data) {
    if (!smsSid.test(item.sid)) continue;
    try{
      const resource = await transport("https://api.twilio.com/2010-04-01/Accounts/"+account.account+"/Messages/"+item.sid+".json",
        {headers:{Authorization:"Basic "+btoa(account.account+":"+account.authToken)},redirect:"error",signal:AbortSignal.timeout(4500)});
      if(!resource.ok){
        errors++;
        if([401,403,429].includes(resource.status))break;
        if(resource.status===404)await db.query("INSERT INTO sms_usage_evidence(message,sid,status) VALUES($1,$2,'unavailable') ON CONFLICT(message) DO UPDATE SET checked_at=now()",[item.id,item.sid]);
        continue;
      }
      const m=await resource.json();
      const incoming=item.direction==="in";
      if(m.sid!==item.sid||m.account_sid!==account.account||m.from!==(incoming?item.phone:item.sender)||m.to!==(incoming?item.sender:item.phone)||
        (m.messaging_service_sid && m.messaging_service_sid!==account.service)) {errors++;continue;}
      const seg=Number(m.num_segments),segments=Number(m.num_media||0)>0?0:Number.isSafeInteger(seg)&&seg>0&&seg<=10000?seg:null;
      const currency=typeof m.price_unit==="string"&&/^[A-Z]{3}$/.test(m.price_unit.toUpperCase())?m.price_unit.toUpperCase():null;
      const cost=currency && /^-?\d{1,10}(?:\.\d{1,7})?$/.test(String(m.price))?String(m.price).replace(/^-/,""):null;
      if(typeof m.status!=="string"||m.status.length>32){errors++;continue;}
      await db.query(`INSERT INTO sms_usage_evidence(message,sid,segments,cost,currency,status) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(message) DO UPDATE SET segments=coalesce(excluded.segments,sms_usage_evidence.segments),
        cost=coalesce(excluded.cost,sms_usage_evidence.cost),currency=coalesce(excluded.currency,sms_usage_evidence.currency),
        status=excluded.status,checked_at=now() WHERE sms_usage_evidence.sid=excluded.sid`,
        [item.id,item.sid,segments,cost,currency,m.status]); updated++;
    }catch{errors++;}
  }
  return {status:200,data:{updated,errors}};
}
export async function dealerSmsUsage(db,month,allLines=false) {
  if(!smsMeterMonth.test(month||"") || month<"2000-01" || month>"2199-12")return {status:400,data:{error:"Choose a valid month."}};
  return db.transaction(async c=>{
    await prepareSmsUsage(c);
    const range=" FROM inquiry_sms_messages m LEFT JOIN sms_usage_evidence u ON u.message=m.id WHERE m.created_at >= $1::date AT TIME ZONE 'UTC' AND m.created_at < ($1::date+interval '1 month') AT TIME ZONE 'UTC'";
    const billable="coalesce(u.status,'') IN ('delivered','sent','received') AND NOT (m.direction='in' AND upper(trim(m.body)) IN ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT','START','UNSTOP','HELP','INFO'))";
    const totals=(await c.query(`SELECT count(*)::int AS messages, count(*) FILTER(WHERE u.segments IS NULL AND m.state NOT IN ('canceled','failed','undelivered'))::int AS pending,
      coalesce(sum(u.segments) FILTER(WHERE ${billable}),0)::int AS eligible,
      coalesce(sum(u.cost) FILTER(WHERE u.currency='USD'),0)::text AS usd_cost,
      count(*) FILTER(WHERE m.sid IS NOT NULL AND (u.cost IS NULL OR u.currency<>'USD'))::int AS pending_cost`+range,[month+"-01"])).rows[0];
    const lines=(await c.query("SELECT m.sid,m.direction,m.created_at,m.stock,CASE WHEN u.status='unavailable' THEN m.state ELSE coalesce(u.status,m.state) END AS status,u.segments,u.cost,u.currency"+range+" ORDER BY m.created_at DESC,m.id DESC"+(allLines?"":" LIMIT 100"),[month+"-01"])).rows;
    return {status:200,data:{month,...totals,lines}};
  });
}
