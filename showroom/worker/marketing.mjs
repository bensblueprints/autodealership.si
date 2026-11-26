// All queries use the request's rooftop-routed PostgreSQL connection.
const campaignTable = `CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id uuid PRIMARY KEY, revision integer NOT NULL, state text NOT NULL,
  brief jsonb NOT NULL, history jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
)`;

const campaignPrograms = ["New vehicles","Used vehicles","Service","Trade-in","Dealer brand","In-house financing"];
const campaignChannels = ["Google Search","Microsoft Search","Meta paid social","Display remarketing","YouTube","Vehicle ads"];
const campaignId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const campaignReply = (status, data) => ({status, data});
const campaignError = (status, error) => campaignReply(status, {error});

// Use the successful operational writes as the event ledger, including legacy bookings.
// Both source identifiers have UNIQUE constraints in each dealership database.
const conversionRows = `SELECT 'test_drive_booked:'||confirmation AS event_id,'test_drive_booked' AS event,
    body->>'createdAt' AS occurred_at,body->>'vin' AS vin,
    COALESCE(body->'conversion'->>'channel','unrecorded') AS channel
  FROM appointments WHERE body->>'createdAt' BETWEEN $1 AND $2
  UNION ALL SELECT 'shopper_inquiry:'||id,'shopper_inquiry',body->>'createdAt',body->'car'->>'vin',
    CASE WHEN body->>'source'='Voice concierge' THEN 'concierge' ELSE 'showroom' END
  FROM shopper_leads WHERE body->>'createdAt' BETWEEN $1 AND $2`;
function conversionPeriod(){
  const end=new Date();
  return [new Date(end.getTime()-30*86400000).toISOString(),end.toISOString()];
}
export async function dealerConversionExport(db){
  const rows=(await db.query("SELECT * FROM ("+conversionRows+") e ORDER BY occurred_at DESC,event_id",conversionPeriod())).rows;
  const fields=["event_id","event","occurred_at","vin","channel"];
  const quote=value=>'"'+String(value??"").replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return [fields.join(","),...rows.map(row=>fields.map(k=>quote(row[k])).join(","))].join("\r\n")+"\r\n";
}

function validCampaignBrief(value) {
  if (!value || !campaignPrograms.includes(value.program) || !campaignChannels.includes(value.channel)) return false;
  if (!Number.isSafeInteger(value.monthlyCents) || value.monthlyCents < 0 || value.monthlyCents > 10000000000) return false;
  if (!["Dealer-written","AI-assisted"].includes(value.origin)) return false;
  const fields = {name:120, market:240, landingPath:500, copy:3000, evidence:2000};
  if (!Object.entries(fields).every(([key, max]) => typeof value[key] === "string" && value[key].length <= max)) return false;
  if (!value.name.trim() || !value.copy.trim() || !value.market.trim()) return false;
  return /^\/(?!\/)/.test(value.landingPath) && !/[\\\s\x00-\x1f]/.test(value.landingPath);
}

export async function dealershipMarketing({db, method, input, canReview, actor, historyId}) {
  if (!["GET","POST"].includes(method)) return campaignError(405, "Unsupported method.");
  if (method === "POST" && (!input || !campaignId.test(input.id) || !Number.isSafeInteger(input.revision) || input.revision < 0)) {
    return campaignError(400, "Invalid campaign or revision.");
  }
  // Existing dealerships predate the table. Concurrent first visits may both try to create it.
  if (!(await db.query("SELECT to_regclass('marketing_campaigns') AS relation")).rows[0].relation) {
    try { await db.query(campaignTable); }
    catch (error) { if (!["23505","42P07"].includes(error.code)) throw error; }
  }
  if (method === "GET") {
    if (historyId !== null && historyId !== undefined) {
      if (!campaignId.test(historyId)) return campaignError(400,"Invalid campaign.");
      const record = (await db.query("SELECT history FROM marketing_campaigns WHERE id=$1",[historyId])).rows[0];
      return record ? campaignReply(200,record.history) : campaignError(404,"Campaign unavailable.");
    }
    const times = conversionPeriod();
    const counts = await db.query(`SELECT count(*) FILTER(WHERE event='shopper_inquiry')::int AS inquiries,
      count(*) FILTER(WHERE event='test_drive_booked')::int AS bookings,
      count(*) FILTER(WHERE event='test_drive_booked' AND channel='concierge')::int AS concierge_bookings
      FROM (`+conversionRows+") e", times);
    const visits=await db.query(`SELECT count(*) FILTER(WHERE body->'visit'->>'state'='attended')::int AS attended,
      count(*) FILTER(WHERE body->'visit'->>'state'='missed')::int AS missed,
      count(*) FILTER(WHERE body->'visit'->>'state'='canceled')::int AS canceled,
      count(*) FILTER(WHERE COALESCE(body->'visit'->>'state','scheduled')='scheduled')::int AS unrecorded
      FROM appointments WHERE body->>'slot' BETWEEN $1 AND $2`,times);
    const list = await db.query(`SELECT id, revision, state, brief, updated_at, history->-1 AS latest
      FROM marketing_campaigns ORDER BY updated_at DESC, id`);
    return campaignReply(200, {campaigns:list.rows, canReview, programs:campaignPrograms, channels:campaignChannels,
      report:{...counts.rows[0],visits:visits.rows[0], from:times[0], through:times[1]}});
  }
  const {action,id,revision} = input;
  const now = new Date().toISOString();
  if (action === "save") {
    if (!validCampaignBrief(input.brief)) return campaignError(400, "Check the campaign fields, monthly budget and dealership landing path.");
    const brief = Object.fromEntries(["name","market","program","channel","monthlyCents","landingPath","copy","origin","evidence"].map(k => [k,input.brief[k]]));
    const event = {action,actor,at:now,revision:revision+1};
    const result = revision === 0
      ? await db.query(`INSERT INTO marketing_campaigns(id,revision,state,brief,history) VALUES($1,1,'draft',$2,$3)
          ON CONFLICT(id) DO NOTHING RETURNING revision`, [id,brief,JSON.stringify([event])])
      : await db.query(`UPDATE marketing_campaigns SET brief=$3, revision=revision+1, state='draft', updated_at=now(),
          history=history || $4::jsonb WHERE id=$1 AND revision=$2 AND state <> 'review' RETURNING revision`,
        [id,revision,brief,JSON.stringify([event])]);
    return result.rowCount ? campaignReply(revision===0?201:200,{revision:result.rows[0].revision}) : campaignError(409,"The campaign changed. Reload before editing.");
  }
  if (!["submit","approve","return"].includes(action)) return campaignError(400,"Unknown campaign action.");
  if (action !== "submit" && !canReview) return campaignError(403,"A dealership administrator must review this campaign.");
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 1000 || (action === "return" && !note)) return campaignError(400,"Enter a review note of up to 1,000 characters.");
  const row = (await db.query("SELECT revision,state,brief FROM marketing_campaigns WHERE id=$1",[id])).rows[0];
  if (!row || row.revision !== revision) return campaignError(409,"The campaign changed. Reload before continuing.");
  const next = {submit:"review",approve:"approved",return:"changes"}[action];
  if (action === "submit" ? !["changes","draft"].includes(row.state) : row.state !== "review") return campaignError(409,"This action is unavailable at the current review stage.");
  if (!row.brief.evidence.trim()) return campaignError(422,"Add the supporting source or offer reference before review.");
  if (action === "approve" && input.verified !== true) return campaignError(422,"Confirm that you checked the copy against its sources.");
  const event = {action,actor,at:now,note,revision:revision+1,brief:row.brief};
  const result = await db.query(`UPDATE marketing_campaigns SET state=$3, revision=revision+1, updated_at=now(),
    history=history || $4::jsonb WHERE id=$1 AND revision=$2 RETURNING revision`,[id,revision,next,JSON.stringify([event])]);
  return result.rowCount ? campaignReply(200,{revision:result.rows[0].revision}) : campaignError(409,"Another user updated the campaign. Reload before continuing.");
}
