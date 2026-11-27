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
  if(value.websiteOffer!=null){
    const offer=value.websiteOffer;
    if(typeof offer.headline!=="string" || !offer.headline.trim() || offer.headline.length>140 ||
      !DealerSitePages.catalog.some(item=>item.group==="Specials" && item.key===offer.page) ||
      !Array.isArray(offer.vins) || offer.vins.length>50 || !offer.vins.every(v=>typeof v==="string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(v)) ||
      new Set(offer.vins).size!==offer.vins.length)return;
    result.websiteOffer={headline:offer.headline.trim(),page:offer.page,vins:[...offer.vins].sort()};
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
export async function governedSlides(db,slides,franchise,timezone,tenant=true,layout=null){
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
    const scoped=linked.filter(row=>row.status==="Approved" && byId.get(row.slide.program.id)?.details.websiteOffer);
    if(scoped.length){
      const active=new Set((await websiteOffers(db,tenant,layout)).map(offer=>offer.id));
      for(const row of scoped)if(!active.has(row.slide.program.id))row.status="No eligible website placement";
    }
  }
  for(const row of results)if(!row.slide.program && franchise)row.status="Program required";
  return results;
}
export async function oemProgramsApi({db,method,input,actor,canReview,exportId,tenant=true}){
  await ensureOemTables(db);
  if(method==="GET"){
    if(exportId!==null && exportId!==undefined){
      if(!oemUUID.test(exportId))return oemFailure(400,"Invalid program.");
      const revisions=(await db.query("SELECT * FROM oem_program_revisions WHERE program_id=$1 ORDER BY revision",[exportId])).rows;
      if(!revisions.length)return oemFailure(404,"Program unavailable.");
      const approvals=(await db.query("SELECT * FROM oem_banner_reviews WHERE program_id=$1 ORDER BY approved_at,digest",[exportId])).rows;
      return oemResult(200,{exportedAt:new Date().toISOString(),revisions,approvals});
    }
    const programs=await listPrograms(db);
    if(programs.some(row=>row.details.websiteOffer)){
      const live=new Map((await websiteOffers(db,tenant)).map(offer=>[offer.id,offer]));
      const {today}=(await db.query(`SELECT to_char(now() AT TIME ZONE coalesce(
        (SELECT settings->'profile'->>'driveTimezone' FROM client_profile WHERE id=1),'America/Chicago'),'YYYY-MM-DD') AS today`)).rows[0];
      for(const row of programs){
        if(!row.details.websiteOffer)continue;
        const offer=live.get(row.program_id);
        const status=row.state==="draft"?"Awaiting approval":row.state==="withdrawn"?"Withdrawn":
          today<row.details.startsOn?"Scheduled":today>row.details.endsOn?"Expired":offer?"Live":"No eligible placement";
        row.website={status,page:offer?.page||null,vehicles:offer?.cars.length||0};
      }
    }
    return oemResult(200,{programs,canReview});
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
  if((action==="save" || action==="approve") && details.websiteOffer?.vins.length){
    const selected=await offerInventory(db,details.websiteOffer.vins);
    if(selected.length!==details.websiteOffer.vins.length)return oemFailure(422,"One or more selected vehicles are unavailable. Review the stock list.");
  }
  const state={save:"draft",approve:"approved",withdraw:"withdrawn"}[action];
  const saved=await db.query(`INSERT INTO oem_program_revisions(program_id,revision,state,details,actor) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(program_id,revision) DO NOTHING RETURNING revision,state`,[id,revision+1,state,details,actor]);
  return saved.rowCount?oemResult(200,saved.rows[0]):oemFailure(409,"Another editor saved this program. Refresh to review their changes.");
}


async function offerInventory(db,vins){
  if(!vins.length)return [];
  return (await db.query(`SELECT vin,body->>'stock' AS stock,concat_ws(' ',body->>'year',body->>'make',body->>'model') AS label,
    coalesce(body->>'financingEnabled','true')<>'false' AND coalesce(body->>'aprFinancingEnabled','true')<>'false' AS apr,
    coalesce(body->>'financeEstimateEnabled','true')<>'false' AS finance,coalesce(body->>'leaseEstimateEnabled','true')<>'false' AS lease
    FROM client_cars c WHERE vin=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM inventory_status s WHERE s.vin=c.vin)
    AND lower(coalesce(body->>'status','')) NOT IN ('sold','deleted','reserved') ORDER BY vin`,[vins])).rows;
}

export async function websiteOffers(db,tenant,layout=null){
  if(!(await db.query("SELECT to_regclass('oem_program_revisions') AS present")).rows[0].present)return [];
  const settings=(await db.query(`SELECT settings->'profile'->>'siteTemplate' AS template,settings->'profile'->>'driveTimezone' AS zone,
    settings->'pages' AS pages,settings->'options' AS options,settings->>'financingEnabled' AS finance,settings->'options'->>'aprFinancingEnabled' AS apr
    FROM client_profile WHERE id=1`)).rows[0]||{};
  const apr=settings.finance!=="false" && settings.apr!=="false";
  const reviewed=await publicEvidencePages(db,settings.pages,settings.zone);
  const visible=new Set(DealerSitePages.list({pages:reviewed.pages,options:settings.options,profile:{siteTemplate:layout||settings.template}},tenant,apr).filter(p=>p.enabled).map(p=>p.key));
  const programs=(await db.query(`SELECT program_id AS id,details->'websiteOffer' AS offer,details->>'disclosure' AS disclosure,
    details->>'endsOn' AS day,(((details->>'endsOn')::date+1)::timestamp AT TIME ZONE $1) AS expires
    FROM (SELECT DISTINCT ON(program_id) program_id,state,details FROM oem_program_revisions ORDER BY program_id,revision DESC) latest
    WHERE state='approved' AND details ? 'websiteOffer' AND (now() AT TIME ZONE $1)::date BETWEEN
    (details->>'startsOn')::date AND (details->>'endsOn')::date ORDER BY expires,program_id`,[settings.zone||"America/Chicago"])).rows;
  const selected=await offerInventory(db,[...new Set(programs.flatMap(row=>row.offer.vins))]);
  const inventory=new Map(selected.map(car=>[car.vin,car]));
  return programs.flatMap(({id,offer,disclosure,day,expires})=>{
    const financing=DealerSitePages.requiresApr.has(offer.page);
    if(!DealerSitePages.paymentPageAllowed(offer.page,settings.options,apr))return [];
    const cars=offer.vins.map(v=>inventory.get(v)).filter(car=>car && (!financing || DealerSitePages.paymentPageAllowed(offer.page,car,car.apr))).map(({vin,stock,label})=>({vin,stock,label}));
    const page=visible.has(offer.page)?offer.page:null;
    if((offer.vins.length && !cars.length) || (!page && !cars.length))return [];
    return [{id,headline:offer.headline,disclosure,day,expiresAt:expires.toISOString(),page,cars}];
  });
}

const rooftopArtTable="oem_dealer_art";
async function ensureDealerArt(db){
  if((await db.query("SELECT to_regclass($1) AS relation",[rooftopArtTable])).rows[0].relation)return;
  try{await db.query(`CREATE TABLE IF NOT EXISTS oem_dealer_art (
    brand text PRIMARY KEY, revision integer NOT NULL, source_note text NOT NULL,
    rights_note text NOT NULL, image bytea NOT NULL, digest text NOT NULL,
    actor text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now())`);}
  catch(error){if(!["23505","42P07"].includes(error.code))throw error;}
}
export async function oemBrandLibrary({db,platform,method,brand,asset,scope,input,actor,canReview}){
  // Global references are curated; dealer-supplied originals use the current rooftop's database.
  if(!(await platform.query("SELECT to_regclass('public.oem_brand_reference_art') AS ready")).rows[0].ready)
    return oemFailure(503,"The manufacturer reference library has not been installed.");
  if(method!=="GET" && method!=="POST")return oemFailure(405,"Unsupported method.");
  if(method==="POST" && !canReview)return oemFailure(403,"Administrator access required.");
  if((asset!==null || scope==="history" || method==="POST") && (typeof brand!=="string" || !/^[a-z0-9-]{1,65}$/.test(brand)))
    return oemFailure(400,"Choose a manufacturer.");
  await ensureDealerArt(db);
  if(method==="GET" && scope==="history" && asset===null){
    const rows=await hasBrandPlacement(db)?(await db.query(`SELECT sequence,name,revision,digest,published,surface,
      to_char(ends_on,'YYYY-MM-DD') AS ends_on,actor,source_note,rights_note,recorded_at
      FROM oem_brand_placements WHERE brand=$1 ORDER BY sequence DESC`,[brand])).rows:[];
    return oemResult(200,{brand,history:rows});
  }
  if(method==="GET" && asset!==null){
    if(!/^[0-9a-f]{64}$/.test(asset)||!["library","dealer"].includes(scope))return oemFailure(400,"Invalid artwork reference.");
    const result=scope==="dealer"
      ?await db.query("SELECT image FROM oem_dealer_art WHERE brand=$1 AND digest=$2",[brand,asset])
      :await platform.query("SELECT image FROM public.oem_brand_reference_art WHERE brand=$1 AND digest=$2",[brand,asset]);
    return result.rowCount?{status:200,image:result.rows[0].image}:oemFailure(404,"Artwork unavailable.");
  }
  if(method==="POST"){
    const manufacturer=(await platform.query("SELECT name FROM public.oem_brand_references WHERE id=$1",[brand])).rows[0];
    if(!manufacturer)
      return oemFailure(404,"Manufacturer unavailable.");
    if(["publish-footer","withdraw-footer"].includes(input?.action))return changeBrandPlacement(db,{brand,name:manufacturer.name,actor,input});
    const {revision,sourceNote,rightsNote,png}=input||{};
    if(!Number.isSafeInteger(revision)||revision<0||typeof sourceNote!=="string"||!sourceNote.trim()||sourceNote.length>600||
       typeof rightsNote!=="string"||!rightsNote.trim()||rightsNote.length>600||typeof png!=="string"||png.length>699052||
       !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(png))return oemFailure(422,"Supply a PNG under 500 KB, its source and its permitted use.");
    let bytes;try{bytes=Uint8Array.from(atob(png.slice(22)),c=>c.charCodeAt(0));}catch{return oemFailure(422,"Choose a valid PNG file.");}
    const view=new DataView(bytes.buffer);
    if(bytes.length<45||bytes.length>512000||view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a||
       view.getUint32(8)!==13||view.getUint32(12)!==0x49484452||view.getUint32(bytes.length-8)!==0x49454e44||
       ![16,20].every(offset=>view.getUint32(offset)>0&&view.getUint32(offset)<=4096))return oemFailure(422,"Choose a PNG up to 4096 pixels per side.");
    const values=[brand,sourceNote.trim(),rightsNote.trim(),bytes,actor];
    const saved=revision===0
      ?await db.query(`INSERT INTO oem_dealer_art(brand,revision,source_note,rights_note,image,digest,actor)
        VALUES($1,1,$2,$3,$4,encode(sha256($4::bytea),'hex'),$5) ON CONFLICT(brand) DO NOTHING RETURNING revision`,values)
      :await db.query(`UPDATE oem_dealer_art SET revision=revision+1,source_note=$2,rights_note=$3,image=$4,
        digest=encode(sha256($4::bytea),'hex'),actor=$5,recorded_at=now() WHERE brand=$1 AND revision=$6 RETURNING revision`,[...values,revision]);
    return saved.rowCount?oemResult(200,saved.rows[0]):oemFailure(409,"Someone changed this artwork. Reopen the library before saving.");
  }
  const refs=(await platform.query(`SELECT r.id,r.name,r.guidance,to_char(r.reviewed,'YYYY-MM-DD') AS reviewed,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('label',a.label,'digest',a.digest,'source',a.source_url,'sourceDigest',a.source_digest) ORDER BY a.object_id)
    FROM public.oem_brand_reference_art a WHERE a.brand=r.id),'[]'::jsonb) AS artwork
    FROM public.oem_brand_references r ORDER BY lower(r.name)`)).rows;
  const local=new Map((await db.query("SELECT brand,revision,source_note,rights_note,digest,recorded_at FROM oem_dealer_art")).rows.map(row=>[row.brand,row]));
  const placements=new Map((await brandPlacements(db)).map(row=>[row.brand,row]));
  return oemResult(200,{canReview,brands:refs.map(row=>({...row,dealerArtwork:local.get(row.id)||null,placement:placements.get(row.id)||null}))});
}

const placementColumns = `brand text NOT NULL, sequence int NOT NULL, name text NOT NULL, revision int NOT NULL,
  digest text NOT NULL, published boolean NOT NULL, surface text NOT NULL, ends_on date, actor text NOT NULL,
  source_note text NOT NULL, rights_note text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(brand,sequence)`;
const latestBrandPlacement = "SELECT DISTINCT ON (brand) * FROM oem_brand_placements ORDER BY brand,sequence DESC";
async function hasBrandPlacement(db) {
  return Boolean((await db.query("SELECT to_regclass('oem_brand_placements') AS present")).rows[0].present);
}

// This join is shared by the footer, its image endpoint, and the workspace. Matching a digest
// alone would let an old approval survive a rights change that kept the same PNG.
async function brandPlacements(db, {publicOnly=false, brand=null, sequence=null, digest=null, image=false, layout=null}={}) {
  if (!await hasBrandPlacement(db)) return [];
  const {rows} = await db.query(`
    WITH placements AS (${latestBrandPlacement}), checked AS (
      SELECT p.brand,p.sequence,p.name,p.revision,p.digest,p.published,p.surface,to_char(p.ends_on,'YYYY-MM-DD') AS ends_on,
        ((p.ends_on+1)::timestamp AT TIME ZONE coalesce(s.settings->'profile'->>'driveTimezone','America/Chicago')) AS expires_at,
        CASE WHEN NOT p.published THEN 'Withdrawn'
          WHEN a.revision IS DISTINCT FROM p.revision OR a.digest IS DISTINCT FROM p.digest THEN 'Artwork changed'
          WHEN p.ends_on < (now() AT TIME ZONE coalesce(s.settings->'profile'->>'driveTimezone','America/Chicago'))::date THEN 'Expired'
          WHEN coalesce($5::text,s.settings->'profile'->>'siteTemplate') IS DISTINCT FROM 'franchise' THEN 'Franchise template required'
          ELSE 'Published' END AS state ${image?',a.image':''}
      FROM placements p LEFT JOIN oem_dealer_art a USING(brand) LEFT JOIN client_profile s ON s.id=1
      WHERE ($1::text IS NULL OR p.brand=$1) AND ($2::integer IS NULL OR p.sequence=$2) AND ($3::text IS NULL OR p.digest=$3)
    ) SELECT * FROM checked WHERE NOT $4::boolean OR state='Published' ORDER BY name,brand`,
    [brand,sequence,digest,publicOnly,layout]);
  return rows;
}
export function publicBrandPlacements(db, match={}) {
  return brandPlacements(db,{...match,publicOnly:true});
}
export async function changeBrandPlacement(db,{brand,name,actor,input}) {
  const {action,revision,sequence,endsOn,surface,checked} = input;
  const publish = action==="publish-footer";
  if (!Number.isSafeInteger(sequence)||sequence<0||sequence>=2147483647||!Number.isSafeInteger(revision)||revision<1)
    return oemFailure(422,"Reload the current artwork before changing its placement.");
  if (publish && (checked!==true || !["light","dark"].includes(surface))) return oemFailure(422,"Confirm permission for the selected footer background.");
  if (publish && endsOn!==null && (typeof endsOn!=="string" || !/^[1-9]\d{3}-\d\d-\d\d$/.test(endsOn) ||
    Number.isNaN(Date.parse(endsOn)) || new Date(endsOn).toISOString().slice(0,10)!==endsOn)) return oemFailure(422,"Enter a valid last display date.");
  return db.transaction(async conn=>{
    const art=(await conn.query("SELECT revision,digest,source_note,rights_note FROM oem_dealer_art WHERE brand=$1 FOR UPDATE",[brand])).rows[0];
    if (!art || art.revision!==revision) return oemFailure(409,"The artwork changed. Review the current revision.");
    if (!await hasBrandPlacement(conn)) {
      await conn.query("SELECT pg_advisory_xact_lock(81456,1)");
      await conn.query("CREATE TABLE IF NOT EXISTS oem_brand_placements ("+placementColumns+")");
    }
    const last=(await conn.query("SELECT * FROM oem_brand_placements WHERE brand=$1 ORDER BY sequence DESC LIMIT 1",[brand])).rows[0];
    if ((last?.sequence||0)!==sequence) return oemFailure(409,"Another editor changed this placement. Refresh the library.");
    if (!publish && !last?.published) return oemFailure(409,"There is no published permission to withdraw.");
    if (publish) {
      const setting=(await conn.query(`SELECT settings->'profile'->>'siteTemplate' AS template,
        to_char(now() AT TIME ZONE coalesce(settings->'profile'->>'driveTimezone','America/Chicago'),'YYYY-MM-DD') AS today
        FROM client_profile WHERE id=1 FOR SHARE`)).rows[0];
      if (setting?.template!=="franchise") return oemFailure(422,"Select the franchise template before publishing a manufacturer mark.");
      if (endsOn && endsOn<setting.today) return oemFailure(422,"The last display date has already passed at this dealership.");
    }
    const evidence=publish?art:last;
    await conn.query(`INSERT INTO oem_brand_placements(brand,sequence,name,revision,digest,published,surface,ends_on,actor,source_note,rights_note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[brand,sequence+1,name,evidence.revision,evidence.digest,publish,
        publish?surface:last.surface,publish?endsOn:last.ends_on,actor,evidence.source_note,evidence.rights_note]);
    return oemResult(200,{sequence:sequence+1});
  });
}
export function brandFooterMarkup(rows,esc,layout=null) {
  if (!rows.length) return "";
  const items=rows.map(p=>'<li class="mark-'+p.surface+'"><img loading="lazy" src="'+(layout?'/api/storefront-preview':'')+'/manufacturer-marks/'+encodeURIComponent(p.brand)+'/'+p.sequence+'-'+p.digest+'.png'+(layout?'?layout='+encodeURIComponent(layout):'')+'" alt="'+esc(p.name)+'"></li>');
  return '<section class="manufacturer-strip" aria-label="Manufacturer brands"><ul>'+items.join("")+'</ul></section>';
}
