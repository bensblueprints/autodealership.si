(() => {
  "use strict";
  const prefix = window.clientSite?"client-"+clientSite.slug+":":"motor-showroom-v1:";
  const catalog=window.CdjrInventory;
  for(const car of catalog){
    const cover=window.CdjrCovers?.[car.vin];
    if(cover){[car.image,car.imageType]=cover;car.galleryPath="assets/galleries/"+car.vin.slice(-2)+".json";}
  }
  const catalogById=new Map(catalog.map(car=>[car.id,car]));
  // Earlier versions saved the whole sample lot after any edit. Keep genuinely edited records.
  function userRecordsFromOldLot() {
    const records=read("cars",[]);
    if(!records.length)return [];
  const starter = [
    ["AP-1001",2021,"Porsche","Panamera","4 Sport Turismo",68900,27410,"porsche","Wagon",["All-wheel drive", "Twin-turbo V6", "Power liftgate", "Heated front seats", "Apple CarPlay"]],
    ["AP-1002",2018,"BMW","M3","Sedan",49800,39720,"bmw","Sedan",["Twin-turbo inline-six", "Rear-wheel drive", "Adaptive drive modes", "Sport seats", "Bluetooth audio"]],
    ["AP-1003",2019,"Mercedes-AMG","GT","Coupe",87500,21400,"mercedes","Coupe",["Twin-turbo V8", "Dual-clutch transmission", "LED headlamps", "Rear-wheel drive", "Selectable drive modes"]],
    ["AP-1004",2018,"Ford","F-150","XLT SuperCrew 4WD",27900,61950,"ford","Truck",["Four-wheel drive", "Crew cab", "Trailer hitch", "Rearview camera", "Bluetooth audio"]],
    ["AP-1005",2016,"Honda","CR-V","EX AWD",17900,74200,"jeep","SUV",["All-wheel drive", "Heated front seats", "Power moonroof", "Rearview camera", "Split-folding rear seats"]],
    ["AP-1006",2019,"Ford","Expedition","Limited 4WD",28900,58150,"suv","SUV",["Four-wheel drive", "Three-row seating", "Heated front seats", "Power liftgate", "Rearview camera"]],
    ["AP-1007",2021,"Toyota","Camry","SE",21950,42320,"toyota","Sedan",["Front-wheel drive", "Sport-tuned suspension", "Adaptive cruise control", "Apple CarPlay", "Rearview camera"]],
    ["AP-1008",2021,"Tesla","Model 3","Long Range AWD",25450,38200,"tesla","Sedan",["Dual-motor all-wheel drive", "Electric powertrain", "Glass roof", "Heated front seats", "Navigation"]],
    ["AP-1009",2016,"Lamborghini","Huracán","LP 610-4",195900,18630,"lambo","Coupe",["Naturally aspirated V10", "All-wheel drive", "Dual-clutch transmission", "Carbon-ceramic brakes", "LED headlamps"]]
  ].map(([id,year,make,model,trim,price,miles,photo,body,features],i) => ({
    id,stock:id,year,make,model,trim,price,miles,image:"assets/"+photo+".jpg",body,features,featured:i === 0
  }));
  // Illustrative listing data for the showroom's built-in sample lot.
  const demoSpecs = [
    ["Gasoline","Automatic","Twin-turbo V6","Black",4],
    ["Gasoline","Automatic","Twin-turbo inline-six","White",4],
    ["Gasoline","Automatic","Twin-turbo V8","Silver",2],
    ["Gasoline","Automatic","V6","Blue",4],
    ["Gasoline","CVT","Inline-four","White",4],
    ["Gasoline","Automatic","Twin-turbo V6","White",4],
    ["Gasoline","Automatic","Inline-four","Gray",4],
    ["Electric","Single-speed","Dual electric motors","White",4],
    ["Gasoline","Automatic","V10","White",2]
  ];
  starter.forEach((car, index) => {
    const [fuel,transmission,engine,color,doors] = demoSpecs[index];
    Object.assign(car,{fuel,transmission,engine,color,doors,condition:"Used",status:index===5?"In transit":"Available",
      location:index===2 || index===5?"North showroom":"Main showroom"});
  });
    return records.filter(car=>{
      const original=starter.find(seed=>seed.id===car.id);
      if(!original)return true;
      return Object.entries(car).some(([key,value])=>{
        if(value===null || value===undefined || value==="")return false;
        return JSON.stringify(original[key])!==JSON.stringify(value);
      });
    });
  }
  let view=null;
  const optionGroups = {
    "Inventory filters": {year:"Year",make:"Make",model:"Model",trim:"Trim",features:"Vehicle features",fuel:"Fuel type",
      transmission:"Transmission",miles:"Mileage",engine:"Engine",color:"Color",body:"Body style",doors:"Doors",location:"Location",status:"Inventory status",price:"Price or payment range"},
    "Purchase modes": {cash:"Cash",finance:"Finance",lease:"Lease"},
    "Shopping tools": {compare:"Compare vehicles",pricing:"Pricing and details tabs",payment:"Payment calculator",
      trade:"Value a trade",availability:"Confirm availability"}
  };
  const defaultOptions=Object.fromEntries(Object.values(optionGroups).flatMap(group => Object.keys(group).map(key=>[key,true])));
  function read(key, fallback) {
    const value = localStorage.getItem(prefix+key);
    return value === null ? fallback : JSON.parse(value);
  }
  function write(key,value) {
    localStorage.setItem(prefix+key,JSON.stringify(value));
    window.dispatchEvent(new Event("showroom:update"));
  }
  let inventoryStatus={},offers={};
  async function refreshInventoryStatus(){
    const res=await fetch("/api/inventory-status",{cache:"no-store"});
    if(!res.ok)throw Error("Inventory availability is unavailable.");
    inventoryStatus=await res.json();
    const offerResponse=await fetch("/api/bhph",{cache:"no-store"});
    if(offerResponse.ok)offers=await offerResponse.json();
    view=null;window.dispatchEvent(new Event("showroom:update"));
  }
  const inventoryReady=refreshInventoryStatus().catch(()=>{});
  function cars(includeSold=false) {
    return inventoryRows().filter(car=>!inventoryStatus[car.vin||car.id] || (includeSold && inventoryStatus[car.vin||car.id]==="sold"));
  }
  function inventoryRows() {
    if(view)return view;
    const byId=new Map(catalogById), added=[];
    function merge(record) {
      if(!record || !record.id)return;
      const baseId=byId.has(record.vin) ? record.vin : record.id;
      const existing=byId.get(baseId);
      if(!existing)added.unshift(baseId);
      byId.set(baseId,{...existing,...record,id:baseId});
    }
    for(const car of userRecordsFromOldLot())merge(car);
    for(const key of Object.keys(localStorage)){
      if(key.startsWith(prefix+"vehicle:"))merge(JSON.parse(localStorage.getItem(key)));
    }
    view=[...added,...catalogById.keys()].map(id=>{const car=byId.get(id),offer=offers[car.vin||id];return offer?{...car,price:offer.cash/100,bhph:offer.enabled?offer:null}:car;});
    return view;
  }
  const leads = () => Object.keys(localStorage).filter(k=>k.startsWith(prefix+"lead:"))
    .map(k=>JSON.parse(localStorage.getItem(k))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  function addLead(input) {
    const car = cars().find(c=>c.id===input.carId);
    if (!car) throw new Error("This vehicle is no longer in inventory.");
    const name=String(input.name || "").trim(), email=String(input.email || "").trim(), phone=String(input.phone || "").trim();
    if (!name || !(email || phone)) throw new Error("Please enter a name and an email or phone number.");
    const lead={id:crypto.randomUUID(),createdAt:new Date().toISOString(),status:"New",carId:car.id,car:{id:car.id,vin:car.vin,year:car.year,make:car.make,model:car.model,stock:car.stock,image:car.image?.startsWith("data:")?"":car.image||""},name,email,phone,message:String(input.message || "").trim(),source:String(input.source || "Showroom inquiry")};
    write("lead:"+lead.id,lead);
    return lead;
  }
  function setStatus(id,status) {
    if (!["New","Contacted","Appointment set","Closed"].includes(status)) return;
    const lead=read("lead:"+id,null);
    if (lead) write("lead:"+id,{...lead,status});
  }
  async function saveCar(car) {
    if(window.clientSite){
      const res=await fetch("/api/client-inventory",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(car)});
      if(!res.ok)throw Error("Sign in as dealer and enter a valid VIN to publish inventory.");
      car.id=car.vin;catalogById.set(car.id,car);view=null;window.dispatchEvent(new Event("showroom:update"));return;
    }
    const original=catalogById.get(car.id);
    const patch={...read("vehicle:"+car.id,{}),...car};
    if(original)for(const key of Object.keys(patch)){
      if(key!=="id" && JSON.stringify(patch[key])===JSON.stringify(original[key]))delete patch[key];
    }
    view=null;
    write("vehicle:"+car.id,patch);
  }
  const defaultProfile={salesPhone:"573-691-4287",partsPhone:"573-691-5263",servicePhone:"573-691-5912",street:"3201 Missouri Blvd",city:"Jefferson City",region:"MO",postal:"65109",country:"USA"};
  let sharedProfile=null,profileRevision="0",profileRead=0;
  async function loadProfile(){
    const readNumber=++profileRead;
    const response=await fetch("/api/dealer-profile",{cache:"no-store"});
    if(!response.ok)throw Error("Shared dealership profile is unavailable.");
    const result=await response.json();
    if(readNumber!==profileRead || result.revision===profileRevision)return;
    sharedProfile=result.settings;profileRevision=result.revision;
    window.dispatchEvent(new Event("showroom:update"));
  }
  const profileReady=loadProfile().catch(()=>{});
  function settings() {
    const stored=read("settings",{});
    return {dealerName:window.clientSite?.name||"Capital City CDJR",tradeUrl:"",...stored,...sharedProfile,
      profile:{...(window.clientSite?{}:defaultProfile),...(sharedProfile?.profile||stored.profile)},options:{...defaultOptions,...stored.options}};
  }
  async function saveSettings(changes) {
    await profileReady;
    const prior=settings();
    if(changes.profile || changes.dealerName || changes.pages){
      const response=await fetch("/api/dealer-profile",{method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({revision:profileRevision,dealerName:changes.dealerName||prior.dealerName,profile:{...prior.profile,...changes.profile},pages:changes.pages??prior.pages??{}})});
      const result=await response.json();
      if(!response.ok){if(response.status===409)await loadProfile();throw Error(result.error||"Could not save profile.");}
      profileRead++;sharedProfile=result.settings;profileRevision=result.revision;
    }
    const next={...prior,...changes,options:{...prior.options,...changes.options}};
    delete next.profile;delete next.dealerName;delete next.pages;next.profileRevision=profileRevision;
    write("settings",next);
  }
  window.addEventListener("focus",()=>loadProfile().catch(()=>{}));
  function attachNote(id,field,answer){
    const lead=read("lead:"+id,null);
    if(lead)write("lead:"+id,{...lead,notes:{...lead.notes,[field]:answer}});
  }
  window.Store = {attachNote, cars,inventoryReady,refreshInventoryStatus,statusFor:vin=>inventoryStatus[vin],leads,addLead,setStatus,saveCar,settings,saveSettings,optionGroups,profileReady };
  window.addEventListener("storage",e=>{if(e.key===prefix+"settings"||e.key===null)loadProfile().catch(()=>{});if (!e.key || e.key.startsWith(prefix)){view=null;window.dispatchEvent(new Event("showroom:update"));}});
})();

