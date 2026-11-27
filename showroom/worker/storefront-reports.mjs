const storefrontReportTable="storefront_review_reports";
const storefrontReportColumns="id uuid PRIMARY KEY, daily_date date UNIQUE, checked_at timestamptz NOT NULL DEFAULT now(), report jsonb NOT NULL";
const reportProjection="id, checked_at AS at, report";

async function hasReportTable(conn){
  return !!(await conn.query("SELECT to_regclass('storefront_review_reports') AS table_name")).rows[0].table_name;
}

async function reportContents(conn,settings,{tenant,store,site,host,actor,daily,at,today}){
  const zone=settings.zone||"America/Chicago",template=DealerSitePages.templateKey(settings.template);
  const overrides=pageOverrides(settings.pages);
  const review=await publicEvidencePages(conn,overrides,zone);
  const pages=DealerSitePages.list({profile:{siteTemplate:template},pages:review.pages,options:settings.options},tenant,settings.finance!=="false" && settings.options?.aprFinancingEnabled!==false);
  const catalog=new Map(pages.map(p=>[p.key,p]));
  const findings=[];
  function add(level,kind,key,title,description,extra={}){
    findings.push({level,kind,key,title,description,...extra});
  }
  const soon=end=>end && Date.parse(end)>+at && Date.parse(end)<=+at+14*86400000;
  for(const key of review.withheld){
    const page=catalog.get(key);
    add("attention","page",key,overrides[key]?.title||page?.title||key,
      review.issues[key]+" "+(page?.enabled?"The standard page is being served.":"The page is hidden."),{edition:overrides[key]?.evidenceEdition});
  }
  for(const [key,end] of Object.entries(review.deadlines)){
    if(soon(end))add("upcoming","page",key,catalog.get(key)?.title||key,"Renew the source for this published copy.",{expiresAt:end,edition:overrides[key]?.evidenceEdition});
  }
  let liveOffers=0,currentOffers=0;
  if((await conn.query("SELECT to_regclass('oem_program_revisions') AS t")).rows[0].t){
    const programs=(await conn.query("SELECT program_id,revision,details FROM ("+latestPrograms+") p WHERE state='approved' AND details ? 'websiteOffer' AND details->>'startsOn'<=$1 AND details->>'endsOn'>=$1 ORDER BY program_id",[today])).rows;
    currentOffers=programs.length;
    const live=new Map((await websiteOffers(conn,tenant)).map(o=>[o.id,o]));
    liveOffers=live.size;
    for(const p of programs){
      const offer=live.get(p.program_id);
      if(!offer)add("attention","offer",p.program_id,p.details.title,"No eligible website placement. Check the specials page, eligible stock and payment settings.",{revision:p.revision});
      else if(soon(offer.expiresAt))add("upcoming","offer",p.program_id,p.details.title,"This live offer reaches the end of its approved period.",{expiresAt:offer.expiresAt,revision:p.revision});
    }
  }
  const hasBanners=(await conn.query("SELECT to_regclass('homepage_banners') AS t")).rows[0].t;
  const config=hasBanners && (await conn.query("SELECT config->'slides' AS slides,config->'enabled' AS enabled FROM homepage_banners WHERE id=1")).rows[0];
  const slides=config?.enabled===true?config.slides||[]:[];
  const banners=await governedSlides(conn,slides,template==="franchise",zone,tenant);
  let visibleBanners=0;
  for(const [index,row] of banners.entries()){
    const title=row.slide.alt||"Homepage banner "+(index+1);
    const binding=oemBinding(row.slide);
    const source=binding?{program:binding.id,revision:binding.revision}:{};
    if(["Approved","Standard banner"].includes(row.status)){
      visibleBanners++;
      if(soon(row.expiresAt))add("upcoming","banner",String(index+1),title,"The banner’s approved display period ends soon.",{...source,expiresAt:row.expiresAt});
    }else if(row.status!=="Scheduled"){
      add("attention","banner",String(index+1),title,row.status+". This slide is withheld from the homepage.",source);
    }
  }
  return {version:1,site,host,store:settings.name||store,template,timezone:zone,source:daily?"Daily check":"Staff check",actor,
    coverage:{publishedPages:pages.filter(p=>p.enabled).length,sourcedPages:Object.values(overrides).filter(p=>p?.enabled!==false && p?.evidenceEdition).length,
      currentOffers,liveOffers,enabledSlides:slides.length,visibleBanners},findings};
}

export async function runStorefrontReport(db,{id,daily=false,tenant,store,site,host,actor}){
  if(!oemUUID.test(id||""))return oemFailure(400,"Use a valid report request.");
  async function record(conn){
    const settings=(await conn.query("SELECT settings->>'dealerName' AS name, settings->'profile'->>'siteTemplate' AS template,settings->'profile'->>'driveTimezone' AS zone,settings->'pages' AS pages,settings->'options' AS options,settings->>'financingEnabled' AS finance FROM client_profile WHERE id=1")).rows[0]||{};
    if(daily && settings.template!=="franchise")return oemResult(204,null);
    if(!await hasReportTable(conn)){
      await conn.query("SELECT pg_advisory_xact_lock(81455,1)");
      await conn.query("CREATE TABLE IF NOT EXISTS "+storefrontReportTable+" ("+storefrontReportColumns+")");
    }
    const {at,today}=(await conn.query("SELECT now() AS at,to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS today",[settings.zone||"America/Chicago"])).rows[0];
    const day=daily?today:null;
    const prior=(await conn.query("SELECT "+reportProjection+" FROM storefront_review_reports WHERE id=$1 OR daily_date=$2",[id,day])).rows[0];
    if(prior)return oemResult(200,prior);
    const report=await reportContents(conn,settings,{tenant,store,site,host,actor,daily,at,today});
    const saved=(await conn.query("INSERT INTO storefront_review_reports(id,daily_date,report) VALUES($1,$2,$3) RETURNING "+reportProjection,[id,day,report])).rows[0];
    return oemResult(201,saved);
  }
  try{return await db.transaction(record,{snapshot:true});}
  catch(error){
    if(!["40001","23505","42P07"].includes(error.code))throw error;
    // A concurrent worker can win the daily row or initialize an older dealer's schema.
    return db.transaction(record,{snapshot:true});
  }
}

export async function readStorefrontReports(db,id){
  if(id!==null && !oemUUID.test(id))return oemFailure(400,"Invalid report.");
  return db.transaction(async conn=>{
    if(!await hasReportTable(conn))return id?oemFailure(404,"Report unavailable."):oemResult(200,{reports:[],latest:null});
    if(id){
      const row=(await conn.query("SELECT "+reportProjection+" FROM storefront_review_reports WHERE id=$1",[id])).rows[0];
      return row?oemResult(200,row):oemFailure(404,"Report unavailable.");
    }
    const rows=(await conn.query("SELECT id,checked_at AS at,report->>'source' AS source FROM storefront_review_reports ORDER BY checked_at DESC,id DESC LIMIT 30")).rows;
    const latest=rows.length?(await conn.query("SELECT "+reportProjection+" FROM storefront_review_reports WHERE id=$1",[rows[0].id])).rows[0]:null;
    return oemResult(200,{reports:rows,latest});
  });
}
