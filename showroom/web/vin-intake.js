(() => {
  const form=document.getElementById("carForm"), fields=form.elements;
  const status=document.getElementById("vinStatus"), button=document.getElementById("decodeVin");
  const cache=new Map(), filled=new Map();
  let controller=null, lastVin="", revision=0;
  const detailsByVin=new Map();
  window.vpicDetailsFor=vin=>detailsByVin.get(vin);
  const ready="Paste a VIN to fill available vehicle specifications.";
  const normalize=value=>value.replace(/\s/g,"").toUpperCase();
  function clean(value) {
    const text=String(value??"").trim();
    return /^(?:not applicable|not available|unknown|n\/a|null)$/i.test(text) ? "" : text;
  }
  function specs(r) {
    const classes=[[/sport utility|multipurpose/i,"SUV"],[/pickup|truck/i,"Truck"],[/sedan/i,"Sedan"],[/coupe/i,"Coupe"],[/convertible|cabriolet/i,"Convertible"],[/hatchback/i,"Hatchback"],[/wagon/i,"Wagon"],[/van/i,"Van"]];
    const body=classes.find(([pattern])=>pattern.test(r.BodyClass))?.[1];
    const size=Number(r.DisplacementL), cylinders=Number(r.EngineCylinders);
    const engine=[size>0 && size.toFixed(1)+" L",cylinders>0 && cylinders+"-cylinder",clean(r.EngineModel)].filter(Boolean).join(" · ");
    const standard={BlindSpotMon:"Blind spot monitoring",RearVisibilitySystem:"Backup camera",AdaptiveCruiseControl:"Adaptive cruise control",LaneDepartureWarning:"Lane departure warning",ForwardCollisionWarning:"Forward collision warning",ABS:"Anti-lock brakes",ESC:"Electronic stability control"};
    const features=[clean(r.DriveType),...Object.entries(standard).filter(([key])=>r[key]==="Standard").map(([,label])=>label)].filter(Boolean);
    return {year:r.ModelYear,make:r.Make,model:r.Model,trim:r.Trim,body,fuel:[clean(r.FuelTypePrimary),clean(r.FuelTypeSecondary)].filter(Boolean).join(" / "),transmission:r.TransmissionStyle,engine,doors:r.Doors,features:features.join("\n")};
  }
  window.applyStickerFields=(record)=>{
    if(record.vin!==normalize(fields.vin.value))return;
    for(const [key,value] of Object.entries(record.listingFields||{})){
      const field=fields.namedItem(key);
      if(!value || !field || (field.value.trim() && field.value!==filled.get(key)))continue;
      field.value=value;filled.set(key,field.value);
    }
    const features=fields.features;
    if(!features.value.trim() || features.value===filled.get("features")){
      const lines=[...features.value.split("\n"),...(record.equipment||[]),...(record.options||[]).map(x=>x.name),...(record.packages||[]).map(x=>x.name)];
      features.value=[...new Set(lines.map(s=>s.trim()).filter(Boolean))].join("\n");filled.set("features",features.value);
    }
  };
  function cancel(){revision++;controller?.abort();controller=null;button.disabled=false;}
  function clearDecoded(){
    for(const [key,value] of filled)if(fields[key].value===value)fields[key].value="";
    filled.clear();
  }
  function reset(){cancel();filled.clear();lastVin="";status.textContent=ready;}
  form.addEventListener("reset",reset);
  document.getElementById("editor").addEventListener("close",reset);
  async function lookup() {
    const vin=normalize(fields.vin.value);
    fields.vin.value=vin;
    if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)){
      status.textContent="Enter 17 letters and digits. VINs exclude I, O and Q.";return;
    }
    cancel();
    const token=revision;
    controller=new AbortController();
    const timer=setTimeout(()=>{if(token===revision)controller?.abort();},12000);
    lastVin=vin;button.disabled=true;status.textContent="Looking up this VIN with NHTSA…";
    try{
      let row=cache.get(vin);
      if(!row){
        let response=await fetch("/api/vin-decode?vin="+encodeURIComponent(vin),{signal:controller.signal});
        if(response.status===503 || response.status===404)response=await fetch("https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/"+vin+"?format=json",{signal:controller.signal});
        if(!response.ok)throw Error();
        const decoded=await response.json();
        row=decoded.Results?.[0];
        if(row && String(row.ErrorCode)==="0" && decoded.details)detailsByVin.set(vin,decoded.details);
        if(!row)throw Error();
        cache.set(vin,row);
      }
      if(token!==revision || normalize(fields.vin.value)!==vin)return;
      if(String(row.ErrorCode)!=="0"){
        status.textContent="NHTSA could not confirm this VIN. "+(clean(row.ErrorText)||"Check the VIN or enter the details manually.");return;
      }
      StickerIntake.lookup(vin,row.Make);
      let count=0;
      for(const [key,raw] of Object.entries(specs(row))){
        const value=clean(raw),field=fields[key];
        if(!field || !value || field.value.trim())continue;
        field.value=value;
        if(field.value){filled.set(key,field.value);count++;}
      }
      form.querySelector(".editor-details").open=true;
      status.textContent=count?"NHTSA filled "+count+" fields. Review the details before saving.":"VIN confirmed: "+[row.ModelYear,row.Make,row.Model,row.Trim].filter(Boolean).join(" ")+". Existing entries retained.";
    }catch{if(token===revision)status.textContent="VIN lookup is unavailable. Retry or enter the vehicle details manually.";}
    finally{clearTimeout(timer);if(token===revision){controller=null;button.disabled=false;}}
  }
  fields.vin.addEventListener("input",()=>{
    const vin=normalize(fields.vin.value);
    if(vin===lastVin && vin)return;
    StickerIntake.changeVin(vin);
    cancel();clearDecoded();lastVin="";fields.vin.value=vin;
    status.textContent=vin && vin.length!==17?"Enter a complete 17-character VIN.":ready;
    if(vin.length===17)lookup();
  });
  button.addEventListener("click",lookup);
  fields.vin.addEventListener("keydown",event=>{if(event.key==="Enter"){event.preventDefault();lookup();}});
})();
