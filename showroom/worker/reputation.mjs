function googleReviewDestination(value){
  if(value==="")return "";
  if(typeof value!=="string" || value.length>650)return null;
  try{
    const u=new URL(value.trim());
    if(u.protocol!=="https:" || u.port || u.username || u.password || u.hash)return null;
    if(u.hostname==="g.page" && /^\/r\/[\w-]+\/review\/?$/.test(u.pathname))return u.origin+u.pathname;
    if(u.hostname==="search.google.com" && u.pathname==="/local/writereview" && /^[\w-]+$/.test(u.searchParams.get("placeid")||""))return u.origin+u.pathname+"?placeid="+u.searchParams.get("placeid");
    if(u.hostname==="maps.app.goo.gl" && /^\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname))return u.origin+u.pathname;
    return null;
  }catch{return null;}
}
export async function reputationDesk(db,method,input,team){
  return db.transaction(async c=>{
    await clientBackfill(c);
    if(!(await c.query("SELECT to_regclass('dealer_review_settings') AS t")).rows[0].t){
      await c.query("SELECT pg_advisory_xact_lock(81454,10)");
      await c.query("CREATE TABLE IF NOT EXISTS dealer_review_settings(id int PRIMARY KEY CHECK(id=1),link text NOT NULL,revision int NOT NULL)");
    }
    const cfg=(await c.query("SELECT link,revision FROM dealer_review_settings WHERE id=1")).rows[0]||{link:"",revision:0};
    if(method==="PUT"){
      if(!team.manager)return smsError(403,"A dealership manager can change the Google review link.");
      const link=googleReviewDestination(input?.link);
      if(link===null)return smsError(422,"Paste the HTTPS review link from your Google Business Profile.");
      if(!Number.isSafeInteger(input.revision)||input.revision!==cfg.revision)return smsError(409,"The saved link changed. Refresh before saving.");
      const saved=cfg.revision?await c.query("UPDATE dealer_review_settings SET link=$1,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING revision",[link,cfg.revision]):
        await c.query("INSERT INTO dealer_review_settings VALUES(1,$1,1) ON CONFLICT DO NOTHING RETURNING revision",[link]);
      return saved.rowCount?smsResult(200,{link,revision:saved.rows[0].revision}):smsError(409,"The link changed. Refresh before saving.");
    }
    if(method!=="GET")return smsError(405,"Use GET or PUT.");
    const offset=Number(input?.offset||0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return smsError(400,"Invalid page.");
    const rows=(await c.query(`WITH experiences AS (
      SELECT body->>'opportunityId' AS person,body->>'vin' AS vin,'Test drive taken' AS experience,
      coalesce(body#>>'{visit,history,-1,at}',body->>'slot')::timestamptz AS at FROM appointments WHERE body#>>'{visit,state}'='attended'
      UNION ALL SELECT client_id::text,vin,'Purchased',
      (SELECT min((e->>'at')::timestamptz) FROM jsonb_array_elements(history) e WHERE e->>'stage'='signed') FROM sales_client_contracts WHERE stage='signed'
    ), latest AS (SELECT DISTINCT ON(person) * FROM experiences ORDER BY person,at DESC,experience,vin)
    SELECT o.id,o.name,l.experience,l.at,l.vin FROM latest l JOIN sales_opportunities o ON o.id::text=l.person ORDER BY l.at DESC,o.id LIMIT 51 OFFSET $1`,[offset])).rows;
    return smsResult(200,{...cfg,manager:team.manager,items:rows.slice(0,50),more:rows.length>50});
  });
}
