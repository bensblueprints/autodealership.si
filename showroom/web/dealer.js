(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const fmt = new Intl.NumberFormat("en-US");
  const statuses=["New","Contacted","Appointment set","Closed"];
  const form=$("carForm");
  const textFields=["stock","make","model","trim","body","fuel","transmission","engine","color","interior","drivetrain","location","status","condition","vin"];
  const optionalNumbers=["doors","msrp","adminFee"];
  let editing=null,noticeTimer;
  function node(tag,text,cls) {
    const element=document.createElement(tag);
    if(text!=null) element.textContent=text;
    if(cls) element.className=cls;
    return element;
  }
  function notice(text) {
    $("notice").textContent=text;
    clearTimeout(noticeTimer);
    noticeTimer=setTimeout(()=>{$("notice").textContent="";},3500);
  }
  function carName(c) {return [c.year,c.make,c.model].join(" ");}
  function thumb(c) {
    if (!c.image) return node("div","", "thumb");
    const img=node("img",null,"thumb"); img.src=c.image; img.alt=""; img.loading="lazy"; return img;
  }
  function empty(title,body,link=false) {
    const box=node("div",null,"empty");box.append(node("strong",title),node("div",body));
    if(link) { const a=node("a","Open showroom ↗");a.href="index.html";box.append(a); }
    return box;
  }
  function renderLeads(leads,list,filter) {
    list.replaceChildren();
    if(Store.inquiryState()){list.textContent=Store.inquiryState();return;}
    let filtered=leads.filter(l=>!filter || l.status===filter);
    const shared=!!window.postgresInventory;
    if(shared && list.id==="leadList")filtered=LeadWorkspace.filter(filtered);
    if(!filtered.length) {list.append((filter || (shared && list.id==="leadList" && LeadWorkspace.narrowed())) ? empty("No matching inquiries","Change the search or filters to see more inquiries.") : list.id==="pending-inquiries"?empty("All caught up","No inquiries are waiting for first contact."):empty("No shopper inquiries yet","Questions about vehicles, availability requests and trade appraisals appear here."));return;}
    for(const lead of filtered) {
      const row=node("article",null,"lead"),details=node("div",null,"grow");
      const car=lead.car || Store.cars().find(c=>c.id===lead.carId);
      if(car) row.append(thumb(car));
      details.append(node("strong",lead.name));
      if(car) details.append(node("p",carName(car)+" · Stock "+(car.stock || car.id),"vehiclelabel"));
      if(lead.message) details.append(node("p",lead.message));
      for(const [field,label] of [["tradeIn","Trade-in"],["preferences","Specific requests"]]){
        if(lead.notes?.[field])details.append(node("p",label+" — "+lead.notes[field]));
      }
      const contact=node("div",null,"contact");
      if(lead.email){const a=node("a",lead.email);a.href="mailto:"+encodeURIComponent(lead.email);contact.append(a);}
      if(lead.phone){const a=node("a",lead.phone);a.href="tel:"+lead.phone.replace(/[^+\d]/g,"");contact.append(a);}
      if(window.postgresInventory && lead.textReplyRequest?.version===InquiryContact.version){
        const draft=node("button","Text conversation","quiet");
        draft.type="button";draft.onclick=()=>DealerTexts.open(lead,draft);
        details.append(node("small","Text reply requested for this inquiry"),draft);
      }
      details.append(contact,node("small",(lead.source||"Showroom inquiry")+" · "+new Date(lead.createdAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}),"leadtime"));
      if(shared){LeadWorkspace.card(lead,row,details);list.append(row);continue;}
      const status=node("select");status.setAttribute("aria-label","Lead status for "+lead.name);
      for(const val of statuses)status.add(new Option(val,val,false,val===lead.status));
      status.addEventListener("change",async()=>{try{await Store.setStatus(lead.id,status.value);notice("Lead updated");}catch(e){status.value=lead.status;notice(e.message);}});
      row.append(details,status); list.append(row);
    }
  }
  const identities=new Map(),checkedVins=new Set();
  const fieldsForIdentity=["year","make","model"];
  function identityDiff(car,expected){
    const key=v=>String(v??"").trim().toLowerCase().replace(/[^a-z0-9]/g,"");
    return expected && fieldsForIdentity.some(k=>expected[k] && key(car[k])!==key(expected[k]));
  }
  function identityDecision(car,expected){
    return JSON.stringify([car.vin,...fieldsForIdentity.map(k=>String(car[k]??"").trim()),...fieldsForIdentity.map(k=>expected[k])]);
  }
  function editorIdentity(){
    return Object.fromEntries(["vin",...fieldsForIdentity].map(k=>[k,form.elements[k].value.trim()]));
  }
  let reviewSignature="";
  function showReview(){
    const car=editorIdentity(),expected=identities.get(car.vin);
    const mismatch=identityDiff(car,expected);
    $("vin-review").hidden=!mismatch;
    const signature=mismatch?identityDecision(car,expected):"";
    if(signature!==reviewSignature){
      $("keep-identity").checked=Boolean(signature && signature===editing?.vinReviewDecision);
      reviewSignature=signature;
    }
    if(mismatch)$("vin-comparison").textContent="Entered: "+fieldsForIdentity.map(k=>car[k]).join(" ")+" · NHTSA: "+fieldsForIdentity.map(k=>expected[k]).join(" ")+". Check the VIN on the vehicle.";
    return mismatch && !$("keep-identity").checked;
  }
  $("apply-identity").onclick=()=>{
    const expected=identities.get(form.elements.vin.value.trim());if(!expected)return;
    for(const k of fieldsForIdentity)if(expected[k])form.elements[k].value=expected[k];
    showReview();$("formError").textContent="";
  };
  form.addEventListener("input",showReview);
  form.addEventListener("vin:decoded",e=>{identities.set(e.detail.vin,e.detail);showReview();});
  async function loadIdentityFlags(cars){
    const vins=cars.map(c=>c.vin).filter(v=>v && !checkedVins.has(v));
    if(!vins.length)return;
    vins.forEach(v=>checkedVins.add(v));
    const params=new URLSearchParams(vins.map(v=>["vin",v]));
    if(cars.length<=12)params.set("decode","1");
    try{
      const r=await readDealerDesk("/api/inventory-review?"+params,{cache:"no-store"});
      if(!r.ok)throw Error();
      for(const identity of await r.json())identities.set(identity.vin,identity);
      showReview();renderInventory(Store.cars(true));
    }catch{vins.forEach(v=>checkedVins.delete(v));}
  }

  let inventoryPage=0,inventoryQueue="current",deleteTarget=null;
  const pageSize=32;
  function changeQueue(queue){
    inventoryQueue=queue;inventoryPage=0;$("lot-issue").value="";$("lot-age").value="";
    if(queue==="aged")$("lot-sort").value="age";
    renderInventory(Store.cars(true));
  }
  async function setCarAvailability(car,status,button){
    button.disabled=true;
    try{
      const res=await fetch("/api/inventory-status",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({vin:car.vin||car.id,status})});
      if(!res.ok){const reason=await res.json().catch(()=>({}));throw Error(reason.error||"Could not change vehicle availability.");}
      await Store.refreshInventoryStatus();
      notice(status==="sold"?"Vehicle marked sold.":status==="deleted"?"Vehicle deleted.":"Vehicle returned to inventory.");
    }catch(e){notice(e.message);}finally{button.disabled=false;}
  }
  function inventoryCard({car,issues,sold,days}){
    const row=node("article",null,"lot-vehicle"),image=car.image?thumb(car):node("div","No photo","thumb missing-cover"),summary=node("div",null,"lot-summary"),aside=node("div",null,"lot-aside");
    row.dataset.vin=car.vin||car.id;
    const head=node("div",null,"lot-name");
    head.append(node("h3",carName(car)),node("span",sold?"Sold":car.status||"Listed","lot-status"));
    const ids=node("p",null,"lot-ids");
    ids.append(node("span","Stock "+(car.stock||"unassigned")),node("span","VIN "+(car.vin||"unavailable")));
    summary.append(head,ids);
    const facts=[car.trim,car.condition,car.miles!=null && String(car.miles).trim()!==""?fmt.format(car.miles)+" mi":"",car.location].filter(Boolean);
    if(facts.length)summary.append(node("p",facts.join(" · "),"lot-facts"));
    const flags=node("div",null,"lot-flags");
    for(const issue of issues){
      const label=issue==="photo" && car.imageType==="stock"?"Replace representative photo":InventoryWorklist.labels[issue];
      const fix=node("button",label);fix.type="button";fix.onclick=()=>openEditor(car,InventoryWorklist.target[issue]);flags.append(fix);
    }
    const expected=identities.get(car.vin);
    if(identityDiff(car,expected))flags.append(node("span",car.vinReviewDecision===identityDecision(car,expected)?"VIN difference reviewed":"VIN details need review","identity-flag"));
    if(flags.childElementCount)summary.append(flags);
    const price=Number(car.price);
    aside.append(node("strong",Number.isFinite(price)&&price>0?"$"+fmt.format(price):"Contact for price","lot-price"));
    const age=node("span",sold?(car.lotDate?"Arrived "+car.lotDate:"Arrival date unknown"):days===null?"Arrival date unknown":days===0?"Arrived today":days+" day"+(days===1?"":"s")+" on lot","lot-days");
    if(car.lotDate)age.title="Lot arrival "+car.lotDate;aside.append(age);
    const actions=node("div",null,"lot-actions"),edit=node("button","Edit listing","quiet");edit.type="button";edit.onclick=()=>openEditor(car);actions.append(edit);
    if(!sold){const link=node("a","View listing ↗","quiet");link.href="vehicle.html?stock="+encodeURIComponent(car.vin||car.id);link.target="_blank";link.rel="noopener";actions.append(link);}
    if(!window.clientSite||clientSite.bhph){const pricing=node("button",car.bhph?"Edit BHPH":"Enable BHPH","quiet");pricing.type="button";pricing.onclick=()=>BHPH.edit(car);actions.append(pricing);}
    const action=node("button",sold?"Return to inventory":"Mark sold","quiet");action.type="button";action.onclick=()=>setCarAvailability(car,sold?"available":"sold",action);
    const del=node("button","Delete","quiet lot-danger");del.type="button";del.onclick=()=>{
      deleteTarget=car;$("lot-delete-message").textContent=carName(car)+" (stock "+(car.stock||car.vin)+") will be removed from inventory. Existing appointments will be kept.";$("lot-delete").showModal();
    };
    actions.append(action,del);row.append(image,summary,aside,actions);return row;
  }
  $("lot-delete-cancel").onclick=()=>$("lot-delete").close();
  $("lot-delete-confirm").onclick=()=>{const car=deleteTarget;$("lot-delete").close();if(car)setCarAvailability(car,"deleted",$("lot-delete-confirm"));};
  $("lot-delete").onclose=()=>{deleteTarget=null;};
  function renderInventory(cars){
    if($("inventory").hidden)return;
    const state=Store.catalogState(),noticeBox=$("lot-notice"),list=$("inventoryList");
    noticeBox.hidden=state==="ready";
    noticeBox.querySelector("span").textContent=state==="loading"?"Loading dealership inventory…":state;
    $("lot-reload").hidden=state==="loading";
    const today=InventoryWorklist.today(Store.settings().profile?.driveTimezone);
    const rows=InventoryWorklist.records(cars,Store.statusFor,today);
    for(const tab of $("lot-queues").querySelectorAll("[data-queue]")){
      tab.setAttribute("aria-pressed",String(tab.dataset.queue===inventoryQueue));
      tab.querySelector("strong").textContent=state!=="ready"&&!rows.length?"—":fmt.format(rows.filter(InventoryWorklist.queues[tab.dataset.queue]).length);
    }
    $("lot-issue").disabled=inventoryQueue==="sold";
    $("lot-age").disabled=inventoryQueue==="sold" || inventoryQueue==="aged";
    const matches=InventoryWorklist.select(rows,{queue:inventoryQueue,issue:$("lot-issue").value,date:$("lot-age").value,sort:$("lot-sort").value,search:$("inventorySearch").value});
    const pages=Math.ceil(matches.length/pageSize);
    inventoryPage=Math.max(0,Math.min(inventoryPage,pages-1));
    $("invPage").textContent=state!=="ready"&&!rows.length?"":fmt.format(matches.length)+" vehicle"+(matches.length===1?"":"s")+(pages>1?" · Page "+(inventoryPage+1)+" of "+pages:"");
    $("invPrevious").disabled=inventoryPage===0;$("invNext").disabled=inventoryPage+1>=pages;
    const visible=matches.slice(inventoryPage*pageSize,(inventoryPage+1)*pageSize);
    if(!$("inventory").hidden)loadIdentityFlags(visible.map(r=>r.car));
    list.replaceChildren(...visible.map(inventoryCard));
    if(!visible.length && state==="ready"){
      const filtered=$("inventorySearch").value.trim()||$("lot-age").value||$("lot-issue").value;
      const messages={current:["No current vehicles","Add a vehicle to start this lot."],sold:["No sold vehicles","Vehicles marked sold are kept here."],aged:["No vehicles recorded at 60+ days","Days on lot use the arrival date entered on each listing."],attention:["No listing issues found","Current listings passed the photo, price, mileage, and stock checks."]};
      list.append(empty(...(filtered?["No matching vehicles","Try a different search or filter."]:messages[inventoryQueue])));
    }
  }
  $("lot-queues").onclick=event=>{const tab=event.target.closest("[data-queue]");if(tab)changeQueue(tab.dataset.queue);};
  $("lot-reload").onclick=()=>Store.reloadCatalog();
  $("inventorySearch").oninput=()=>{inventoryPage=0;renderInventory(Store.cars(true));};
  for(const id of ["lot-issue","lot-age","lot-sort"])$(id).onchange=()=>{inventoryPage=0;renderInventory(Store.cars(true));};
  $("invNext").onclick=()=>{inventoryPage++;renderInventory(Store.cars(true));};
  $("invPrevious").onclick=()=>{inventoryPage--;renderInventory(Store.cars(true));};
  let logoSignature="";
  function refreshLogo(profile){
    const sources=[profile.logo,profile.logoLightBackground].filter(Boolean);
    const signature=JSON.stringify(sources);
    if(logoSignature===signature)return;
    logoSignature=signature;
    const img=$("desk-logo");
    img.hidden=true;
    function load(index){
      if(signature!==logoSignature)return;
      if(!sources[index]){img.hidden=true;img.removeAttribute("src");return;}
      img.classList.toggle("light-logo",sources[index]!==profile.logo);
      img.onload=()=>{if(signature===logoSignature)img.hidden=false;};
      img.onerror=()=>load(index+1);
      img.src=sources[index];
    }
    load(0);
  }
  function refresh() {
    const selected=DealerSitePages.templateKey(Store.settings().profile?.siteTemplate);
    $("desk-template").textContent=DealerSitePages.templates[selected].label;
    const settings=Store.settings(),profile=settings.profile||{},pages=DealerPages.list().filter(p=>p.enabled);
    const checks=[
      ["Brand identity",!!profile.logo && !!profile.logoLightBackground,"Upload both logo variants in Store settings."],
      ["Sales contact",!!(DealerLocation.dial(profile.salesPhone) && profile.street && profile.city),"Enter the sales number and showroom address."],
      ["Published hours",!!profile.salesHours,"Publish the sales department’s opening hours."],
      ["Live inventory",Store.cars().length>0,"Publish an available vehicle."],
    ];
    if(selected==="franchise"){
      checks.push(["Offer disclosures",pages.some(p=>p.key==="disclosures"),"Publish the dealer’s approved advertising disclosures in Website pages."],
        ["Service destination",pages.some(p=>p.key==="schedule-service" && p.url),"Connect and enable the service scheduler."],
        ["New inventory",Store.cars().some(c=>String(c.condition).toLowerCase()==="new"),"Publish an eligible new vehicle."]);
    }else if(selected==="bhph"){
      checks.push(["Payment schedules",Store.cars().some(c=>c.bhph?.schedules?.length),"Enable BHPH on a vehicle and save an installment schedule."]);
    }
    $("template-check-count").textContent=checks.filter(c=>c[1]).length+" of "+checks.length+" storefront checks complete";
    $("template-check-list").replaceChildren(...checks.map(([label,ok,hint])=>{
      const row=node("li");row.append(node("strong",label),node("span",ok?"Ready":hint));row.dataset.ready=String(ok);return row;
    }));
    const cars=Store.cars(),leads=Store.leads(),name=Store.settings().dealerName;
    refreshLogo(Store.settings().profile||{});
    $("brand").textContent=name;document.title="Sales desk · "+name;
    $("countCars").textContent=cars.length;
    $("countNew").textContent=Store.inquiryState()?"—":leads.filter(l=>l.status==="New").length;
    if(window.postgresInventory)LeadWorkspace.today(leads);
    renderLeads(leads,$("leadList"),$("statusFilter").value);
    renderLeads(leads.filter(l=>l.status==="New").sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),$("pending-inquiries"),"");renderInventory(Store.cars(true));
  }
  function paymentMode(settings){
    if(settings?.financingEnabled===false)return "cash";
    return settings?.aprFinancingEnabled===false?"bhph":"apr";
  }
  function paymentFlags(mode){
    return {financingEnabled:mode!=="cash",aprFinancingEnabled:mode==="apr"};
  }
  function openEditor(car=null,focusField="") {
    $("saveWithBhph").hidden=!!window.clientSite && !clientSite.bhph;
    editing=car;form.reset();form.elements.vehicleFinancing.value=paymentMode(car);$("formError").textContent="";$("editTitle").textContent=car?"Edit vehicle":"Add vehicle";
    form.querySelector(".editor-details").open=false;
    form.elements.lotDate.value=car?.lotDate||"";
    form.elements.lotDate.max=InventoryWorklist.today(Store.settings().profile?.driveTimezone);
    form.elements.vin.readOnly=!!car && !!window.postgresInventory;
    for(const field of ['stock','price','miles'])form.elements[field].required=!car || car[field]!=null && car[field]!=="";
    if(car)for(const key of ['status','condition','body']){
      const field=form.elements[key],value=car[key];
      if(value && !Array.from(field.options).some(o=>o.value===value))field.add(new Option(value,value));
    }
    if(car) for(const key of [...textFields,...optionalNumbers,"year","price","miles"])form.elements[key].value=car[key] ?? "";
    if(car) form.elements.features.value=(car.features || []).join("\n");
    galleryGeneration++;
    photoBusy=false;
    photos=[...new Set([car?.image,...(car?.photos||[])].filter(Boolean))];
    $("gallery-status").textContent="";renderPhotos();
    if(car?.galleryPath && !car.galleryEdited)loadImported(car,galleryGeneration);
    StickerIntake.restore(car);
    reviewSignature="";showReview();
    $("editor").showModal();
    if(focusField)form.elements[focusField]?.focus();
  }
  let photos=[],photoBusy=false,galleryGeneration=0;
  function renderPhotos(){
    const list=$("gallery-editor");list.replaceChildren();
    photos.forEach((url,index)=>{
      const row=node("li"),preview=node("img");
      preview.src=url;preview.alt="";preview.width=88;preview.height=64;preview.style.objectFit="cover";
      row.append(preview,node("span",index===0?"Cover":"Photo "+(index+1)));
      for(const [label,offset] of [["Earlier",-1],["Later",1],["Remove",0]]){
        const button=node("button",label);button.type="button";button.disabled=photoBusy || (offset!==0 && !photos[index+offset]);
        button.onclick=()=>{photos.splice(index,1);if(offset)photos.splice(index+offset,0,url);renderPhotos()};row.append(button);
      }
      list.append(row);
    });
    form.elements.photo.disabled=photoBusy;$("add-photo-url").disabled=photoBusy;
    for(const button of form.querySelectorAll('[type="submit"]'))button.disabled=photoBusy;
  }
  async function loadImported(car,gen){
    photoBusy=true;renderPhotos();
    try{const r=await fetch(car.galleryPath);if(!r.ok)throw Error();const rows=await r.json();
      if(gen===galleryGeneration)photos=[...new Set([...photos,...(rows[car.vin]||[])])];
    }catch{if(gen===galleryGeneration)$("gallery-status").textContent="Imported photos could not load. Reopen the editor to retry.";}
    finally{if(gen===galleryGeneration){photoBusy=false;renderPhotos()}}
  }
  function addPhotoUrl(){
    const field=form.elements.image,url=field.value.trim();if(!url)return;
    if(new URL(url).protocol!=="https:")throw Error("Enter an HTTPS photo URL.");
    if(!photos.includes(url))photos.push(url);field.value="";renderPhotos();
  }
  $("add-photo-url").onclick=()=>{try{addPhotoUrl()}catch(e){$("gallery-status").textContent=e.message}};
  form.elements.photo.onchange=async()=>{
    const gen=galleryGeneration,files=Array.from(form.elements.photo.files);photoBusy=true;renderPhotos();
    try{for(const [i,file] of files.entries()){
      if(gen!==galleryGeneration)return;
      $("gallery-status").textContent="Uploading photo "+(i+1)+" of "+files.length+"…";
      const blob=await photoData(file);
      const r=await fetch("/api/vehicle-photos",{method:"POST",headers:{"Content-Type":"image/jpeg"},body:blob});
      if(!r.ok)throw Error("Could not upload "+file.name+". Choose the file to retry.");
      const {url}=await r.json();if(gen!==galleryGeneration)return;if(!photos.includes(url))photos.push(url);
    }$("gallery-status").textContent="Photos ready. Save the vehicle to publish this order."}
    catch(e){if(gen===galleryGeneration)$("gallery-status").textContent=e.message}
    finally{if(gen===galleryGeneration){photoBusy=false;form.elements.photo.value="";renderPhotos()}}
  };
  async function photoData(file) {
    if(!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size>16*1024*1024)throw Error("Choose a JPEG, PNG, or WebP under 16 MB.");
    const pic=await createImageBitmap(file);
    try {
      const canvas=document.createElement("canvas"),scale=Math.min(1,1000/pic.width,800/pic.height);
      canvas.width=Math.max(1,Math.round(pic.width*scale));canvas.height=Math.max(1,Math.round(pic.height*scale));
      canvas.getContext("2d").drawImage(pic,0,0,canvas.width,canvas.height);return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error("Could not convert photo.")),"image/jpeg",0.82));
    } finally { pic.close(); }
  }
  form.addEventListener("submit",async e=>{
    e.preventDefault(); if(form.dataset.saving)return;form.dataset.saving="1"; const save=e.submitter||form.querySelector('[type="submit"]');save.disabled=true;$("formError").textContent="";
    try {
      const f=new FormData(form),car={};
      for(const key of textFields) car[key]=String(f.get(key)||"").trim();
      Object.assign(car,paymentFlags(form.elements.vehicleFinancing.value));
      car.vin=car.vin.replace(/\s+/g,"").toUpperCase();
      if(window.clientSite && !/^[A-HJ-NPR-Z0-9]{17}$/.test(car.vin))throw Error("Enter a 17-character VIN. VINs use letters and numbers and exclude I, O and Q.");
      car.vpicDetails=window.vpicDetailsFor?.(car.vin)??(editing?.vin===car.vin?editing.vpicDetails:undefined);
      if(showReview()){$("vin-review").scrollIntoView({block:"center"});throw Error("Review the VIN difference before saving.");}
      if($("keep-identity").checked && reviewSignature)car.vinReviewDecision=reviewSignature;
      car.factorySticker=StickerIntake.recordFor(car.vin);
      for(const key of optionalNumbers) car[key]=f.get(key)==="" ? null : Number(f.get(key));
      car.features=[...new Set(String(f.get("features") || "").split(/\r?\n/).map(item=>item.trim()).filter(Boolean))];
      if((!car.stock && (!editing || editing.stock)) || !car.make || !car.model)throw Error("Enter a stock number, make and model.");
      for(const key of ["year","price","miles"])car[key]=f.get(key)===""?null:Number(f.get(key));
      if(Store.statusFor(editing?.id)!=="sold" && String(editing?.stock||"").trim().toLowerCase()!==car.stock.toLowerCase() &&
        Store.cars().some(c=>c.id!==editing?.id && String(c.stock||"").trim().toLowerCase()===car.stock.toLowerCase()))throw Error("This stock number is already in use.");
      car.id=editing?.id || crypto.randomUUID();car.featured=editing?.featured || false;
      if(photoBusy)throw Error("Wait for photo uploads to finish.");
      addPhotoUrl();car.photos=[...photos];car.image=photos[0]||"";car.galleryEdited=true;
      if(editing?.imageType==="stock" && car.image && car.image!==editing.image)car.imageType="dealer";
      if(!car.image && !editing)throw Error("Add a photo URL or upload a photo to publish this vehicle.");
      const lotDate=f.get("lotDate")||null,previousLotDate=editing?.lotDate||null;
      const desk={inventoryIntent:editing?"edit":"add",...(lotDate!==previousLotDate?{lotDate,previousLotDate}:{})};
      await Store.saveCar(car,desk);refresh();$("editor").close();notice("Vehicle saved to showroom");
      if(save.id==="saveWithBhph")await BHPH.edit(car);
    }catch(err){if(err.identity){identities.set(err.identity.vin,err.identity);showReview();$("vin-review").scrollIntoView({block:"center"});}$("formError").textContent=err.name==="QuotaExceededError"?"Photo storage is full. Try a hosted photo URL.":err.message;}
    finally{delete form.dataset.saving;save.disabled=false;}
  });
  const tabs=Array.from(document.querySelectorAll("nav [data-view]"));
  function selectTab(key){
    if(!tabs.some(btn=>btn.dataset.view===key))key="today";
    for(const btn of tabs){
      const active=btn.dataset.view===key;
      $(btn.dataset.view).hidden=!active;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-pressed",String(active));
    }
    if(key==="conversations")ConversationDesk.load();
    if(key==="inventory")renderInventory(Store.cars(true));
    if(key==="inquiries" || key==="today")Store.loadLeads();
    if(["banners","pages","voice","oem"].includes(key))$("setup-menu").open=true;
  }
  tabs.forEach(btn=>btn.addEventListener("click",()=>{
    selectTab(btn.dataset.view);
    history.replaceState(null,"","#"+btn.dataset.view);
  }));
  // Trigger the normal loaders for bookmarked workspace tabs after their scripts initialize.
  window.addEventListener("DOMContentLoaded",()=>tabs.find(btn=>"#"+btn.dataset.view===location.hash)?.click());
  $("statusFilter").addEventListener("change",()=>renderLeads(Store.leads(),$("leadList"),$("statusFilter").value));
  $("addCar").addEventListener("click",()=>openEditor());
  const profileFields=["salesPhone","partsPhone","servicePhone","street","city","region","postal","country","googleStoreCode"];
  const socialFields=["facebook","instagram","youtube","tiktok","x","linkedin"];
  const profileForm=$("settingsForm"),profileInputs=profileForm.elements;

  function httpsUrl(value,label){
    if(!value)return "";
    let parsed;
    try {parsed=new URL(value);}catch{throw Error("Enter a valid HTTPS URL for "+label+".");}
    if(parsed.protocol!=="https:" || parsed.username || parsed.password)throw Error("Enter an HTTPS URL for "+label+" without embedded credentials.");
    return parsed.href;
  }
  function logoControl(previewImage,fileInput,urlInput,clear,status){
  let logoDraft="",logoVersion=0,logoLoading=false,logoError="";
  function displayLogo(value){
    const preview=previewImage;
    preview.hidden=!value;
    if(value)preview.src=value;else preview.removeAttribute("src");
    clear.disabled=!value && !urlInput.value && !fileInput.files.length;
  }
  previewImage.onerror=()=>{
    previewImage.hidden=true;
    status.textContent="The preview could not load. Check the logo URL or upload an image.";
  };
  function resetLogo(){
    logoVersion++;logoDraft="";logoLoading=false;logoError="";
    fileInput.value=urlInput.value="";
    status.textContent="";
    displayLogo("");
  }
  clear.onclick=resetLogo;
  urlInput.oninput=()=>{
    logoVersion++;logoLoading=false;logoError="";logoDraft="";fileInput.value="";
    try{logoDraft=httpsUrl(urlInput.value.trim(),"the logo");}catch{}
    status.textContent="";displayLogo(logoDraft);
  };
  fileInput.onchange=async()=>{
    const file=fileInput.files[0];
    if(!file)return;
    const revision=++logoVersion;
    logoLoading=true;logoError="";
    status.textContent="Preparing logo…";
    try{
      if(!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size>12*1024*1024)throw Error("Choose a PNG, JPEG, or WebP logo under 12 MB.");
      const img=await createImageBitmap(file);
      try{
        if(revision!==logoVersion)return;
        const scale=Math.min(1,480/img.width,320/img.height),canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(img.width*scale));
        canvas.height=Math.max(1,Math.round(img.height*scale));
        canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
        const encoded=canvas.toDataURL("image/webp",0.86);
        if(encoded.length>600000)throw Error("Use a smaller logo file.");
        logoDraft=encoded;urlInput.value="";
        status.textContent="";displayLogo(logoDraft);
      }finally{img.close();}
    }catch(err){if(revision===logoVersion){logoError=err.message||"Could not read that logo."; status.textContent=logoError;}}
    finally{if(revision===logoVersion)logoLoading=false;}
  };
    return {
      load(value){resetLogo();logoDraft=value||"";if(logoDraft.startsWith("https://"))urlInput.value=logoDraft;displayLogo(logoDraft);},
      value(){if(logoLoading)throw Error("The logo is still processing.");if(logoError)throw Error(logoError);return urlInput.value.trim()?httpsUrl(urlInput.value.trim(),"the logo"):logoDraft;}
    };
  }
  const darkLogo=logoControl($("logoPreview"),profileInputs.logoFile,profileInputs.logoUrl,$("clearLogo"),$("logoStatus"));
  const lightLogo=logoControl($("lightLogoPreview"),profileInputs.lightLogoFile,profileInputs.lightLogoUrl,$("clearLightLogo"),$("lightLogoStatus"));
  function fillHours(hours,ranges){
    hours.replaceChildren();
    for(const day of ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]){
      const range=ranges?ranges[day]:["Sat","Sun"].includes(day)?null:["10:00","17:00"];
      const row=node("div");row.dataset.day=day;
      const label=node("label"),box=node("input");box.type="checkbox";box.checked=!!range;label.append(box,day);row.append(label);
      for(const [index,title] of ["Opens","Closes"].entries()){
        const time=node("input");time.type="time";time.required=true;time.disabled=!range;time.value=(range||["10:00","17:00"])[index];time.setAttribute("aria-label",day+" "+title);row.append(time);
      }
      box.onchange=()=>row.querySelectorAll("input[type=time]").forEach(t=>t.disabled=!box.checked);hours.append(row);
    }
  }
  async function openSettings() {
    try{await Store.profileReady;}catch{notice("Could not load the saved dealership profile.");return;}
    const settings=Store.settings(), fields=$("settingsForm").elements;
    fields.name.value=settings.dealerName;fields.skin.value=settings.profile?.skin || "midnight";
    fields.siteTemplate.value=DealerSitePages.templateKey(settings.profile?.siteTemplate);
    const explain=()=>{$("template-description").textContent={
      classic:"Featured vehicles and searchable showroom rows.",
      franchise:"Department navigation, new and certified inventory, and space for approved OEM assets and disclosures.",
      independent:"An inventory-first layout with pre-owned vehicles and budget-based shopping.",
      bhph:"Vehicle-level cash down and payment schedules appear when the dealer has published an eligible offer."
    }[fields.siteTemplate.value];};
    fields.siteTemplate.onchange=explain;explain();
    fields.tradeUrl.value=settings.tradeUrl;
    fields.storeFinancing.value=paymentMode(settings.options);
    const profile=settings.profile||{};
    const zone=$("drive-zone");zone.replaceChildren(...["America/New_York","America/Chicago","America/Denver","America/Phoenix","America/Los_Angeles","America/Anchorage","Pacific/Honolulu"].map(z=>new Option(z.replaceAll("_"," "),z)));zone.value=profile.driveTimezone||"America/Chicago";
    fillHours($("drive-hours"),profile.driveHours);
    for (const key of ["sales","service","parts"]) {
      const grid=$(key+"-hours"), toggle=$("publish-"+key+"-hours");
      fillHours(grid,profile[key+"Hours"] || {});
      toggle.checked=Boolean(profile[key+"Hours"]);
      toggle.onchange=()=>{
        grid.hidden=!toggle.checked;
        for (const row of grid.children) {
          const active=row.querySelector("input[type=checkbox]").checked;
          for (const time of row.querySelectorAll("input[type=time]")) time.disabled=!toggle.checked || !active;
        }
      };
      toggle.onchange();
    }
    for(const key of [...profileFields,...socialFields])fields[key].value=profile[key]||"";
    darkLogo.load(profile.logo);lightLogo.load(profile.logoLightBackground);
    const groups=$("shopOptions");
    groups.replaceChildren();
    for(const [heading,options] of Object.entries(Store.optionGroups)) {
      const section=node("fieldset"), choices=node("div",null,"option-grid");
      section.append(node("legend",heading),choices);
      for(const [key,label] of Object.entries(options)) {
        const choice=node("label",null,"choice"),box=node("input");
        box.type="checkbox";box.name="option-"+key;box.checked=settings.options[key];
        choice.append(box,document.createTextNode(label));choices.append(choice);
      }
      groups.append(section);
    }
    function syncAprTools(){
      for(const key of ["finance","lease","payment"])fields.namedItem("option-"+key).disabled=fields.storeFinancing.value!=="apr";
    }
    fields.storeFinancing.onchange=syncAprTools;
    syncAprTools();
    $("settingsError").textContent="";$("settings").showModal();
    $("settings").scrollTop=0;
  }
  $("brandSettings").addEventListener("click",openSettings);
  $("settingsForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const fields=e.target.elements, dealerName=fields.name.value.trim(),tradeUrl=fields.tradeUrl.value.trim();
    if(!dealerName){$("settingsError").textContent="Enter your dealership name.";return;}
    try {
      if(tradeUrl) {
        const parsed=new URL(tradeUrl);
        if(parsed.protocol!=="https:" || parsed.username || parsed.password) throw Error("Enter an HTTPS provider URL without embedded credentials.");
      }
      const options=paymentFlags(fields.storeFinancing.value);
      for(const input of e.target.querySelectorAll('[name^="option-"]')) options[input.name.slice(7)]=input.checked;
      const profile={...Store.settings().profile,siteTemplate:fields.siteTemplate.value,skin:fields.skin.value,logo:darkLogo.value(),logoLightBackground:lightLogo.value()};
      profile.driveTimezone=$("drive-zone").value;
      const readHours=id=>Object.fromEntries(Array.from($(id).children,row=>[row.dataset.day,row.querySelector("input").checked?Array.from(row.querySelectorAll("input[type=time]"),t=>t.value):null]));
      profile.driveHours=readHours("drive-hours");
      for (const key of ["sales","service","parts"]) profile[key+"Hours"]=$("publish-"+key+"-hours").checked?readHours(key+"-hours"):null;
      for(const key of profileFields)profile[key]=fields[key].value.trim();
      for(const key of socialFields)profile[key]=httpsUrl(fields[key].value.trim(),key);
      await Store.saveSettings({dealerName,tradeUrl,options,profile});
      refresh();$("settings").close();notice("Store settings saved");
    } catch(err){$("settingsError").textContent=err.message;}
  });
  document.querySelectorAll(".close").forEach(btn=>btn.addEventListener("click",()=>btn.closest("dialog").close()));
  window.addEventListener("showroom:update",refresh);
  refresh();
})();
