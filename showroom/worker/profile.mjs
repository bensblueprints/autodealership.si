const profileKey="dealer-profile.json";
const profileKeys=["logo","logoLightBackground","salesPhone","partsPhone","servicePhone","street","city","region","postal","country","facebook","instagram","youtube","tiktok","x","linkedin"];
function profileReply(body,status=200){return Response.json(body,{status,headers:{"Cache-Control":"no-store"}});}
function validateProfile(input){
  if(!input || typeof input.dealerName!=="string" || !(input.dealerName.trim()) || input.dealerName.length>120 || typeof input.profile!=="object" || !input.profile)throw Error("Enter a dealership name and profile.");
  const skin=input.profile.skin||"midnight";
  if(!["midnight", "pearl", "navy", "forest", "burgundy", "plum", "slate", "sand"].includes(skin))throw Error("Unknown showroom skin.");
  const profile={skin};
  if(input.profile.driveHours!==undefined){
    const zone=input.profile.driveTimezone;
    if(typeof zone!=="string" || !["America/New_York","America/Chicago","America/Denver","America/Phoenix","America/Los_Angeles","America/Anchorage","Pacific/Honolulu"].includes(zone))throw Error("Select a dealership time zone.");
    profile.driveTimezone=zone;profile.driveHours={};
    for(const day of ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]){
      const pair=input.profile.driveHours?.[day];
      if(pair!==null && !(Array.isArray(pair)&&pair.length===2&&pair.every(t=>typeof t==="string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))&&pair[0]<pair[1]))throw Error("Check opening and closing times for "+day+".");
      profile.driveHours[day]=pair;
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
  const pageKeys=new Set("new-vehicles pre-owned certified-pre-owned under-20k service-department schedule-service parts-catalog finance-center apply-financing payment-calculator value-trade about contact staff testimonials why-service".split(" "));
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
    pages[key]=entry;
  }
  const options={};
  for(const key of "year make model trim features fuel transmission miles engine color body doors location status price cash finance lease compare pricing payment trade availability financingEnabled".split(" ")){
    if(typeof input.options?.[key]==="boolean")options[key]=input.options[key];
  }
  const tradeUrl=input.tradeUrl||"";
  if(tradeUrl){const u=new URL(tradeUrl);if(u.protocol!=="https:" || u.username || u.password || tradeUrl.length>4096)throw Error("Enter a valid trade provider URL.");}
  return {options,tradeUrl,dealerName:input.dealerName.trim(),financingEnabled:input.financingEnabled!==false,profile,pages};
}
async function dealershipProfile(request,env){
  const bucket=env?.BUCKET;
  if(!bucket)return profileReply({error:"Shared profile storage is unavailable."},503);
  if(request.method==="GET"){
    const saved=await bucket.get(profileKey);
    return profileReply(saved?{revision:saved.etag,settings:await saved.json()}:{revision:"0",settings:null});
  }
  if(request.method!=="PUT")return profileReply({error:"Unsupported method"},405);
  if(!env.privateAdmin && request.headers.get("oai-authenticated-user-email")?.toLowerCase()!=="benji@benjaminboyce.com")return profileReply({error:"Dealer administrator access required."},403);
  if(request.headers.get("origin")!==new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json"))return profileReply({error:"Use the dealer dashboard to make changes."},403);
  if(Number(request.headers.get("content-length"))>2000000)return profileReply({error:"Logo is too large."},413);
  try{
    const bytes=await request.text();if(bytes.length>2000000)return profileReply({error:"Logo is too large."},413);
    const input=JSON.parse(bytes),settings=validateProfile(input),revision=input.revision;
    if(typeof revision!=="string" || !revision)return profileReply({error:"Reload the profile before saving."},409);
    const object=await bucket.put(profileKey,JSON.stringify(settings),{onlyIf:revision==="0"?{etagDoesNotMatch:"*"}:{etagMatches:revision}});
    if(!object)return profileReply({error:"Another edit was saved. Reopen settings to review it."},409);
    return profileReply({revision:object.etag,settings});
  }catch(error){return profileReply({error:error.message||"Could not save the dealership profile."},400);}
}
