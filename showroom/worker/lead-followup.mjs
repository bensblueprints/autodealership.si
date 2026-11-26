const inquiryId=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const inquiryStates=["New","Contacted","Appointment set","Closed"];
const taskKinds=["Call shopper","Review inquiry","Reply by email","Prepare text reply","Confirm appointment","Other"];

export async function followupTeam(pool,{site,organization,actor,manager}) {
  let members=[],directoryReady=true;
  if (organization) {
    const result=await pool.query("SELECT members FROM public.dealer_sales_rosters WHERE site=$1 AND organization=$2 AND synced_at > now()-interval '15 minutes'",[site,organization]);
    members=result.rows[0]?.members||[];
    directoryReady=!!result.rowCount;
  } else {
    const result=await pool.query("SELECT email FROM public.dealer_users WHERE site=$1 AND active ORDER BY email",[site]);
    members=result.rows.map(({email})=>({id:"account:"+email,label:email}));
  }
  const me=members.find(member=>member.id===actor.id)||actor;
  if (!members.some(member=>member.id===me.id)) members=[...members,me];
  return {me,members,manager,directoryReady};
}

export async function updateInquiry(db,input,team,legacy=false) {
  const error=(status,message)=>({status,data:{error:message}});
  if (!input || !inquiryId.test(input.id) || !inquiryStates.includes(input.status)) return error(400,"Choose an inquiry and a valid lead status.");
  const found=await db.query("SELECT body->>'status' AS status,(body->'followUp') - 'history'::text AS work FROM shopper_leads WHERE id=$1",[input.id]);
  if (!found.rowCount) return error(404,"Inquiry unavailable.");
  const row=found.rows[0],prior=row.work||{},revision=prior.revision||0;
  const conflict=()=>error(409,"Another team member updated this inquiry. Reopen it to see their changes.");
  if ((!legacy || input.revision!==undefined) && input.revision!==revision) return conflict();
  if (prior.owner && prior.owner.id!==team.me.id && !team.manager) return error(403,"The assigned salesperson or a manager can update this inquiry.");
  let owner=prior.owner||null,task=prior.task||null,note="";
  if (!legacy) {
    if (typeof input.note!=="string" || input.note.length>1000) return error(400,"Keep the staff note under 1,000 characters.");
    note=input.note.trim();
    if (input.owner!==null && input.owner!==owner?.id) {
      const selected=team.members.find(member=>member.id===input.owner);
      if (!selected) return error(422,"Choose an active member of this dealership.");
      if (!team.manager && !owner && selected.id!==team.me.id) return error(403,"Claim this inquiry first, or ask a manager to assign it.");
      owner=selected;
    } else if (input.owner===null) owner=null;
    if (!["keep","schedule","complete","clear"].includes(input.taskAction)) return error(400,"Choose a follow-up action.");
    if (input.taskAction==="schedule") {
      const due=input.dueAt;
      if (!taskKinds.includes(input.kind) || typeof due!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(due) || !Number.isFinite(Date.parse(due)) || new Date(due).toISOString()!==due) return error(422,"Choose a follow-up and a valid deadline.");
      if (!owner || input.status==="Closed") return error(422,"Choose a salesperson and open lead status before scheduling a follow-up.");
      task={kind:input.kind,dueAt:due};
    }
    if (input.taskAction==="complete" || input.taskAction==="clear") {
      if (!task) return error(422,"There is no open follow-up on this inquiry.");
      task=null;
    }
  }
  if (input.status==="Closed") task=null;
  if (task && !owner) return error(422,"Reassign or clear the open follow-up before releasing the inquiry.");
  const changedOwner=(prior.owner?.id||null)!==(owner?.id||null);
  const changedTask=(prior.task?.kind||null)!==(task?.kind||null) || (prior.task?.dueAt||null)!==(task?.dueAt||null);
  if (!changedOwner && !changedTask && !note && row.status===input.status) return {status:200,data:{revision}};
  const at=new Date().toISOString();
  const next={owner,task,revision:revision+1,updatedAt:at};
  const event={revision:next.revision,at,actor:team.me,status:input.status,owner,task,note};
  if (changedTask && prior.task) event.previousTask=prior.task;
  if (input.taskAction==="complete") event.completed=true;
  const saved=await db.query(`UPDATE shopper_leads SET body=body || jsonb_build_object('status',$2::text,
    'followUp',$3::jsonb || jsonb_build_object('history',COALESCE(body#>'{followUp,history}','[]'::jsonb) || jsonb_build_array($4::jsonb)))
    WHERE id=$1 AND COALESCE((body#>>'{followUp,revision}')::int,0)=$5 RETURNING id`,[input.id,input.status,next,event,revision]);
  return saved.rowCount?{status:200,data:{revision:next.revision}}:conflict();
}
