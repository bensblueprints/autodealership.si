const appointmentPrefix="appointments/";
const weekdayKeys=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const defaultDriveHours=Object.fromEntries(weekdayKeys.map(day=>[day,["Sun","Sat"].includes(day)?null:["10:00","17:00"]]));
function driveSlots(hours=defaultDriveHours,timezone="America/Chicago"){
  const slots=[];
  const now=Date.now();
  const formatter=new Intl.DateTimeFormat("en-US",{timeZone:timezone,weekday:"short",minute:"2-digit",hour:"numeric",hourCycle:"h23"});
  for(let t=Math.floor((now+3600000)/3600000)*3600000;t<now+14*86400000;t+=3600000){
    const parts=Object.fromEntries(formatter.formatToParts(t).map(p=>[p.type,p.value]));
    const range=hours[parts.weekday];if(!range)continue;
    const mins=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
    const open=mins(range[0]),close=mins(range[1]),local=Number(parts.hour)*60+Number(parts.minute);
    const offset=((open-local)%60+60)%60,start=t+offset*60000;
    if(local+offset>=open && local+offset+60<=close && start>=now+3600000 && start<now+14*86400000)slots.push(new Date(start).toISOString());
  }
  return slots;
}
async function appointmentApi(request,env){
  const url=new URL(request.url), bucket=env.BUCKET;
  if(!bucket)return profileReply({error:"Booking storage unavailable."},503);
  const admin=env.privateAdmin || request.headers.get("oai-authenticated-user-email")==="benji@benjaminboyce.com";
  const storedProfile=await bucket.get(profileKey);
  const profile=(storedProfile && await storedProfile.json())?.profile||{};
  const timezone=profile.driveTimezone||"America/Chicago";
  if(url.pathname.endsWith("/desk")){
    if(!admin)return profileReply({error:"Dealer sign-in required."},403);
    if(request.method!=="GET")return profileReply({},405);
    const rows=[];
    let cursor;
    do {
      const page=await bucket.list({prefix:appointmentPrefix,cursor});
      for(const item of page.objects){const record=await bucket.get(item.key);if(record){
        const {noteToken,requestFingerprint,...customer}=await record.json();
        customer.notes={};
        for(const field of ["tradeIn","preferences"]){
          const note=await bucket.get("drive-notes/"+customer.confirmation+"/"+field);
          if(note)customer.notes[field]=await note.json();
        }
        rows.push(customer);
      }}
      cursor=page.truncated?page.cursor:undefined;
    }while(cursor);
    return profileReply({timezone,appointments:rows.sort((a,b)=>a.slot.localeCompare(b.slot))});
  }
  const vin=url.searchParams.get("vin")||"";
  if(!(env.clientHasVin?await env.clientHasVin(vin):bookingVins.has(vin)))return profileReply({error:"Select a vehicle from the dealer inventory."},400);
  const prefix=appointmentPrefix+vin+"/",slots=driveSlots(profile.driveHours,timezone);
  if(request.method==="GET" && !url.pathname.endsWith("/notes")){
    const occupied=await bucket.list({prefix});
    const taken=new Set(occupied.objects.map(o=>o.key.slice(prefix.length)));
    return profileReply({timezone,slots:slots.filter(s=>!taken.has(s))});
  }
  if(request.method!=="POST" || request.headers.get("origin")!==url.origin || !request.headers.get("content-type")?.startsWith("application/json"))return profileReply({},403);
  let data;
  try{const raw=await request.text();if(raw.length>5000)throw Error();data=JSON.parse(raw);}catch{return profileReply({error:"Invalid booking."},400);}
  if(url.pathname.endsWith("/notes")){
    if(!data || typeof data.slot!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:[0-5]\d:00\.000Z$/.test(data.slot) || !["tradeIn","preferences"].includes(data.field) || typeof data.answer!=="string" || !data.answer.trim() || data.answer.length>1000)return profileReply({error:"Enter a customer answer."},400);
    const saved=await bucket.get(prefix+data.slot);
    const record=saved && await saved.json();
    if(!record?.noteToken || data.token!==record.noteToken)return profileReply({error:"Booking access required."},403);
    await bucket.put("drive-notes/"+record.confirmation+"/"+data.field,JSON.stringify(data.answer.trim()));
    return profileReply({saved:true});
  }
  if(!data || typeof data.slot!=="string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(data.slot)||typeof data.name!=="string"||!data.name.trim()||data.name.length>100||typeof data.email!=="string"||data.email.length>200||!/^\S+@\S+\.\S+$/.test(data.email)||typeof data.phone!=="string"||data.phone.length>40||!/^\+?[0-9(). \-]+$/.test(data.phone.trim())||!/^\d{7,15}$/.test(data.phone.replace(/\D/g,""))||typeof data.message!=="string"||data.message.length>2000)return profileReply({error:"Check the time and contact details."},400);
  if(data.requestId!==undefined && (typeof data.requestId!=="string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.requestId)))return profileReply({error:"Invalid booking reference."},400);
  const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,"0")).join("");
  const record={vin,slot:data.slot,name:data.name.trim(),email:data.email.trim(),phone:data.phone.trim(),message:data.message.trim(),confirmation:crypto.randomUUID(),noteToken:crypto.randomUUID(),createdAt:new Date().toISOString()};
  if(data.requestId){
    const key=await hash("test-drive:"+data.requestId.toLowerCase());
    record.confirmation=[key.slice(0,8),key.slice(8,12),"8"+key.slice(13,16),"a"+key.slice(17,20),key.slice(20,32)].join("-");
    record.requestFingerprint=await hash(JSON.stringify([vin,data.slot,record.name,record.email,record.phone,record.message,data.bhph?.revision??null,data.bhph?.months??null,data.bhph?.frequency??null]));
  }
  const receipt=(row, status)=>profileReply({confirmation:row.confirmation,noteToken:row.noteToken,eventId:"test_drive_booked:"+row.confirmation},status);
  async function replay(){
    if(!data.requestId)return null;
    const stored=await bucket.get(prefix+record.slot),prior=stored && await stored.json();
    if(prior?.confirmation!==record.confirmation)return null;
    return prior.requestFingerprint===record.requestFingerprint?receipt(prior,200):profileReply({error:"This booking reference was already used for different details."},409);
  }
  const existing=await replay();
  if(existing)return existing;
  if(!slots.includes(data.slot))return profileReply({error:"Choose a currently available time."},400);
  record.conversion={type:"test_drive_booked",eventId:"test_drive_booked:"+record.confirmation,channel:data.channel==="concierge"?"concierge":"website",occurredAt:record.createdAt};
  if(data.bhph){
    record.bhph=await env.offerSnapshot?.(vin,data.bhph);
    if(!record.bhph)return profileReply({error:"Financing terms changed. Reload the listing and review them before booking."},422);
  }
  const saved=await bucket.put(prefix+record.slot,JSON.stringify(record),{onlyIf:{etagDoesNotMatch:"*"}});
  return saved?receipt(record,201):await replay() || profileReply({error:"This time is unavailable. Choose another time."},409);
}
