(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const fmt = new Intl.NumberFormat("en-US");
  const statuses=["New","Contacted","Appointment set","Closed"];
  const form=$("carForm");
  const textFields=["stock","make","model","trim","body","fuel","transmission","engine","color","location","status","condition","vin"];
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
    const img=node("img"); img.src=c.image; img.alt=""; img.loading="lazy"; return img;
  }
  function empty(title,body,link=false) {
    const box=node("div",null,"empty");box.append(node("strong",title),node("div",body));
    if(link) { const a=node("a","Open showroom ↗");a.href="index.html";box.append(a); }
    return box;
  }
  function renderLeads(leads) {
    const list=$("leadList"),filter=$("statusFilter").value;
    list.replaceChildren();
    const filtered=leads.filter(l=>!filter || l.status===filter);
    if(!filtered.length) {list.append(filter ? empty("No matching inquiries","Choose another status to see more leads.") : empty("Your first inquiry will appear here","Open a car in the showroom and send an inquiry to try the shopper-to-lead flow.",true));return;}
    for(const lead of filtered) {
      const row=node("article",null,"lead"),details=node("div",null,"grow");
      const car=lead.car || Store.cars().find(c=>c.id===lead.carId);
      if(car) row.append(thumb(car));
      details.append(node("strong",lead.name));
      if(car) details.append(node("p",carName(car)+" · Stock "+(car.stock || car.id),"vehiclelabel"));
      if(lead.message) details.append(node("p",lead.message));
      const contact=node("div",null,"contact");
      if(lead.email){const a=node("a",lead.email);a.href="mailto:"+encodeURIComponent(lead.email);contact.append(a);}
      if(lead.phone){const a=node("a",lead.phone);a.href="tel:"+lead.phone.replace(/[^+\d]/g,"");contact.append(a);}
      details.append(contact,node("small",(lead.source||"Showroom inquiry")+" · "+new Date(lead.createdAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}),"leadtime"));
      const status=node("select");status.setAttribute("aria-label","Lead status for "+lead.name);
      for(const val of statuses)status.add(new Option(val,val,false,val===lead.status));
      status.addEventListener("change",async()=>{try{await Store.setStatus(lead.id,status.value);notice("Lead updated");}catch(e){status.value=lead.status;notice(e.message);}});
      row.append(details,status); list.append(row);
    }
  }
  let inventoryPage=0;
  const pageSize=32;
  function renderInventory(cars) {
    const needle=$("inventorySearch").value.trim().toLowerCase();
    const matches=needle?cars.filter(c=>[carName(c),c.vin,c.stock,c.trim,c.location].join(' ').toLowerCase().includes(needle)):cars;
    const pages=Math.ceil(matches.length/pageSize);
    inventoryPage=Math.max(0,Math.min(inventoryPage,pages-1));
    $("invPage").textContent=matches.length.toLocaleString()+' vehicles'+(pages?' · Page '+(inventoryPage+1)+' of '+pages:'');
    $("invPrevious").disabled=inventoryPage===0;
    $("invNext").disabled=inventoryPage+1>=pages;
    const list=$("inventoryList");list.replaceChildren();
    for (const car of matches.slice(inventoryPage*pageSize,(inventoryPage+1)*pageSize)) {
      const row=node("article",null,"vehicle"),group=node("div",null,"grow");
      group.append(node("strong",carName(car)),node("small",[car.trim,car.stock || car.id,car.miles!=null?fmt.format(car.miles)+" mi":""].filter(Boolean).join(" · ")));
      const edit=node("button","Edit","quiet");edit.addEventListener("click",()=>openEditor(car));
      row.append(thumb(car),group,node("span",car.price==null?"Contact for price":"$"+fmt.format(car.price),"price"),edit);list.append(row);
    }
    if(cars.length && !matches.length)list.append(empty("No matching vehicles","Try a different VIN, stock number, make, or model."));
    if(!cars.length)list.append(empty("Your inventory is ready to fill","Add a vehicle with its stock number, photo and price."));
  }
  $("inventorySearch").oninput=()=>{inventoryPage=0;renderInventory(Store.cars());};
  $("invNext").onclick=()=>{inventoryPage++;renderInventory(Store.cars());};
  $("invPrevious").onclick=()=>{inventoryPage--;renderInventory(Store.cars());};
  function refresh() {
    const cars=Store.cars(),leads=Store.leads(),name=Store.settings().dealerName;
    $("brand").textContent=name;document.title="Sales desk · "+name;
    $("countCars").textContent=cars.length;$("countLeads").textContent=leads.length;
    $("countNew").textContent=leads.filter(l=>l.status==="New").length;
    renderLeads(leads);renderInventory(cars);
  }
  function openEditor(car=null) {
    editing=car;form.reset();$("formError").textContent="";$("editTitle").textContent=car?"Edit vehicle":"Add vehicle";
    form.querySelector(".editor-details").open=false;
    for(const field of ['stock','price','miles'])form.elements[field].required=!car || car[field]!=null && car[field]!=="";
    if(car)for(const key of ['status','condition','body']){
      const field=form.elements[key],value=car[key];
      if(value && !Array.from(field.options).some(o=>o.value===value))field.add(new Option(value,value));
    }
    if(car) for(const key of [...textFields,...optionalNumbers,"year","price","miles"])form.elements[key].value=car[key] ?? "";
    if(car) form.elements.features.value=(car.features || []).join("\n");
    if(car?.image?.startsWith("https://"))form.elements.image.value=car.image;
    StickerIntake.restore(car);
    $("editor").showModal();
  }
  async function photoData(file) {
    if(!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size>16*1024*1024)throw Error("Choose a JPEG, PNG, or WebP under 16 MB.");
    const pic=await createImageBitmap(file);
    try {
      const canvas=document.createElement("canvas"),scale=Math.min(1,1000/pic.width,800/pic.height);
      canvas.width=Math.max(1,Math.round(pic.width*scale));canvas.height=Math.max(1,Math.round(pic.height*scale));
      canvas.getContext("2d").drawImage(pic,0,0,canvas.width,canvas.height);return canvas.toDataURL("image/jpeg",0.78);
    } finally { pic.close(); }
  }
  form.addEventListener("submit",async e=>{
    e.preventDefault(); const save=e.submitter;save.disabled=true;$("formError").textContent="";
    try {
      const f=new FormData(form),car={};
      for(const key of textFields) car[key]=String(f.get(key)||"").trim();
      car.vin=car.vin.toUpperCase();
      car.factorySticker=StickerIntake.recordFor(car.vin);
      for(const key of optionalNumbers) car[key]=f.get(key)==="" ? null : Number(f.get(key));
      car.features=[...new Set(String(f.get("features") || "").split(/\r?\n/).map(item=>item.trim()).filter(Boolean))];
      if((!car.stock && (!editing || editing.stock)) || !car.make || !car.model)throw Error("Enter a stock number, make and model.");
      for(const key of ["year","price","miles"])car[key]=f.get(key)===""?null:Number(f.get(key));
      if(Store.cars().some(c=>c.id!==editing?.id && String(c.stock||c.id).toLowerCase()===car.stock.toLowerCase()))throw Error("This stock number is already in use.");
      car.id=editing?.id || crypto.randomUUID();car.featured=editing?.featured || false;
      const file=f.get("photo"),url=String(f.get("image")||"").trim();
      if(url && new URL(url).protocol!=="https:")throw Error("Enter an HTTPS photo URL.");
      car.image=file?.size ? await photoData(file) : url || editing?.image || "";
      if(!car.image && !editing)throw Error("Add a photo URL or upload a photo to publish this vehicle.");
      await Store.saveCar(car);refresh();$("editor").close();notice("Vehicle saved to showroom");
    }catch(err){$("formError").textContent=err.name==="QuotaExceededError"?"Photo storage is full. Try a hosted photo URL.":err.message;}
    finally{save.disabled=false;}
  });
  document.querySelectorAll("[data-view]").forEach(btn=>btn.addEventListener("click",()=>{
    for(const section of ["leads","inventory","pages"])$(section).hidden=section!==btn.dataset.view;
    document.querySelectorAll("[data-view]").forEach(b=>{const active=b===btn;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));});
  }));
  $("statusFilter").addEventListener("change",()=>renderLeads(Store.leads()));
  $("addCar").addEventListener("click",()=>openEditor());
  const profileFields=["salesPhone","partsPhone","servicePhone","street","city","region","postal","country"];
  const socialFields=["facebook","instagram","youtube","tiktok","x","linkedin"];
  const profileForm=$("settingsForm"),profileInputs=profileForm.elements;
  let logoDraft="",logoVersion=0,logoLoading=false,logoError="";
  function httpsUrl(value,label){
    if(!value)return "";
    let parsed;
    try {parsed=new URL(value);}catch{throw Error("Enter a valid HTTPS URL for "+label+".");}
    if(parsed.protocol!=="https:" || parsed.username || parsed.password)throw Error("Enter an HTTPS URL for "+label+" without embedded credentials.");
    return parsed.href;
  }
  function displayLogo(value){
    const preview=$("logoPreview");
    preview.hidden=!value;
    if(value)preview.src=value;else preview.removeAttribute("src");
    $("clearLogo").disabled=!value && !profileInputs.logoUrl.value && !profileInputs.logoFile.files.length;
  }
  $("logoPreview").onerror=()=>{
    $("logoPreview").hidden=true;
    $("logoStatus").textContent="The preview could not load. Check the logo URL or upload an image.";
  };
  function resetLogo(){
    logoVersion++;logoDraft="";logoLoading=false;logoError="";
    profileInputs.logoFile.value=profileInputs.logoUrl.value="";
    $("logoStatus").textContent="";
    displayLogo("");
  }
  $("clearLogo").onclick=resetLogo;
  profileInputs.logoUrl.oninput=()=>{
    logoVersion++;logoLoading=false;logoError="";logoDraft="";profileInputs.logoFile.value="";
    try{logoDraft=httpsUrl(profileInputs.logoUrl.value.trim(),"the logo");}catch{}
    $("logoStatus").textContent="";displayLogo(logoDraft);
  };
  profileInputs.logoFile.onchange=async()=>{
    const file=profileInputs.logoFile.files[0];
    if(!file)return;
    const revision=++logoVersion;
    logoLoading=true;logoError="";
    $("logoStatus").textContent="Preparing logo…";
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
        logoDraft=encoded;profileInputs.logoUrl.value="";
        $("logoStatus").textContent="";displayLogo(logoDraft);
      }finally{img.close();}
    }catch(err){if(revision===logoVersion){logoError=err.message||"Could not read that logo."; $("logoStatus").textContent=logoError;}}
    finally{if(revision===logoVersion)logoLoading=false;}
  };
  async function openSettings() {
    try{await Store.profileReady;}catch{notice("Could not load the saved dealership profile.");return;}
    const settings=Store.settings(), fields=$("settingsForm").elements;
    fields.name.value=settings.dealerName;fields.skin.value=settings.profile?.skin || "midnight";
    fields.tradeUrl.value=settings.tradeUrl;
    const profile=settings.profile||{};
    for(const key of [...profileFields,...socialFields])fields[key].value=profile[key]||"";
    resetLogo();logoDraft=profile.logo||"";
    if(logoDraft.startsWith("https://"))fields.logoUrl.value=logoDraft;
    displayLogo(logoDraft);
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
      const options={};
      for(const input of e.target.querySelectorAll('[name^="option-"]')) options[input.name.slice(7)]=input.checked;
      if(logoLoading)throw Error("The logo is still processing. Save again in a moment.");
      if(logoError)throw Error(logoError);
      const profile={...Store.settings().profile,skin:fields.skin.value,logo:fields.logoUrl.value.trim()?httpsUrl(fields.logoUrl.value.trim(),"the logo"):logoDraft};
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
