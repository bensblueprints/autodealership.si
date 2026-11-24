const appointmentPrefix="appointments/";
function driveSlots(){
  const slots=[];
  const now=Date.now();
  const formatter=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short",hour:"numeric",hourCycle:"h23"});
  for(let t=Math.ceil((now+3600000)/3600000)*3600000;t<now+14*86400000;t+=3600000){
    const parts=Object.fromEntries(formatter.formatToParts(t).map(p=>[p.type,p.value]));
    if(!["Sat","Sun"].includes(parts.weekday) && +parts.hour>=10 && +parts.hour<=16)slots.push(new Date(t).toISOString());
  }
  return slots;
}
async function appointmentApi(request,env){
  const url=new URL(request.url), bucket=env.BUCKET;
  if(!bucket)return profileReply({error:"Booking storage unavailable."},503);
  const admin=env.privateAdmin || request.headers.get("oai-authenticated-user-email")==="benji@benjaminboyce.com";
  if(url.pathname.endsWith("/desk")){
    if(!admin)return profileReply({error:"Dealer sign-in required."},403);
    if(request.method!=="GET")return profileReply({},405);
    const rows=[];
    let cursor;
    do {
      const page=await bucket.list({prefix:appointmentPrefix,cursor});
      for(const item of page.objects){const record=await bucket.get(item.key);if(record)rows.push(await record.json());}
      cursor=page.truncated?page.cursor:undefined;
    }while(cursor);
    return profileReply({appointments:rows.sort((a,b)=>a.slot.localeCompare(b.slot))});
  }
  const vin=url.searchParams.get("vin")||"";
  if(!bookingVins.has(vin))return profileReply({error:"Select a vehicle from the dealer inventory."},400);
  const prefix=appointmentPrefix+vin+"/",slots=driveSlots();
  if(request.method==="GET"){
    const occupied=await bucket.list({prefix});
    const taken=new Set(occupied.objects.map(o=>o.key.slice(prefix.length)));
    return profileReply({slots:slots.filter(s=>!taken.has(s))});
  }
  if(request.method!=="POST" || request.headers.get("origin")!==url.origin || !request.headers.get("content-type")?.startsWith("application/json"))return profileReply({},403);
  let data;
  try{const raw=await request.text();if(raw.length>5000)throw Error();data=JSON.parse(raw);}catch{return profileReply({error:"Invalid booking."},400);}
  if(!data || !slots.includes(data.slot)||typeof data.name!=="string"||!data.name.trim()||data.name.length>100||typeof data.email!=="string"||data.email.length>200||!/^\S+@\S+\.\S+$/.test(data.email)||typeof data.phone!=="string"||data.phone.length>40||typeof data.message!=="string"||data.message.length>2000)return profileReply({error:"Check the time and contact details."},400);
  const record={vin,slot:data.slot,name:data.name.trim(),email:data.email.trim(),phone:data.phone.trim(),message:data.message.trim(),confirmation:crypto.randomUUID(),createdAt:new Date().toISOString()};
  const saved=await bucket.put(prefix+record.slot,JSON.stringify(record),{onlyIf:{etagDoesNotMatch:"*"}});
  return saved?profileReply({confirmation:record.confirmation},201):profileReply({error:"This time was just reserved. Choose another time."},409);
}
