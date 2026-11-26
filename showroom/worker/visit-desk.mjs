const visitId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function visitDesk(db,method,input,actor){
  const reply=(status,data)=>({status,data});
  const fail=(status,error)=>reply(status,{error});
  const profile=(await db.query("SELECT settings->'profile' AS profile FROM client_profile WHERE id=1")).rows[0]?.profile||{};
  const timezone=profile.driveTimezone||"America/Chicago";
  if(method==="GET"){
    const result=await db.query(`SELECT (a.body-'noteToken'-'requestFingerprint') AS booking,a.notes,
      jsonb_strip_nulls(jsonb_build_object('year',c.body->'year','make',c.body->'make','model',c.body->'model','stock',c.body->'stock','image',c.body->'image','photos',c.body->'photos')) AS car
      FROM appointments a LEFT JOIN client_cars c ON c.vin=a.body->>'vin' ORDER BY a.body->>'slot', a.confirmation`);
    return reply(200,{timezone,appointments:result.rows.map(r=>({...r.booking,car:{...r.booking.car,...r.car},notes:r.notes||{}}))});
  }
  if(method!=="PUT")return fail(405,"Use GET or PUT.");
  if(!input || !visitId.test(input.confirmation||"") || !Number.isSafeInteger(input.revision) || input.revision<0 ||
      !["attended","missed","canceled","reschedule"].includes(input.action) || typeof input.note!=="string" || input.note.length>500)
    return fail(400,"Choose a visit update and keep the note under 500 characters.");
  const {confirmation,revision,action}=input,note=input.note.trim();
  const found=(await db.query("SELECT key,body FROM appointments WHERE confirmation=$1",[confirmation])).rows[0];
  if(!found)return fail(404,"Appointment not found at this dealership.");
  const {body}=found,previous=body.visit||{state:"scheduled",revision:0,history:[]};
  const stale=()=>fail(409,"This appointment changed. Reopen it to see the latest details.");
  if(revision!==previous.revision)return stale();
  const moving=action==="reschedule",state=moving?"scheduled":action;
  if(previous.state!=="scheduled" && (!["attended","missed"].includes(previous.state) || !["attended","missed"].includes(action) || !note))
    return fail(422,"A recorded attendance correction needs a note. Start a new booking for another visit.");
  if(!moving && previous.state===state)return fail(422,"That outcome is already recorded.");
  if(["attended","missed"].includes(state) && Date.parse(body.slot)>Date.now())return fail(422,"Record attendance when the appointment starts.");
  const slot=moving?input.slot:body.slot;
  if(moving && (slot===body.slot || !driveSlots(profile.driveHours,timezone).includes(slot)))return fail(422,"Choose a different available time within dealership hours.");
  const key=moving?"appointments/"+body.vin+"/"+slot:state==="canceled"?"visit-history/"+confirmation:found.key;
  const event={state,action,actor,at:new Date().toISOString(),slot,previousSlot:body.slot,note};
  const visit={state,revision:revision+1,history:[...previous.history,event]};
  try{
    const update=await db.query(`UPDATE appointments SET key=$1,body=body||$2::jsonb
      WHERE confirmation=$3 AND COALESCE((body->'visit'->>'revision')::integer,0)=$4
      AND (NOT $5::boolean OR (EXISTS(SELECT 1 FROM client_cars WHERE vin=$6) AND NOT EXISTS(SELECT 1 FROM inventory_status WHERE vin=$6)))
      RETURNING confirmation`,[key,{slot,originalSlot:body.originalSlot||body.slot,visit},confirmation,revision,moving,body.vin]);
    if(!update.rowCount)return moving?fail(409,"The vehicle or appointment changed. Refresh before rescheduling."):stale();
  }catch(error){
    if(error.code==="23505" && moving)return fail(409,"Another shopper reserved that time. Choose another slot.");
    throw error;
  }
  return reply(200,{confirmation,slot,state,revision:visit.revision});
}
export {visitDesk};
