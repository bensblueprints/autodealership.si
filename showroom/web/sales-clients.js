const DealerClients=(()=>{
  const get=id=>document.getElementById(id),list=get("client-list"),detail=get("client-detail"),intake=get("client-intake");
  const stages={intake:"Client intake",inquiry:"Website inquiry",scheduled:"Test drive scheduled",attended:"Test drive taken",followup:"Follow-up",presented:"Contract presented",signed:"Contract signed · Purchased"};
  const visitStates={scheduled:"Scheduled",attended:"Test drive taken",missed:"No-show",canceled:"Canceled"};
  const el=(tag,text,css)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(css)node.className=css;return node;};
  const button=(text,fn)=>{const b=el("button",text);b.type="button";b.onclick=fn;return b;};
  const label=(text,field)=>{const l=el("label",text);l.append(field);return l;};
  const date=(at,zone)=>at?new Date(at).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short",...(zone?{timeZone:zone}:{})}):"";
  const money=cents=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(Number(cents)/100);
  const carName=(car,vin)=>[car?.stock && "#"+car.stock,[car?.year,car?.make,car?.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ")||vin||"General interest";
  let offset=0,version=0,selection=0,selected="",timer,intakeRequest;
  async function api(params,method="GET"){
    const url="/api/clients"+(method==="GET"?"?"+new URLSearchParams(params):"");
    const res=method==="GET"?await readDealerDesk(url,{cache:"no-store"}):await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(params)});
    const data=await res.json();if(!res.ok)throw Error(data.error||"The client record could not be loaded.");return data;
  }
  async function load(reset=false){
    if(reset)offset=0;
    const seq=++version;
    try{
      const data=await api({search:get("client-search").value,stage:get("client-filter").value,offset});if(seq!==version)return;
      list.replaceChildren();get("client-prev").hidden=!offset;get("client-next").hidden=!data.more;
      get("client-status").textContent=data.items.length?"":"No clients match this view.";
      for(const o of data.items){
        const b=button("",()=>show({id:o.id}));b.className="client-row";b.dataset.id=o.id;b.setAttribute("aria-pressed",String(o.id===selected));
        b.append(el("strong",o.name),el("small",carName(o.car,o.vin)),el("span",stages[o.stage],"client-stage"));list.append(b);
      }
    }catch(e){if(seq===version)get("client-status").textContent=e.message;}
  }
  function vehicles(select,empty,vin){
    select.replaceChildren(new Option(empty,""));
    for(const car of Store.cars())if(car.vin)select.add(new Option(carName(car,car.vin),car.vin));
    if(vin && [...select.options].some(o=>o.value===vin))select.value=vin;
  }
  function formButton(text){
    const b=el("button",text,"primary");b.type="submit";return b;
  }
  function statusLine(){const p=el("p");p.setAttribute("role","status");return p;}
  async function refreshed(id){await Promise.all([show({id}),load()]);}
  function booking(data){
    const panel=el("details",undefined,"client-booking");panel.append(el("summary","Schedule a test drive"));
    const form=el("form"),fields=el("div",undefined,"client-fields"),car=el("select"),times=el("select"),note=el("textarea"),save=formButton("Book test drive"),status=statusLine();
    car.required=true;times.required=true;note.maxLength=2000;note.rows=2;
    fields.append(label("Vehicle / stock",car),label("Available time",times),label("Visit notes",note));
    form.append(fields,save,status);panel.append(form);if(!data.client.phone){status.textContent="Add a callback number using Add client with the same email before booking.";}
    let check=0,request=crypto.randomUUID();
    async function slots(){
      const serial=++check;request=crypto.randomUUID();save.disabled=true;times.replaceChildren(new Option("Choose a time",""));
      if(!car.value || !data.client.phone)return;status.textContent="Loading times…";
      try{
        const res=await fetch("/api/test-drives?vin="+encodeURIComponent(car.value),{cache:"no-store"}),available=await res.json();
        if(!res.ok)throw Error(available.error||"Could not load times.");
        if(serial!==check)return;
        for(const slot of available.slots)times.add(new Option(date(slot,available.timezone),slot));
        status.textContent=available.slots.length?"Dealership time · "+available.timezone:"No available times for this vehicle.";save.disabled=!available.slots.length;
      }catch(e){if(serial===check)status.textContent=e.message;}
    }
    panel.ontoggle=()=>{if(panel.open && !car.options.length){vehicles(car,"Select a vehicle",data.deals[0]?.vin);slots();}};
    car.onchange=slots;save.disabled=true;times.onchange=()=>{request=crypto.randomUUID();};
    form.onsubmit=async e=>{
      e.preventDefault();save.disabled=true;
      try{const saved=await api({action:"book",id:data.client.id,request,vin:car.value,slot:times.value,note:note.value},"POST");await refreshed(data.client.id);get("client-result").textContent="Test drive booked. Confirmation "+saved.confirmation;}
      catch(err){await slots();status.textContent=err.message;/* Pick a newly available slot after a conflict. */}
    };return panel;
  }
  function dealCard(deal,data){
    const article=el("article",undefined,"client-deal"),header=el("div",undefined,"client-deal-head");
    header.append(el("h4",carName(deal.car,deal.vin)),el("span",stages[deal.stage],"client-stage"));article.append(header);
    if(deal.vin)article.append(el("small","VIN "+deal.vin));
    if(deal.cents!==null)article.append(el("p","Contract value · "+money(deal.cents),"client-value"));
    if(!data.canEdit)return article;
    const more=el("details"),form=el("form"),stage=el("select"),amount=el("input"),note=el("textarea"),save=formButton("Save sales update"),status=statusLine();
    more.append(el("summary","Update sales stage"));const options=deal.stage==="signed"?["signed"]:deal.vin?["followup","presented","signed"]:["followup"];
    for(const key of options)stage.add(new Option(stages[key],key));if(options.includes(deal.stage))stage.value=deal.stage;
    amount.type="number";amount.min="0.01";amount.step=".01";amount.max="999999999.99";if(deal.cents!==null)amount.value=(Number(deal.cents)/100).toFixed(2);
    note.rows=2;note.maxLength=2000;const field=label("Contract value (USD)",amount),fields=el("div",undefined,"client-fields");
    function mode(){field.hidden=stage.value==="followup";amount.required=stage.value==="signed";}stage.onchange=mode;mode();
    fields.append(label("Sales stage",stage),field,label("Sales note",note));form.append(fields,save,status);more.append(form);article.append(more);
    form.onsubmit=async e=>{
      e.preventDefault();save.disabled=true;
      const cents=field.hidden||amount.value===""?null:Math.round(Number(amount.value)*100);
      try{await api({id:data.client.id,vin:deal.vin,revision:deal.revision,stage:stage.value,cents,note:note.value},"PUT");await refreshed(data.client.id);get("client-result").textContent="Sales update saved.";}
      catch(err){status.textContent=err.message;save.disabled=false;}
    };return article;
  }
  function activity(data){
    const events=[];
    for(const x of [...data.intakes,...data.inquiries])events.push({at:x.at,title:x.source||"Website inquiry",text:[x.actor,x.note,x.vin].filter(Boolean).join(" · ")});
    for(const v of data.visits){
      events.push({at:v.at||v.slot,title:"Test drive booked",text:[date(v.slot),visitStates[v.state],v.vin,v.note,v.notes?.tradeIn && "Trade-in: "+v.notes.tradeIn,v.notes?.preferences && "Preferences: "+v.notes.preferences].filter(Boolean).join(" · ")});
      for(const h of v.history||[])events.push({at:h.at,title:h.action==="reschedule"?"Test drive rescheduled":visitStates[h.state],text:[h.actor,h.note,v.vin].filter(Boolean).join(" · ")});
    }
    for(const {vin,change} of data.changes)events.push({at:change.at,title:stages[change.stage],text:[change.cents!==null&&money(change.cents),change.actor,change.note,vin].filter(Boolean).join(" · ")});
    const ol=el("ol",undefined,"client-timeline");
    for(const x of events.sort((a,b)=>Date.parse(b.at||0)-Date.parse(a.at||0))){
      const li=el("li");li.append(el("strong",x.title),el("small",date(x.at)),el("p",x.text));ol.append(li);
    }return ol;
  }
  async function show(query){
    const seq=++selection;detail.setAttribute("aria-busy","true");
    try{
      const data=await api(query);if(seq!==selection)return;const o=data.client;selected=o.id;
      for(const b of list.children)b.setAttribute("aria-pressed",String(b.dataset.id===o.id));
      const result=statusLine();result.id="client-result";
      detail.replaceChildren(el("h3",o.name),el("p",[o.phone,o.email,o.owner?.label].filter(Boolean).join(" · "),"client-contact"),result);
      if(data.canEdit)detail.append(booking(data));
      detail.append(el("h4","Vehicles & contracts","client-subhead"),...data.deals.map(d=>dealCard(d,data)),el("h4","Activity","client-subhead"),activity(data));
    }catch(e){if(seq===selection)detail.replaceChildren(el("p",e.message),button("Retry",()=>show(query)));}
    finally{if(seq===selection)detail.removeAttribute("aria-busy");}
  }
  function open(query){document.querySelector('button[data-view="clients"]').click();return show(query);}
  for(const [key,name] of Object.entries(stages))get("client-filter").add(new Option(name,key));
  get("client-filter").onchange=()=>load(true);get("client-search").oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),180);};
  get("client-prev").onclick=()=>{offset=Math.max(0,offset-50);load();};get("client-next").onclick=()=>{offset+=50;load();};
  get("client-add").onclick=()=>{intake.reset();vehicles(intake.elements.vin,"No vehicle selected");intakeRequest=crypto.randomUUID();intake.hidden=false;intake.querySelector("[role=status]").textContent="";intake.elements.name.focus();};
  get("client-cancel").onclick=()=>{intake.hidden=true;get("client-add").focus();};
  intake.onsubmit=async e=>{
    e.preventDefault();const submit=intake.querySelector("[type=submit]");submit.disabled=true;
    try{const data=await api({...Object.fromEntries(new FormData(intake)),request:intakeRequest,action:"intake"},"POST");intake.hidden=true;get("client-search").value="";get("client-filter").value="";offset=0;await refreshed(data.id);get("client-result").textContent="Contact saved.";}
    catch(err){intake.querySelector("[role=status]").textContent=err.message;}finally{submit.disabled=false;}
  };
  return {open,load};
})();
