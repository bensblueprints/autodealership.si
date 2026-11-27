(() => {
  const get=id=>document.getElementById(id), el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||""});
  const labels={scheduled:"Scheduled",attended:"Attended",missed:"No-show",canceled:"Canceled"};
  const dialog=get("visit-dialog"),form=get("visit-edit"),queue=get("drive-desk");
  let visits=[],zone="America/Chicago",loading=false,active=null,saving=false;
  const state=row=>row.visit?.state||"scheduled";
  const carTitle=car=>[car?.year,car?.make,car?.model].filter(Boolean).join(" ");
  const time=slot=>new Date(slot).toLocaleString("en-US",{timeZone:zone,weekday:"short",month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
  const detail=(box,label,value)=>{
    if(!value)return;
    const group=el("div");group.append(el("dt",label),el("dd",value));box.append(group);
  };
  function card(row){
    const article=el("article");article.className="visit-card";
    const car=row.car||{},info=el("div"),header=el("div");info.className="visit-main";header.className="visit-head";
    const photos=[...new Set([car.image,...(Array.isArray(car.photos)?car.photos:[])].filter(Boolean))];
    if(photos.length){
      const photo=el("img");let index=0;photo.alt="";photo.loading="lazy";
      photo.onerror=()=>{if(++index<photos.length)photo.src=photos[index];else photo.remove();};
      photo.src=photos[0];article.append(photo);
    }
    const badge=el("span",labels[state(row)]);badge.className="visit-state";badge.dataset.state=state(row);
    header.append(el("h3",row.name),badge);info.append(header,el("strong",time(row.slot)));
    info.append(el("p",[carTitle(car),car.stock&&"Stock #"+car.stock,row.vin].filter(Boolean).join(" · ")));
    const details=el("details");details.append(el("summary","Contact, notes and history"));
    const facts=el("dl");detail(facts,"Email",row.email);detail(facts,"Phone",row.phone);detail(facts,"Shopper’s message",row.message);
    detail(facts,"Trade-in",row.notes?.tradeIn);detail(facts,"Shopping preferences",row.notes?.preferences);
    if(row.bhph)detail(facts,"Selected payment plan",BHPH.summary(row.bhph,row.bhph));
    detail(facts,"Confirmation",row.confirmation);details.append(facts);
    if(row.visit?.history?.length){
      const list=el("ol");list.className="visit-history";
      for(const item of row.visit.history.slice().reverse()){
        const line=el("li");line.append(el("strong",item.action==="reschedule"?"Rescheduled to "+time(item.slot):labels[item.state]),
          el("small",time(item.at)+" · "+item.actor));
        if(item.note)line.append(el("span",item.note));list.append(line);
      }details.append(list);
    }
    info.append(details);
    const actions=el("div");actions.className="visit-actions";
    if(row.phone){
      const phone=el("a","Call shopper");phone.href="tel:"+row.phone.replace(/[^+0-9]/g,"");actions.append(phone);
    }
    const profile=el("button","View client");profile.type="button";profile.onclick=()=>DealerClients.open({visit:row.confirmation});actions.append(profile);
    if(state(row)!=="canceled"){
      const edit=el("button",state(row)==="scheduled"?"Manage visit":"Correct outcome");edit.type="button";edit.onclick=()=>open(row);actions.append(edit);
    }
    article.append(info,actions);return article;
  }
  function draw(){
    const now=Date.now(),query=get("visit-search").value.trim().toLowerCase(),filter=get("visit-filter").value;
    const upcoming=visits.filter(row=>state(row)==="scheduled" && Date.parse(row.slot)>=now);
    get("countDrives").textContent=upcoming.length;
    const next=get("next-drive");next.replaceChildren(upcoming.length?card(upcoming[0]):el("p","No upcoming test drives."));
    const matches=visits.filter(row=>{
      const s=state(row),due=Date.parse(row.slot)<=now;
      const visible=filter==="all" || filter===s || (s==="scheduled" && (filter==="upcoming"?!due:filter==="due"&&due));
      return visible && [row.name,row.email,row.phone,row.vin,row.car?.stock,carTitle(row.car)].join(" ").toLowerCase().includes(query);
    });
    const isUpcoming=row=>state(row)==="scheduled" && Date.parse(row.slot)>=now;
    matches.sort((a,b)=>Number(isUpcoming(b))-Number(isUpcoming(a)) || (isUpcoming(a)?Date.parse(a.slot)-Date.parse(b.slot):Date.parse(b.slot)-Date.parse(a.slot)));
    const expanded=new Set(Array.from(queue.querySelectorAll("article:has(details[open])"),item=>item.dataset.confirmation));
    queue.replaceChildren(...matches.map(row=>{
      const item=card(row);item.dataset.confirmation=row.confirmation;item.querySelector("details").open=expanded.has(row.confirmation);return item;
    }));
    get("visit-count").textContent=matches.length+" "+(matches.length===1?"appointment":"appointments");
    if(!matches.length)queue.append(el("p",visits.length?"No appointments match these filters.":"No test drives have been booked."));
  }
  let readVersion=0;
  async function refresh(force=false){
    if((loading || document.hidden || dialog.open) && !force)return;
    const version=++readVersion;loading=true;
    try{
      const res=await readDealerDesk("/api/test-drives/desk",{cache:"no-store"});
      if(version!==readVersion)return;
      if(!res.ok)throw Error(res.status===403?"Sign in again to access appointments.":"Appointments could not load. Try Refresh.");
      const data=await res.json();if(version!==readVersion)return;
      visits=data.appointments;zone=data.timezone;get("visit-status").textContent="";draw();
    }catch(error){
      if(version!==readVersion)return;
      visits=[];get("visit-status").textContent=error.message;get("next-drive").textContent=error.message;queue.replaceChildren();
      get("visit-count").textContent="";get("countDrives").textContent="—";
    }finally{if(version===readVersion)loading=false;}
  }
  async function actionChanged(){
    const row=active,action=form.elements.action.value,move=action==="reschedule";
    get("visit-slot-wrap").hidden=!move;get("visit-slot").required=move;
    form.elements.note.required=!!row && state(row)!=="scheduled";
    get("visit-save").disabled=!action || move || saving;
    get("visit-error").textContent="";if(!move)return;
    const select=get("visit-slot");select.replaceChildren(new Option("Choose a new time",""));
    try{
      const r=await fetch("/api/test-drives?vin="+encodeURIComponent(row.vin),{cache:"no-store"});
      if(!r.ok)throw Error();
      const data=await r.json();if(active!==row || form.elements.action.value!==action)return;
      for(const slot of data.slots)if(slot!==row.slot)select.add(new Option(time(slot),slot));
      get("visit-save").disabled=select.options.length<2;
      if(select.options.length<2)get("visit-error").textContent="No other times are available within the dealership’s hours.";
    }catch{if(active===row)get("visit-error").textContent="Available times could not load. Select the action again to retry.";}
  }
  function open(row){
    active=row;form.reset();get("today-visit-status").textContent="";get("visit-status").textContent="";
    get("visit-person").textContent=row.name;
    get("visit-when").textContent=[carTitle(row.car)||row.vin,time(row.slot)].join(" · ");
    const select=form.elements.action;select.replaceChildren(new Option("Choose an update",""));
    const current=state(row);
    if(Date.parse(row.slot)<=Date.now()){
      if(current!=="attended")select.add(new Option("Mark attended","attended"));
      if(current!=="missed")select.add(new Option("Mark no-show","missed"));
    }
    if(current==="scheduled"){select.add(new Option("Reschedule visit","reschedule"));select.add(new Option("Cancel appointment","canceled"));}
    actionChanged();dialog.showModal();
  }
  form.elements.action.onchange=actionChanged;
  form.onsubmit=async event=>{
    event.preventDefault();if(saving || !active || !form.reportValidity())return;
    const row=active,action=form.elements.action.value;saving=true;get("visit-save").disabled=true;get("visit-close").disabled=true;
    try{
      const r=await fetch("/api/test-drives/desk",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        confirmation:row.confirmation,revision:row.visit?.revision||0,action,slot:get("visit-slot").value,note:form.elements.note.value.trim()})});
      const data=await r.json();if(!r.ok){if(r.status===409)await refresh(true);throw Error(data.error||"Visit update failed.");}
      dialog.close();await refresh(true);
      const status=get("today").hidden?get("visit-status"):get("today-visit-status");
      status.textContent=action==="reschedule"?"Rescheduled to "+time(data.slot)+". Confirm the new time with the shopper.":"Visit updated to "+labels[data.state].toLowerCase()+".";
    }catch(error){get("visit-error").textContent=error.message;}
    finally{saving=false;get("visit-save").disabled=false;get("visit-close").disabled=false;}
  };
  dialog.onclose=()=>{active=null;};dialog.addEventListener("cancel",e=>{if(saving)e.preventDefault();});
  get("visit-close").onclick=()=>dialog.close();
  get("visit-filter").onchange=draw;get("visit-search").oninput=draw;get("visit-refresh").onclick=()=>refresh(true);
  document.addEventListener("DOMContentLoaded",()=>refresh());
  for(const key of ["today","leads"])document.querySelector('[data-view="'+key+'"]').addEventListener("click",()=>refresh());
  window.addEventListener("focus",()=>refresh());
  setInterval(()=>{
    if(document.hidden)return;
    if((!get("leads").hidden || !get("today").hidden) && !queue.contains(document.activeElement) && !get("next-drive").contains(document.activeElement))refresh();
    if(!get("inquiries").hidden||!get("today").hidden)Store.loadLeads();
  },30000);
})();
