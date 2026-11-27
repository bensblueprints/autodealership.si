const profileKey="dealer-profile.json";
const profileKeys=["logo","logoLightBackground","salesPhone","partsPhone","servicePhone","street","city","region","postal","country","facebook","instagram","youtube","tiktok","x","linkedin"];
function profileReply(body,status=200){return Response.json(body,{status,headers:{"Cache-Control":"no-store"}});}
function validateProfile(input){
  if(!input || typeof input.dealerName!=="string" || !(input.dealerName.trim()) || input.dealerName.length>120 || typeof input.profile!=="object" || !input.profile)throw Error("Enter a dealership name and profile.");
  const skin=input.profile.skin||"midnight";
  if(!["midnight", "pearl", "navy", "forest", "burgundy", "plum", "slate", "sand"].includes(skin))throw Error("Unknown showroom skin.");
  const profile={skin};
  profile.siteTemplate=input.profile.siteTemplate||"classic";
  if(!Object.hasOwn(DealerSitePages.templates,profile.siteTemplate))throw Error("Choose a supported showroom template.");
  const code=input.profile.googleStoreCode||"";
  if(typeof code!=="string" || !/^[A-Za-z0-9_-]{0,64}$/.test(code))throw Error("Enter a valid Google Business Profile store code (up to 64 characters).");
  profile.googleStoreCode=code;
  for(const key of ["driveHours","salesHours","serviceHours","partsHours"]){
    if(input.profile[key]==null)continue;
    const zone=input.profile.driveTimezone;
    if(typeof zone!=="string" || !["America/New_York","America/Chicago","America/Denver","America/Phoenix","America/Los_Angeles","America/Anchorage","Pacific/Honolulu"].includes(zone))throw Error("Select a dealership time zone.");
    profile.driveTimezone=zone;profile[key]={};
    for(const day of ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]){
      const pair=input.profile[key][day];
      if(pair!==null && !(Array.isArray(pair)&&pair.length===2&&pair.every(t=>typeof t==="string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))&&pair[0]<pair[1]))throw Error("Check opening and closing times for "+day+".");
      profile[key][day]=pair;
    }
  }
  for(const key of profileKeys){
    const str=input.profile[key]??"";
    if(typeof str!=="string")throw Error("Invalid profile field.");
    const value=str.trim();
    if((key==="logo" || key==="logoLightBackground") && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)){
      if(value.length>630000)throw Error("Choose a smaller logo.");
    } else if(["logo","logoLightBackground","facebook","instagram","youtube","tiktok","x","linkedin"].includes(key) && value){
      let u;try{u=new URL(value);}catch{throw Error("Enter a complete HTTPS URL.");}
      if(u.protocol!=="https:" || u.username || u.password || value.length>4096)throw Error("Enter a valid HTTPS URL.");
    } else if(value.length>200)throw Error("One of the address or phone fields is too long.");
    profile[key]=value;
  }
  const pageKeys=new Map(DealerSitePages.catalog.map(page=>[page.key,page]));
  const pages={};
  for(const [key,page] of Object.entries(input.pages??{})){
    if(!pageKeys.has(key)||!page || typeof page!=="object")throw Error("Invalid page.");
    const entry={};
    for(const [field,limit] of [["title",150],["body",12000],["url",4096]]){
      if(!(field in page))continue;
      if(typeof page[field]!=="string"||page[field].length>limit)throw Error("Page content exceeds the allowed length.");
      entry[field]=page[field].trim();
      if(field==="url" && entry.url && !/^https:\/\//i.test(entry.url))throw Error("Page actions require an HTTPS URL.");
      if(field==="url" && entry.url){const u=new URL(entry.url);if(u.username||u.password)throw Error("Invalid destination URL.");}
    }
    if("enabled" in page){if(typeof page.enabled!=="boolean")throw Error("Invalid page visibility.");entry.enabled=page.enabled;}
    const blocks=DealerSitePages.blocksForDraft(page.blocks);
    if(blocks.some(b=>!b.heading || !b.text))throw Error("Complete all published page blocks.");
    if(blocks.length)entry.blocks=blocks;
    if(pageKeys.get(key).editorial && entry.enabled!==false && !entry.body && !blocks.length)throw Error("Add dealership content before publishing this page.");
    pages[key]=entry;
  }
  const options={};
  for(const key of "year make model trim features fuel transmission miles engine color interior drivetrain body doors location status price cash finance lease compare pricing payment trade availability relatedVehicles financingEnabled aprFinancingEnabled".split(" ")){
    if(typeof input.options?.[key]==="boolean")options[key]=input.options[key];
  }
  const tradeUrl=input.tradeUrl||"";
  if(tradeUrl){const u=new URL(tradeUrl);if(u.protocol!=="https:" || u.username || u.password || tradeUrl.length>4096)throw Error("Enter a valid trade provider URL.");}
  return {options,tradeUrl,dealerName:input.dealerName.trim(),financingEnabled:input.financingEnabled!==false,profile,pages};
}
function pageOverrides(value){
  return Array.isArray(value)?Object.fromEntries(value.filter(p=>p?.key).map(p=>[p.key,p])):value??{};
}
function samePageOverrides(first,second){
  // Preserve the distinction between an inherited field and an explicit override.
  const signature=pages=>JSON.stringify(Object.keys(pages).sort().map(key=>[key,...["title","body","url","enabled"].map(k=>pages[key]?.[k]??null),DealerSitePages.blocksForDraft(pages[key]?.blocks)]));
  return signature(first)===signature(second);
}
async function dealershipProfile(request,env){
  const bucket=env?.BUCKET;
  if(!bucket)return profileReply({error:"Shared profile storage is unavailable."},503);
  if(request.method==="GET"){
    const saved=await bucket.get(profileKey);
    if(!saved)return profileReply({revision:"0",settings:null});
    const settings=await saved.json();
    if(!env.publicPageSources || !settings.pages)return profileReply({revision:saved.etag,settings});
    const pages=pageOverrides(settings.pages),trackedPages=Object.keys(pages).filter(k=>pages[k]?.evidenceEdition);
    const review=await env.publicPageSources(settings.pages,settings.profile?.driveTimezone);
    return profileReply({revision:saved.etag,settings:{...settings,pages:review.pages},trackedPages,pageState:review.withheld.sort().join(","),expiresAt:review.expiresAt});
  }
  if(request.method!=="PUT")return profileReply({error:"Unsupported method"},405);
  if(!env.privateAdmin && request.headers.get("oai-authenticated-user-email")?.toLowerCase()!=="benji@benjaminboyce.com")return profileReply({error:"Dealer administrator access required."},403);
  if(request.headers.get("origin")!==new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json"))return profileReply({error:"Use the dealer dashboard to make changes."},403);
  if(Number(request.headers.get("content-length"))>2000000)return profileReply({error:"Logo is too large."},413);
  try{
    const bytes=await request.text();if(bytes.length>2000000)return profileReply({error:"Logo is too large."},413);
    const input=JSON.parse(bytes),revision=input.revision;
    const previous=await bucket.get(profileKey);
    if((previous?.etag??"0")!==revision)return profileReply({error:"Another edit was saved. Reopen settings to review it."},409);
    const prior=previous?await previous.json():{};
    const wasFranchise=prior.profile?.siteTemplate==="franchise",willBeFranchise=input.profile?.siteTemplate==="franchise";
    const original=pageOverrides(prior.pages);
    const protectedKeys=Object.keys(original).filter(k=>original[k]?.evidenceEdition);
    if(protectedKeys.length && input.pages!==undefined){
      const exposed=await env.publicPageSources(original,prior.profile?.driveTimezone);
      const requested=pageOverrides(input.pages);
      for(const k of protectedKeys){
        if(!requested[k] || !samePageOverrides({[k]:requested[k]},{[k]:exposed.pages[k]}))
          return profileReply({error:"Use Website pages to change source-reviewed content."},409);
        requested[k]=original[k];
      }
      input.pages=requested;
    }
    let settings;
    if(env.canReviewPages!==undefined && (wasFranchise || willBeFranchise)){
      if(wasFranchise!==willBeFranchise && !env.canReviewPages)return profileReply({error:"A dealership administrator must change the franchise template."},403);
      const current=pageOverrides(prior.pages);
      if(input.pages!==undefined && !samePageOverrides(current,pageOverrides(input.pages)))return profileReply({error:"Review and publish franchise page changes in Website pages."},409);
      settings=validateProfile({...input,pages:{}});settings.pages=current;
    }else {
      const current=pageOverrides(prior.pages),pages=pageOverrides(input.pages??current);
      // Clients that predate content blocks can still update an existing page.
      for(const [key,value] of Object.entries(pages)){
        if(value && !Object.hasOwn(value,"blocks") && current[key]?.blocks?.length)pages[key]={...value,blocks:current[key].blocks};
      }
      settings=validateProfile({...input,pages});
    }
    for(const k of protectedKeys)settings.pages[k]=original[k];
    if(typeof revision!=="string" || !revision)return profileReply({error:"Reload the profile before saving."},409);
    const object=await bucket.put(profileKey,JSON.stringify(settings),{onlyIf:revision==="0"?{etagDoesNotMatch:"*"}:{etagMatches:revision}});
    if(!object)return profileReply({error:"Another edit was saved. Reopen settings to review it."},409);
    if(protectedKeys.length){
      const review=await env.publicPageSources(settings.pages,settings.profile?.driveTimezone);
      return profileReply({revision:object.etag,settings:{...settings,pages:review.pages},trackedPages:protectedKeys,pageState:review.withheld.sort().join(","),expiresAt:review.expiresAt});
    }
    return profileReply({revision:object.etag,settings});
  }catch(error){return profileReply({error:error.message||"Could not save the dealership profile."},400);}
}
