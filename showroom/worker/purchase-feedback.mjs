async function feedbackTables(c){
  if((await c.query("SELECT to_regclass('purchase_review_emails') AS t")).rows[0].t)return;
  await c.query("SELECT pg_advisory_xact_lock(81454,10)");
  await c.query(`CREATE TABLE IF NOT EXISTS dealer_review_settings(id int PRIMARY KEY CHECK(id=1),link text NOT NULL,revision int NOT NULL);
    ALTER TABLE dealer_review_settings ADD COLUMN IF NOT EXISTS automatic boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS purchase_review_optouts(address text PRIMARY KEY,at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS purchase_review_emails(id uuid PRIMARY KEY,token uuid UNIQUE NOT NULL,client_id uuid NOT NULL,vin text NOT NULL,
      address text NOT NULL,dealer text NOT NULL,domain_id text NOT NULL,domain text NOT NULL,origin text NOT NULL,google_link text NOT NULL,permission_actor text NOT NULL,
      purchased_at timestamptz NOT NULL,due_at timestamptz NOT NULL,state text NOT NULL DEFAULT 'scheduled',provider_id text,
      stars int CHECK(stars BETWEEN 1 AND 5),comment text,responded_at timestamptz,resolved_at timestamptz,resolved_by text,UNIQUE(client_id,vin));
    CREATE INDEX IF NOT EXISTS review_due ON purchase_review_emails(state,due_at)`);
}
async function queuePurchaseFeedback(c,op,vin,at,team,sender){
  if(!op.email)return "No email address on file.";
  if(!sender)return "No verified dealership sender is connected.";
  await feedbackTables(c);
  const cfg=(await c.query("SELECT link,automatic FROM dealer_review_settings WHERE id=1 FOR SHARE")).rows[0];
  if(!cfg?.automatic || !cfg.link)return "Purchase emails are turned off in Reputation.";
  const dealer=(await c.query("SELECT settings->>'dealerName' AS name FROM client_profile WHERE id=1")).rows[0]?.name;
  await c.query("SELECT pg_advisory_xact_lock(81456,hashtext($1))",[op.email]);
  const saved=await c.query(`INSERT INTO purchase_review_emails(id,token,client_id,vin,address,dealer,domain_id,domain,origin,google_link,permission_actor,purchased_at,due_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$12::timestamptz+interval '24 hours'
    WHERE NOT EXISTS(SELECT 1 FROM purchase_review_optouts WHERE address=$5) AND NOT EXISTS(
      SELECT 1 FROM purchase_review_emails WHERE address=$5 AND purchased_at>$12::timestamptz-interval '30 days' AND state<>'canceled')
    ON CONFLICT DO NOTHING`,[crypto.randomUUID(),crypto.randomUUID(),op.id,vin,op.email,dealer||"Your dealership",sender.domain_id,sender.domain,sender.origin,cfg.link,team.me.label,at]);
  return saved.rowCount?"Review email scheduled for 24 hours after purchase.":"Review email skipped due to an opt-out or recent invitation.";
}
export async function customerFeedback(db,input){
  if(!smsUuid.test(input?.token||"")||!["view","rate","stop"].includes(input.action))return smsError(400,"Invalid feedback link.");
  return db.transaction(async c=>{
    if(!(await c.query("SELECT to_regclass('purchase_review_emails') AS t")).rows[0].t)return smsError(404,"Feedback link unavailable.");
    const row=(await c.query(`SELECT m.*,s.link AS current_link FROM purchase_review_emails m LEFT JOIN dealer_review_settings s ON s.id=1
      WHERE token=$1 AND state IN ('accepted','uncertain') FOR UPDATE OF m`,[input.token])).rows[0];
    if(!row)return smsError(404,"Feedback link unavailable.");
    if(input.action==="stop"){
      await c.query("INSERT INTO purchase_review_optouts(address) VALUES($1) ON CONFLICT DO NOTHING",[row.address]);
      await c.query("UPDATE purchase_review_emails SET state='canceled' WHERE address=$1 AND state='scheduled'",[row.address]);
      return smsResult(200,{stopped:true});
    }
    if(Date.now()>+new Date(row.due_at)+90*86400000)return smsError(410,"This feedback invitation has expired.");
    const info={dealer:row.dealer,link:row.current_link||"",submitted:!!row.stars};
    if(input.action==="view")return smsResult(200,info);
    if(!Number.isInteger(input.stars)||input.stars<1||input.stars>5||typeof input.comment!=="string"||input.comment.length>2000)return smsError(422,"Choose 1 to 5 stars and keep the comment under 2,000 characters.");
    const comment=input.comment.trim();
    if(row.stars && (row.stars!==input.stars||row.comment!==comment))return smsError(409,"Feedback has already been recorded.");
    if(!row.stars)await c.query("UPDATE purchase_review_emails SET stars=$2,comment=$3,responded_at=now() WHERE id=$1",[row.id,input.stars,comment]);
    return smsResult(200,{...info,submitted:true});
  });
}
