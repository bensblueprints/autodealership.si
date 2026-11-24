(() => {
  "use strict";
  const get=id=>document.getElementById(id);
  const id=new URLSearchParams(location.search).get("stock");
  const car=Store.cars().find(record=>String(record.id)===id);
  const settings=Store.settings();
  const enabled=key=>settings.options?.[key]!==false;
  const exists=value=>value!==null && value!==undefined && value!=="";
  const money=value=>!exists(value)?"Contact for price":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(value);
  const makeNode=(tag,value)=>{
    const node=document.createElement(tag);
    if(exists(value))node.textContent=value;
    return node;
  };
  function describe(container,pairs) {
    container.replaceChildren();
    for(const [label,value] of pairs){
      if(!exists(value))continue;
      const row=makeNode("div");row.append(makeNode("dt",label),makeNode("dd",value));container.append(row);
    }
  }
  get("brandname").textContent=settings.dealerName || "Showroom";
  if(!car){get("unavailable").hidden=false;return;}
  const title=[car.year,car.make,car.model].filter(Boolean).join(" ");
  const sticker=car.vin && car.factorySticker?.vin===car.vin ? car.factorySticker : null;
  document.title=title+" · "+get("brandname").textContent;
  get("listing").hidden=false;
  get("overline").textContent=[car.condition,car.body,car.status].filter(Boolean).join(" · ");
  get("title").textContent=[car.make,car.model].join(" ");
  get("trim").textContent=[car.year,car.trim].filter(Boolean).join(" · ");
  get("identity").textContent=[car.stock?"Stock #"+car.stock:null,car.location].filter(Boolean).join(" · ");
  if(car.imageType==="stock")get("photo").append(makeNode("figcaption","Representative manufacturer photos for this listing"));
  const gallery=[...new Set([car.image,...(Array.isArray(car.photos)?car.photos:[])].filter(url=>typeof url==="string" && url.trim()))];
  const image=get("vehicle-photo"),box=get("photo-view"),large=get("lightbox-photo");
  const controls=document.querySelectorAll(".photo-controls");
  let position=0;
  function drawPhoto(){
    const url=gallery[position];
    image.hidden=!url;get("photoMissing").hidden=Boolean(url);get("enlarge").hidden=!url;
    controls.forEach(group=>{
      group.hidden=gallery.length<2;
      group.querySelector("span").textContent=url?(position+1)+" / "+gallery.length:"";
    });
    if(!url){image.removeAttribute("src");large.removeAttribute("src");if(box.open)box.close();return;}
    image.alt=title+" · photo "+(position+1);
    const failed=()=>{
      if(gallery[position]!==url)return;
      gallery.splice(position,1);
      position=Math.min(position,Math.max(0,gallery.length-1));
      drawPhoto();
    };
    image.onerror=failed;image.src=url;
    if(box.open){large.onerror=failed;large.alt=image.alt;large.src=url;}
  }
  function stepPhoto(offset){
    if(gallery.length<2)return;
    position=(position+gallery.length+offset)%gallery.length;drawPhoto();
  }
  controls.forEach(group=>group.querySelectorAll("[data-move]").forEach(button=>{
    button.onclick=()=>stepPhoto(Number(button.dataset.move));
  }));
  get("enlarge").onclick=()=>{if(gallery.length){box.showModal();drawPhoto();}};
  box.addEventListener("keydown",event=>{
    if(event.key==="ArrowLeft"||event.key==="ArrowRight"){
      event.preventDefault();stepPhoto(event.key==="ArrowLeft"?-1:1);
    }
  });
  for(const surface of [image,large]){
    let start=null;
    surface.addEventListener("touchstart",event=>{
      start=event.touches.length===1?event.touches[0]:null;
    },{passive:true});
    surface.addEventListener("touchend",event=>{
      if(!start)return;
      const end=event.changedTouches[0],dx=end.clientX-start.clientX,dy=end.clientY-start.clientY;
      start=null;
      if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.5)stepPhoto(dx>0?-1:1);
    },{passive:true});
  }
  drawPhoto();
  if(car.galleryPath){
    fetch(car.galleryPath).then(response=>response.ok?response.json():{}).then(rows=>{
      const urls=rows[car.vin]||[];
      const next=urls.filter(url=>typeof url==="string" && url.startsWith("https://") && !gallery.includes(url));
      if(next.length){gallery.push(...next);drawPhoto();}
    }).catch(()=>{});
  }
  const miles=exists(car.miles)?Number(car.miles).toLocaleString("en-US")+" mi":null;
  describe(get("specs"),[["Mileage",miles],["Engine",car.engine],["Transmission",car.transmission],["Fuel",car.fuel],["Exterior color",car.color],["Interior",car.interior],["Drivetrain",car.drivetrain],["Horsepower",car.horsepower],["City MPG",car.cityMpg],["Highway MPG",car.highwayMpg],["Doors",car.doors],["Body style",car.body],["VIN",car.vin],["Stock number",car.stock]]);
  const definitions=[
    ["Exterior",/hitch|wheel[s]?\b(?! drive)|tire|towing|tow package|liftgate|headlamp|headlight|fog light|running board|moonroof|sunroof|glass roof|badging/i],
    ["Entertainment & technology",/carplay|android auto|speaker|bluetooth|audio|stereo|radio|navigation|wi-?fi|touch.?screen|uconnect|sync\b/i],
    ["Safety",/cameras?|airbag|air bag|brakes?|collision|warning|seatbelt|cruise|stability|blind.?spot|parking sensor|lane.?keep/i],
    ["Mechanical",/drive|engine|suspension|motor|turbo|transmission|powertrain|differential|axle|cylinder|gear/i],
    ["Interior",/seat|steering wheel|climate|upholstery|crew cab|leather|interior|instrument panel/i]
  ];
  const features=Array.isArray(car.features)?car.features:[];
  const buckets=new Map();
  const addFeature=(category,value)=>{
    if(!value)return;
    if(!buckets.has(category))buckets.set(category,new Set());
    buckets.get(category).add(value);
  };
  const grouped=new Set();
  for(const [category,items] of Object.entries(car.categories || {})){
    if(!Array.isArray(items))continue;
    for(const item of items){
      if(typeof item!=="string" || !item.trim())continue;
      addFeature(category,item);grouped.add(item.toLowerCase());
    }
  }
  for(const value of features){
    if(grouped.has(value.toLowerCase()))continue;
    const category=definitions.find(([,pattern])=>pattern.test(value))?.[0]||"Other equipment";
    addFeature(category,value);
  }
  if(!buckets.size)get("features").append(makeNode("p","Ask the dealer for the equipment list for this vehicle."));
  for(const category of buckets.keys()){
    if(!buckets.has(category))continue;
    const details=makeNode("details"),list=makeNode("ul");list.className="checked-list";details.open=buckets.size<=3 || get("features").children.length===0;
    for(const feature of buckets.get(category))list.append(makeNode("li",feature));
    details.append(makeNode("summary",category),list);get("features").append(details);
  }
  if(car.packages?.length){
    get("package-section").hidden=false;
    for(const item of car.packages)get("package-list").append(makeNode("li",item));
  }
  if(car.dealerFactoryOptions?.length){
    get("option-section").hidden=false;
    for(const item of car.dealerFactoryOptions){
      const option=makeNode("details"),heading=[item.name||item.header,item.option_code,exists(item.price)?money(item.price):null].filter(Boolean).join(" · ");
      option.append(makeNode("summary",heading));
      if(item.description)option.append(makeNode("p",item.description));
      get("option-list").append(option);
    }
  }
  if(car.description){get("description-section").hidden=false;get("vehicle-description").textContent=car.description;}
  function safeUrl(value){try{const link=new URL(value);return link.protocol==="https:"?link.href:null;}catch{return null;}}
  const source=safeUrl(car.sourceUrl);
  if(source || car.observedAt || car.availability){
    get("listing-source").hidden=false;
    get("availability").textContent=car.availability||"";
    if(car.observedAt){
      const date=new Date(car.observedAt);
      if(Number.isFinite(date.getTime()))get("snapshot").textContent="Listing observed "+date.toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric",timeZone:"UTC"})+" (UTC)";
    }
    get("listing-disclaimer").textContent=car.disclaimer||"";
    if(source){get("source-link").hidden=false;get("source-link").href=source;}
  }
  const stickerUrl=safeUrl(car.windowStickerUrl);
  if(!sticker && stickerUrl){
    const panel=get("factory"),link=makeNode("a","View dealer-supplied sticker (PDF) ↗");
    link.href=stickerUrl;link.target="_blank";link.rel="noopener noreferrer";
    panel.append(makeNode("h2","Window sticker"),link);panel.hidden=false;get("sticker-link").hidden=false;
  }
  if(sticker){get("factory").hidden=false;get("sticker-link").hidden=false;FactorySticker.render(get("factory"),sticker);}
  const pricing=enabled("pricing");
  get("price-detail").hidden=!pricing;get("pricing-link").hidden=!pricing;
  describe(get("pricing"),[["Original MSRP",exists(car.msrp)?money(car.msrp):null],["Internet price",exists(car.internetPrice)?money(car.internetPrice):null],[car.sourceUrl?"Admin fee included":"Listed admin fee",exists(car.adminFee)?money(car.adminFee):null],["Asking price",money(car.price)]]);
  const modes=["cash","finance","lease"].filter(mode=>enabled(mode) && (mode==="cash" || (enabled("payment") && exists(car.price))));
  const labels={cash:"Cash",finance:"Finance",lease:"Lease"};
  function changeMode(mode){
    const monthly=mode==="finance"||mode==="lease";
    get("price-label").textContent=monthly?"Estimated "+labels[mode].toLowerCase()+" payment":"Asking price";
    get("price").textContent=monthly?money(Retail.amount(car,mode))+"/mo":money(car.price);
    get("terms").textContent=monthly?Retail.assumptions(mode):"";
    get("calculate").dataset.mode=monthly?mode:(enabled("finance")?"finance":"lease");
    for(const btn of get("modes").children)btn.setAttribute("aria-pressed",String(btn.dataset.mode===mode));
  }
  for(const mode of modes){
    const btn=makeNode("button",labels[mode]);btn.type="button";btn.dataset.mode=mode;
    btn.onclick=()=>changeMode(mode);get("modes").append(btn);
  }
  changeMode(modes[0]||"cash");
  const actions=get("vehicle-actions");actions.dataset.retailCar=car.id;
  for(const btn of actions.querySelectorAll("[data-retail]")){
    const key=btn.dataset.retail;
    btn.hidden=!enabled(key)||(key==="payment"&&!modes.some(mode=>mode!=="cash"));
  }
  get("drive-car").textContent=title+(car.stock?" · Stock "+car.stock:" · VIN "+car.vin);
  const bookingUrl="/api/test-drives?vin="+encodeURIComponent(car.vin);
  async function loadTimes(){
    const select=get("leadform").elements.slot;
    select.replaceChildren(new Option("Choose a time",""));
    try{
      const response=await fetch(bookingUrl);
      if(!response.ok)throw Error();
      const {slots}=await response.json();
      const format=new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
      for(const slot of slots)select.add(new Option(format.format(new Date(slot)),slot));
      if(!slots.length)get("drive-status").textContent="No appointments are available in the next two weeks.";
    }catch{get("drive-status").textContent="Times are unavailable. Contact sales to schedule.";}
  }
  get("request-drive").onclick=()=>{get("drive").showModal();if(!get("leadform").hidden)loadTimes();};
  if(new URLSearchParams(location.search).get("book")==="1")get("request-drive").click();
  document.querySelectorAll("dialog .close").forEach(btn=>btn.onclick=()=>btn.closest("dialog").close());
  let receipt, nextNote="tradeIn";
  const follow=get("follow-up");
  const phone=get("leadform").elements.phone;
  function checkPhone(){
    const number=phone.value.trim(),digits=number.replace(/\D/g,"");
    phone.setCustomValidity(/^\+?[0-9(). \-]+$/.test(number) && /^\d{7,15}$/.test(digits) ? "" : "Enter a callback number with 7 to 15 digits.");
  }
  phone.addEventListener("input",checkPhone);
  async function saveCustomerNote(field,answer){
    if(!receipt)return "No completed booking is open.";
    if(!answer?.trim())return "Ask the shopper for their answer.";
    const response=await fetch("/api/test-drives/notes?vin="+encodeURIComponent(car.vin),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slot:receipt.slot,token:receipt.token,field,answer})});
    if(!response.ok)throw Error("The note could not be saved. Please try again.");
    if(field==="tradeIn" && nextNote==="tradeIn"){
      nextNote="preferences";get("follow-up-question").textContent="Is there anything specific you’re looking for in your next vehicle?";
    }
    if(field==="preferences"){nextNote=null;follow.hidden=true;}
    follow.elements.answer.value="";
    return field==="tradeIn"?"Trade-in note saved. Ask what the shopper is looking for specifically.":"Shopping preferences saved in the customer notes.";
  }
  window.saveBookedCustomerNote=saveCustomerNote;
  follow.onsubmit=async event=>{
    event.preventDefault();const button=follow.querySelector("button");button.disabled=true;
    try{await saveCustomerNote(nextNote,follow.elements.answer.value);follow.querySelector("[role=status]").textContent="Answer saved.";}
    catch(e){follow.querySelector("[role=status]").textContent=e.message;}
    finally{button.disabled=false;}
  };
  get("leadform").onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector("button");
    if(button.disabled)return;
    const data=Object.fromEntries(new FormData(form));
    if(!data.name.trim()||!data.message.trim()){get("drive-status").textContent="Enter your name and a message.";return;}
    button.disabled=true;
    try{
      const response=await fetch(bookingUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      const result=await response.json();
      if(!response.ok){if(response.status===409)await loadTimes();throw Error(result.error||"Booking unavailable.");}
      try{await Store.addLead({...data,carId:car.id,source:"Scheduled test drive",message:data.message+" · "+data.slot});}catch{}
      get("drive-status").textContent="Reserved for "+form.elements.slot.selectedOptions[0].text+" Central time. Confirmation "+result.confirmation;
      receipt={slot:data.slot,token:result.noteToken};follow.hidden=false;
      form.hidden=true;get("drive-title").textContent="Test drive scheduled";
    }catch(error){get("drive-status").textContent=error.message || "Your reservation could not be saved. Please try again.";button.disabled=false;}
  };
  const previous=document.referrer && new URL(document.referrer);
  if(previous && previous.origin===location.origin && ["/","/index.html"].includes(previous.pathname)){
    get("back").onclick=event=>{event.preventDefault();history.back();};
  }
})();
