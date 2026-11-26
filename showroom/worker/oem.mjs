const oemProgramSchema="program_id uuid NOT NULL, revision integer NOT NULL, state text NOT NULL, details jsonb NOT NULL, actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(program_id,revision)";
const oemReviewSchema="digest text PRIMARY KEY, program_id uuid NOT NULL, program_revision integer NOT NULL, creative jsonb NOT NULL, actor text NOT NULL, approved_at timestamptz NOT NULL DEFAULT now()";
const oemUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const oemResult=(status,data)=>({status,data});
const oemFailure=(status,error)=>oemResult(status,{error});

async function ensureOemTables(db){
  // Older dealer databases acquire the same tables as newly provisioned rooftops.
  for(const [table,columns] of [["oem_program_revisions",oemProgramSchema],["oem_banner_reviews",oemReviewSchema]]){
    if((await db.query("SELECT to_regclass($1) AS relation",[table])).rows[0].relation)continue;
    try{await db.query("CREATE TABLE IF NOT EXISTS "+table+" ("+columns+")");}
    catch(error){if(!["23505","42P07"].includes(error.code))throw error;}
  }
}
function oemDay(value){
  return typeof value==="string" && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
function oemDetails(value){
  if(!value || typeof value!=="object")return;
  const limits={brand:100,market:120,title:160,version:100,source:1000,acceptance:1000,disclosure:3000,startsOn:10,endsOn:10};
  const result={};
  for(const [key,max] of Object.entries(limits)){
    if(typeof value[key]!=="string" || value[key].length>max)return;
    result[key]=value[key].trim();
    if(!result[key] && key!=="acceptance")return;
  }
  if(!oemDay(result.startsOn)||!oemDay(result.endsOn)||result.startsOn>result.endsOn)return;
  return result;
}
const latestPrograms="SELECT DISTINCT ON(program_id) program_id,revision,state,details,actor,recorded_at FROM oem_program_revisions ORDER BY program_id,revision DESC";
async function listPrograms(db){
  return (await db.query("SELECT * FROM ("+latestPrograms+") p ORDER BY recorded_at DESC, program_id")).rows;
}
export function oemBinding(slide){
  if(!slide?.program)return null;
  return typeof slide.program.id==="string" && oemUUID.test(slide.program.id) && Number.isSafeInteger(slide.program.revision) && slide.program.revision>0
    ? {id:slide.program.id.toLowerCase(),revision:slide.program.revision} : null;
}
async function oemDigest(slide){
  const bytes=new TextEncoder().encode(JSON.stringify([slide.program.id,slide.program.revision,slide.image,slide.alt,slide.link]));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
}
export async function governedSlides(db,slides,franchise,timezone){
  const results=slides.map(slide=>({slide,status:slide.program?"Program needs approval":"Standard banner"}));
  const linked=results.filter(row=>oemBinding(row.slide));
  if(linked.length){
    await ensureOemTables(db);
    const hashes=await Promise.all(linked.map(row=>oemDigest(row.slide)));
    const ids=[...new Set(linked.map(row=>row.slide.program.id))];
    const programs=(await db.query(`SELECT p.*,
      ((details->>'startsOn')::date::timestamp AT TIME ZONE $2) AS starts,
      (((details->>'endsOn')::date+1)::timestamp AT TIME ZONE $2) AS ends
      FROM (SELECT DISTINCT ON(program_id) program_id,revision,state,details FROM oem_program_revisions
      WHERE program_id=ANY($1::uuid[]) ORDER BY program_id,revision DESC) p`,[ids,timezone])).rows;
    const approved=new Set((await db.query("SELECT digest FROM oem_banner_reviews WHERE digest=ANY($1::text[])",[hashes])).rows.map(row=>row.digest));
    const byId=new Map(programs.map(row=>[row.program_id,row])),now=Date.now();
    linked.forEach((row,i)=>{
      const p=byId.get(row.slide.program.id);
      if(!p || row.slide.program.revision!==p.revision || p.state!=="approved"){row.status="Program needs approval";return;}
      if(now>=+new Date(p.ends)){row.status="Expired";return;}
      if(!approved.has(hashes[i])){row.status="Artwork needs review";return;}
      if(now<+new Date(p.starts)){row.status="Scheduled";return;}
      row.status="Approved";row.disclosure=p.details.disclosure;row.expiresAt=new Date(p.ends).toISOString();
    });
  }
  for(const row of results)if(!row.slide.program && franchise)row.status="Program required";
  return results;
}
export async function oemProgramsApi({db,method,input,actor,canReview,exportId}){
  await ensureOemTables(db);
  if(method==="GET"){
    if(exportId!==null && exportId!==undefined){
      if(!oemUUID.test(exportId))return oemFailure(400,"Invalid program.");
      const revisions=(await db.query("SELECT * FROM oem_program_revisions WHERE program_id=$1 ORDER BY revision",[exportId])).rows;
      if(!revisions.length)return oemFailure(404,"Program unavailable.");
      const approvals=(await db.query("SELECT * FROM oem_banner_reviews WHERE program_id=$1 ORDER BY approved_at,digest",[exportId])).rows;
      return oemResult(200,{exportedAt:new Date().toISOString(),revisions,approvals});
    }
    return oemResult(200,{programs:await listPrograms(db),canReview});
  }
  if(method!=="POST")return oemFailure(405,"Unsupported method.");
  if(!input || typeof input.id!=="string" || !oemUUID.test(input.id) || !Number.isSafeInteger(input.revision) || input.revision<0)return oemFailure(400,"Invalid program or revision.");
  const {action,id,revision}=input;
  if(!["save","approve","withdraw","approve-artwork"].includes(action))return oemFailure(400,"Unknown action.");
  if(action!=="save" && !canReview)return oemFailure(403,"Administrator review required.");
  const current=(await db.query("SELECT state,revision,details FROM oem_program_revisions WHERE program_id=$1 ORDER BY revision DESC LIMIT 1",[id])).rows[0];
  if((current?.revision||0)!==revision)return oemFailure(409,"This program changed. Refresh before continuing.");
  if(action==="approve-artwork"){
    if(current?.state!=="approved" || input.checked!==true || !Number.isInteger(input.index) || input.index<0 || input.index>=6)return oemFailure(422,"Review the saved artwork and its approved program first.");
    const row=(await db.query("SELECT revision,config FROM homepage_banners WHERE id=1")).rows[0];
    const slide=row?.config.slides?.[input.index];
    if(!slide || row.revision!==input.bannerRevision || slide.program?.id!==id || slide.program?.revision!==revision)return oemFailure(409,"The slideshow changed. Reopen the saved artwork.");
    const digest=await oemDigest(slide);
    const insert=await db.query(`INSERT INTO oem_banner_reviews(digest,program_id,program_revision,creative,actor)
      SELECT $1,$2,$3,$4,$5 WHERE (SELECT max(revision) FROM oem_program_revisions WHERE program_id=$2)=$3
      AND (SELECT revision FROM homepage_banners WHERE id=1)=$6 ON CONFLICT(digest) DO NOTHING RETURNING digest`,
      [digest,id,revision,slide,actor,input.bannerRevision]);
    if(!insert.rowCount && !(await db.query("SELECT digest FROM oem_banner_reviews WHERE digest=$1",[digest])).rowCount)return oemFailure(409,"Approval changed. Refresh the workspace.");
    return oemResult(200,{digest});
  }
  const details=action==="save"?oemDetails(input.details):current?.details;
  if(!details)return oemFailure(422,"Complete the brand, market, source, version, dates and public disclosure.");
  if(action==="approve" && (current?.state!=="draft" || input.checked!==true))return oemFailure(422,"Review the saved draft and confirm the source before approving.");
  if(action==="withdraw" && (!current || current.state==="withdrawn"))return oemFailure(409,"This program cannot be withdrawn.");
  const state={save:"draft",approve:"approved",withdraw:"withdrawn"}[action];
  const saved=await db.query(`INSERT INTO oem_program_revisions(program_id,revision,state,details,actor) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(program_id,revision) DO NOTHING RETURNING revision,state`,[id,revision+1,state,details,actor]);
  return saved.rowCount?oemResult(200,saved.rows[0]):oemFailure(409,"Another editor saved this program. Refresh to review their changes.");
}
