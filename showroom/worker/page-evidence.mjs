const pageSpecFields=["year","make","model","trim","body","fuel","engine","transmission","drivetrain","doors"];
const sourceText=value=>String(value??"").trim().replace(/\s+/g," ").toLowerCase();
const sourceVIN=/^[A-HJ-NPR-Z0-9]{17}$/;
function pageEvidence(input){
  if(input==null)return null;
  if(typeof input.ai!=="boolean" || !Array.isArray(input.claims) || input.claims.length>10)throw Error("Use up to ten sources per page.");
  const claims=input.claims.map(value=>{
    if(!value || !["vehicle","manufacturer","financial"].includes(value.type))throw Error("Choose a supported source type.");
    const read=(key,max)=>{
      const v=value[key]??"";
      if(typeof v!=="string" || v.length>max)throw Error("Check the "+key+" in the source record.");
      return v.trim();
    };
    const common={type:value.type,quote:read("quote",600),vin:read("vin",17).toUpperCase()};
    if(value.type==="vehicle"){
      const field=read("field",30);
      if(field && !pageSpecFields.includes(field))throw Error("Choose a supported inventory specification.");
      return {...common,field,expected:read("expected",200)};
    }
    const program=read("program",36).toLowerCase(),revision=value.revision??0;
    if((program && !oemUUID.test(program)) || !Number.isSafeInteger(revision) || revision<0)throw Error("Choose a dealership program revision.");
    return {...common,program,revision};
  });
  return input.ai || claims.length?{ai:input.ai,claims}:null;
}
function pageLines(values){
  return [values.title,values.body,...(values.blocks||[]).flatMap(b=>[b.heading,b.text])].flatMap(v=>String(v||"").split(/\r?\n/)).map(sourceText);
}
function containsFact(line,value){
  if(!value)return false;
  const needle=sourceText(value);
  let pos=line.indexOf(needle);
  while(pos>=0){
    if(!/[\p{L}\p{N}]/u.test(line[pos-1]||" ") && !/[\p{L}\p{N}]/u.test(line[pos+needle.length]||" "))return true;
    pos=line.indexOf(needle,pos+1);
  }
  return false;
}
async function readPageSources(db,claims,zone){
  const vins=[...new Set(claims.map(c=>c.vin).filter(v=>sourceVIN.test(v)))];
  const ids=[...new Set(claims.map(c=>c.program).filter(Boolean))];
  // Query only the columns that a specification can cite, never gallery data.
  const cars=vins.length?(await db.query(`SELECT c.vin,body->>'stock' AS stock,
    coalesce(body->>'financingEnabled','true')<>'false' AND coalesce(body->>'aprFinancingEnabled','true')<>'false' AS apr,
    coalesce(body->>'financeEstimateEnabled','true')<>'false' AS finance,coalesce(body->>'leaseEstimateEnabled','true')<>'false' AS lease,
    ${pageSpecFields.map(f=>"body->>'"+f+"' AS "+f).join(",")}
    FROM client_cars c WHERE c.vin=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM inventory_status s WHERE s.vin=c.vin)
    AND lower(coalesce(body->>'status','')) NOT IN ('sold','deleted','reserved')`,[vins])).rows:[];
  let programs=[];
  if(ids.length && (await db.query("SELECT to_regclass('oem_program_revisions') AS relation")).rows[0].relation){
    programs=(await db.query(`SELECT p.*,((details->>'endsOn')::date+1)::timestamp AT TIME ZONE $2 AS expires,
      (now() AT TIME ZONE $2)::date BETWEEN (details->>'startsOn')::date AND (details->>'endsOn')::date AS current
      FROM (SELECT DISTINCT ON(program_id) program_id,revision,state,details FROM oem_program_revisions
      WHERE program_id=ANY($1::uuid[]) ORDER BY program_id,revision DESC) p`,[ids,zone||"America/Chicago"])).rows;
  }
  const payment=claims.some(c=>c.type==="financial")?(await db.query("SELECT settings->'options' AS options,settings->>'financingEnabled' AS finance FROM client_profile WHERE id=1")).rows[0]:null;
  return {options:payment?.options||{},apr:payment?.finance!=="false" && payment?.options?.aprFinancingEnabled!==false,cars:new Map(cars.map(c=>[c.vin,c])),programs:new Map(programs.map(p=>[p.program_id,p]))};
}
function assessPageSources(values,evidence,sources,screen){
  const lines=pageLines(values),claims=evidence?.claims||[];
  let expiresAt=null;
  for(const [i,c] of claims.entries()){
    const fail=message=>({error:"Source "+(i+1)+". "+message});
    const quote=sourceText(c.quote);
    if(!quote || !lines.some(line=>containsFact(line,quote)))return fail("Quote the exact claim from the page.");
    const car=sources.cars.get(c.vin);
    if(c.type==="vehicle"){
      if(!car)return fail("Choose an available VIN in this dealership’s inventory.");
      if(!c.expected || sourceText(car[c.field])!==sourceText(c.expected))return fail("The specification differs from the current inventory record.");
      const mentioned=quote.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g)||[];
      if(mentioned.some(vin=>vin!==c.vin))return fail("Quote the specification for one VIN at a time.");
      if(!containsFact(quote,c.expected) || !(containsFact(quote,c.vin) || containsFact(quote,car.stock)))return fail("Include this VIN or stock number and the specification in the quoted claim.");
    }else{
      const p=sources.programs.get(c.program);
      if(!p || p.state!=="approved" || p.revision!==c.revision || !p.current)return fail("Select the current approved program within its effective dates.");
      const d=p.details;
      const approved=[d.disclosure,d.websiteOffer?.headline].map(sourceText);
      if(!(c.type==="financial"?approved.includes(quote):approved.some(text=>containsFact(text,quote))))return fail("Use the approved disclosure or offer headline for this claim.");
      if(c.type==="financial" && !sourceText([values.title,values.body,...(values.blocks||[]).flatMap(b=>[b.heading,b.text])].join(" ")).includes(sourceText(d.disclosure)))
        return fail("Include the program’s complete financial disclosure in the published page.");
      if(c.type==="financial"){
        const terms=sourceText([quote,d.disclosure].join(" "));
        const placement=d.websiteOffer?.page;
        const mode=placement==="lease-specials" || /\bleas(?:e|ing)\b/.test(terms)?"lease-specials":
          placement==="finance-specials" || /\bapr\b|annual percentage rate/.test(terms)?"finance-specials":null;
        if(mode && (!DealerSitePages.paymentPageAllowed(mode,sources.options,sources.apr) ||
          (car && !DealerSitePages.paymentPageAllowed(mode,car,car.apr))))return fail("The dealership or vehicle payment settings hide this offer.");
      }
      const restricted=d.websiteOffer?.vins||[];
      if((restricted.length || c.vin) && (!car || (restricted.length && !restricted.includes(c.vin)) ||
        !lines.some(line=>containsFact(line,quote) && (containsFact(line,c.vin)||containsFact(line,car.stock)))))return fail("Identify an eligible, available VIN or stock number on the same line as the offer.");
      const end=new Date(p.expires).toISOString();
      if(!expiresAt || end<expiresAt)expiresAt=end;
    }
  }
  if(screen){
    const rules=[["financial",/\b\d+(?:\.\d+)?\s*%\s*(?:apr|annual percentage rate)\b|\$[\d,.]+\s*(?:cash back|rebate|customer cash)\b/gi],
      ["manufacturer",/\b(?:factory|manufacturer(?:’s|'s)?)\s+warranty\b|\bEPA[- ](?:rated|estimated)\s+\d+(?:\.\d+)?\s*mpg\b/gi]];
    for(const [type,pattern] of rules)for(const line of lines)for(const match of line.matchAll(pattern)){
      if(!claims.some(c=>c.type===type && sourceText(c.quote).includes(match[0].toLowerCase()) && containsFact(line,c.quote)))
        return {error:"Attach an approved "+type+" source for “"+match[0]+"”."};
    }
  }
  return {expiresAt};
}
// Materialize only reviewed, still-supported copy. Preserve functional inventory and contact routes with their base copy.
async function invalidateVehiclePageSources(conn,vin){
  // Inventory writers already hold the same VIN lock used by publication.
  if(!(await conn.query("SELECT to_regclass('website_page_review_events') AS present")).rows[0].present)return;
  const editions=(await conn.query(`SELECT e.page_key,e.edition,e.stamp,e.content FROM client_profile p
    CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.settings->'pages')='object' THEN p.settings->'pages' ELSE '{}'::jsonb END) active
    JOIN website_page_editions e ON e.page_key=active.key AND active.value->>'evidenceEdition'=e.edition::text
    WHERE p.id=1 AND e.content->'evidence'->'claims' @> $1::jsonb AND NOT EXISTS
      (SELECT 1 FROM website_page_review_events v WHERE v.page_key=e.page_key AND v.edition=e.edition AND v.action='invalidate')`,[JSON.stringify([{vin}])])).rows;
  if(!editions.length)return;
  const sources=await readPageSources(conn,[{vin}],null);
  const car=sources.cars.get(vin);
  for(const row of editions){
    const claims=row.content.evidence.claims.filter(c=>c.vin===vin),lines=pageLines(row.content);
    const valid=car && claims.every(c=>c.type==="vehicle"?
      !assessPageSources(row.content,{claims:[c]},sources,false).error:
      lines.some(line=>containsFact(line,c.quote) && (containsFact(line,vin)||containsFact(line,car.stock))));
    if(valid)continue;
    await conn.query(`INSERT INTO website_page_review_events(id,page_key,action,draft_stamp,actor,note,content,edition)
      VALUES(gen_random_uuid(),$1,'invalidate',$2,'Inventory update',$3,$4,$5)`,
      [row.page_key,row.stamp,"A cited vehicle became unavailable or its cited facts changed.",{vin,claims},row.edition]);
  }
}
export async function publicEvidencePages(db,pages,zone){
  const entries=Object.entries(pageOverrides(pages)).filter(([,p])=>p?.evidenceEdition);
  if(!entries.length)return {pages,withheld:[],issues:{},deadlines:{},expiresAt:null};
  const result={...pageOverrides(pages)},withheld=[],issues={},deadlines={};
  let expiresAt=null;
  const rows=(await db.query(`SELECT e.page_key,e.content,EXISTS(SELECT 1 FROM website_page_review_events v WHERE v.page_key=e.page_key AND v.edition=e.edition AND v.action='invalidate') AS revoked
    FROM website_page_editions e JOIN jsonb_each_text($1::jsonb) requested
    ON requested.key=e.page_key AND requested.value=e.edition::text`,[Object.fromEntries(entries.map(([k,p])=>[k,p.evidenceEdition]))])).rows;
  const editions=new Map(rows.map(row=>[row.page_key,row]));
  const sources=await readPageSources(db,rows.flatMap(r=>r.content.evidence?.claims||[]),zone);
  for(const [key,override] of entries){
    if(override.enabled===false){result[key]={enabled:false};continue;}
    const record=editions.get(key),edition=record?.content;
    const matching=edition?.evidence && JSON.stringify(editablePage(edition))===JSON.stringify(editablePage(override));
    const check=record?.revoked?{error:"A cited inventory record changed. Review and approve a new revision."}:matching?assessPageSources(edition,edition.evidence,sources,true):{error:"The published source record could not be matched."};
    if(check.error){
      withheld.push(key);issues[key]=check.error;
      result[key]={enabled:override.enabled!==false && DealerSitePages.catalog.some(p=>p.key===key && !p.editorial)};
    }else{
      result[key]=editablePage(override);
      if(check.expiresAt)deadlines[key]=check.expiresAt;
      if(check.expiresAt && (!expiresAt || check.expiresAt<expiresAt))expiresAt=check.expiresAt;
    }
  }
  return {pages:result,withheld,issues,deadlines,expiresAt};
}
