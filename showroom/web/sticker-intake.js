(() => {
  const form=document.getElementById("carForm"),field=form.elements.msrp;
  const message=document.getElementById("stickerStatus"), preview=document.getElementById("stickerPreview");
  const upload=document.getElementById("stickerFile");
  const example="3C4NJDBN5TT223516";
  let current=null,automaticMsrp=null,request=null;
  function stop(){
    request?.abort();
    request=null;
  }
  function reset(){
    stop();current=null;automaticMsrp=null;message.textContent="";preview.replaceChildren();
  }
  function restore(car){
    reset();
    if(!car?.factorySticker?.vin || car.factorySticker.vin!==car.vin)return;
    current=car.factorySticker;
    if(current.filledMsrp && Number(field.value)===current.msrp)automaticMsrp=field.value;
    FactorySticker.render(preview,current);
  }
  function changeVin(vin){
    stop();
    if(current?.vin===vin)return;
    if(automaticMsrp!==null && field.value===automaticMsrp)field.value="";
    reset();
  }
  async function lookup(vin,make,file=null){
    stop();
    if(current?.vin===vin && !file)return;
    const provider=StickerSources.forMake(make);
    if(!provider) {
      message.textContent="Factory stickers are supported for select Ford, GM and Stellantis vehicles.";return;
    }
    const lookup=new AbortController();
    request=lookup;
    const timer=setTimeout(()=>lookup.abort(),20000);
    message.textContent="Retrieving the factory window sticker…";
    try{
      let bytes;
      if (file) {
        if (file.size>12*1024*1024) throw Error("File too large");
        bytes=await file.arrayBuffer();
      } else {
        let response=await fetch("/api/window-sticker?vin="+vin+"&provider="+provider,{signal:lookup.signal});
        if(vin===example && (!response.ok || !(response.headers.get("content-type") || "").includes("application/pdf")))
          response=await fetch("assets/stickers/"+vin+".pdf",{signal:lookup.signal});
        if(!response.ok)throw Error("Factory sticker unavailable");
        bytes=await response.arrayBuffer();
      }
      const record=await window.StickerReader.read(bytes,vin,provider);
      if(request!==lookup || lookup.signal.aborted || form.elements.vin.value!==vin)return;
      let localPdf=false;
      if(file) {
        await FactorySticker.savePdf(vin,new Blob([bytes],{type:"application/pdf"}));
        if(request!==lookup || lookup.signal.aborted || form.elements.vin.value!==vin)return;
        localPdf=true;
      }
      current={...record,vin,provider,localPdf,sourceUrl:FactorySticker.manufacturerUrl(vin,provider)};
      if(!field.value && Number.isFinite(current.msrp)) {
        field.value=String(current.msrp);automaticMsrp=field.value;
      }
      window.applyStickerFields(current);
      FactorySticker.render(preview,current);
      message.textContent="Factory sticker matched to this VIN. Review the equipment below.";
    }catch(error){
      if(request===lookup)message.textContent=error.name==="AbortError"?"Factory sticker lookup timed out. Use Look up VIN to retry.":"Could not verify a factory sticker for this VIN. Import the manufacturer PDF or enter details manually.";
    }finally{clearTimeout(timer);if(request===lookup)request=null;}
  }
  function recordFor(vin){
    if(request || document.getElementById("decodeVin").disabled)throw Error("Vehicle lookup is in progress. Save after the lookup finishes.");
    return current?.vin===vin ? {...current,filledMsrp:automaticMsrp!==null && field.value===automaticMsrp}:null;
  }
  upload.addEventListener("change",()=>{
    const file=upload.files[0],vin=form.elements.vin.value.trim().toUpperCase();
    if(!file)return;
    if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)||!form.elements.make.value)message.textContent="Enter the VIN and make before importing its PDF.";
    else lookup(vin,form.elements.make.value,file);
    upload.value="";
  });
  form.addEventListener("reset",reset);
  document.getElementById("editor").addEventListener("close",reset);
  window.StickerIntake={restore,changeVin,lookup,recordFor};
})();
