(() => {
  const byId=id=>document.getElementById(id),form=byId("oem-form"),dialog=byId("oem-dialog");
  const fields=["title","brand","market","source","version","startsOn","endsOn","disclosure","acceptance"];
  const states={draft:"Draft",approved:"Approved internally",withdrawn:"Withdrawn"};
  const el=(tag,value)=>Object.assign(document.createElement(tag),{textContent:value});
  let current,canReview=false,busy=false,loadVersion=0;
  function read(){
    return Object.fromEntries(fields.map(k=>[k,form.elements.namedItem(k).value.trim()]));
  }
  function buttons(){
    const unchanged=current && fields.every(k=>read()[k]===current.details[k]);
    const reviewing=canReview && current?.state==="draft";
    byId("oem-attest").hidden=byId("oem-approve").hidden=!reviewing;
    byId("oem-withdraw").hidden=!canReview || !current || current.state==="withdrawn";
    for(const b of form.querySelectorAll("button"))b.disabled=busy;
    byId("oem-approve").disabled=busy || !unchanged || !form.elements.namedItem("checked").checked;
    byId("oem-withdraw").disabled=busy || !unchanged;
  }
  let newId;
  function open(row){
    current=row;newId=row?.program_id||crypto.randomUUID();form.reset();
    for(const k of fields)form.elements.namedItem(k).value=row?.details[k]||"";
    byId("oem-heading").textContent=row?states[row.state]+" · Revision "+row.revision:"New OEM program";
    byId("oem-revision-note").textContent=row?.state==="approved"?"Saving a new draft or withdrawing this revision removes its linked offers from the storefront.":"Offer dates use the dealership’s configured time zone.";
    byId("oem-form-status").textContent="";buttons();dialog.showModal();
  }
  async function load(message=""){
    const serial=++loadVersion,status=byId("oem-status"),list=byId("oem-list");
    status.textContent="Loading programs…";
    try{
      const r=await readDealerDesk("api/oem-programs",{cache:"no-store"});
      if(!r.ok)throw Error("Sign in to view programs or reopen this tab to retry.");
      const data=await r.json();if(serial!==loadVersion)return;
      canReview=data.canReview;byId("oem-new").disabled=false;list.replaceChildren();
      if(!data.programs.length)list.append(el("p","Add the manufacturer's offer bulletin to prepare a reviewed homepage promotion."));
      for(const row of data.programs){
        const card=el("article",""),summary=el("div",""),actions=el("div",""),d=row.details;
        summary.append(el("strong",d.title),el("p",d.brand+" · "+d.market+" · "+d.startsOn+" to "+d.endsOn),el("small",states[row.state]+" · Revision "+row.revision+" · "+d.version));
        const edit=el("button",row.state==="draft" && canReview?"Review draft":"Open program");edit.onclick=()=>open(row);
        const evidence=el("a","Download evidence");evidence.href="api/oem-programs?export="+encodeURIComponent(row.program_id);evidence.download="";
        actions.className="campaign-actions";actions.append(edit,evidence);card.append(summary,actions);list.append(card);
      }
      status.textContent=message;
    }catch(error){if(serial===loadVersion){status.textContent=error.message;list.replaceChildren();byId("oem-new").disabled=true;}}
  }
  async function save(action){
    if(busy || (action==="save" && !form.reportValidity()))return;
    busy=true;buttons();
    try{
      const response=await fetch("api/oem-programs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        action,id:newId,revision:current?.revision||0,details:read(),checked:form.elements.namedItem("checked").checked})});
      const result=await response.json();if(!response.ok)throw Error(result.error||"Unable to save the program.");
      dialog.close();await load({save:"Draft saved.",approve:"Program approved. Review the linked artwork in Homepage banners.",withdraw:"Program withdrawn. Its banners are no longer eligible to display."}[action]);
      window.dispatchEvent(new Event("oem-programs-changed"));
    }catch(error){byId("oem-form-status").textContent=error.message;}
    finally{busy=false;buttons();}
  }
  form.onsubmit=event=>{event.preventDefault();save("save");};
  form.oninput=buttons;byId("oem-new").onclick=()=>open(null);
  byId("oem-approve").onclick=()=>save("approve");byId("oem-withdraw").onclick=()=>save("withdraw");
  byId("oem-close").onclick=()=>dialog.close();
  dialog.addEventListener("cancel",e=>{if(busy)e.preventDefault();});
  document.querySelector('[data-view="oem"]').addEventListener("click",()=>load());
})();

(() => {
  const element=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
  const picker=document.querySelector("#brand-picker"),detail=document.querySelector("#brand-reference");
  const status=document.querySelector("#brand-library-state"),upload=document.querySelector("#brand-upload"),add=document.querySelector("#brand-add");
  let library,loading=false,saving=false;
  function image(brand,digest,scope,title){
    const img=document.createElement("img");
    img.alt=title;img.loading="lazy";img.src="api/oem-brand-library?"+new URLSearchParams({brand,asset:digest,scope});
    const figure=document.createElement("figure");figure.append(img,element("figcaption",title));return figure;
  }
  function render(){
    const brand=library?.brands.find(row=>row.id===picker.value);
    detail.replaceChildren();add.hidden=!(brand && library.canReview);add.open=false;
    upload.reset();upload.querySelector("[role=status]").textContent="";
    if(!brand)return;
    const heading=element("h4",brand.name),sources=document.createElement("ul");
    detail.append(heading,element("p",brand.guidance.note),element("small",brand.guidance.market+" · Sources checked "+brand.reviewed));
    for(const s of brand.guidance.sources){
      const li=document.createElement("li"),a=element("a",s.title);
      a.href=s.url;a.target="_blank";a.rel="noopener noreferrer";
      li.append(a,element("small",s.kind));sources.append(li);
    }
    detail.append(sources);
    if(brand.artwork.length){
      detail.append(element("h5","Filed logo references"),element("p","These marks come from a 2023 manufacturer filing. Confirm current retailer artwork and permissions with the brand before use."));
      const grid=element("div","");grid.className="brand-thumbnails";
      for(const item of brand.artwork)grid.append(image(brand.id,item.digest,"library",item.label));
      detail.append(grid);
    }
    if(brand.dealerArtwork){
      const d=brand.dealerArtwork,block=element("div","");block.className="brand-supplied";
      block.append(element("h5","Dealership artwork"),image(brand.id,d.digest,"dealer",brand.name+" · Revision "+d.revision),
        element("p","Source · "+d.source_note),element("p","Permitted use · "+d.rights_note));
      detail.append(block);
    }
  }
  async function load(selected=picker.value){
    if(loading)return;
    loading=true;picker.disabled=true;status.textContent="Loading manufacturer sources…";
    try{
      const r=await readDealerDesk("api/oem-brand-library",{cache:"no-store"});
      if(!r.ok)throw Error(r.status===403?"Sign in to view manufacturer references.":"Manufacturer references are unavailable. Reopen this tab to retry.");
      library=await r.json();picker.replaceChildren(new Option("Select a manufacturer",""));
      for(const brand of library.brands)picker.add(new Option(brand.name,brand.id));
      picker.value=selected;picker.disabled=false;render();
      status.textContent=library.brands.length+" manufacturers · OEM certification coming soon";
    }catch(e){library=null;render();status.textContent=e.message;}finally{loading=false;}
  }
  picker.onchange=render;
  document.querySelector('[data-view="oem"]').addEventListener("click",()=>{if(!saving)load();});
  upload.onsubmit=async event=>{
    event.preventDefault();if(saving)return;
    const brand=library?.brands.find(row=>row.id===picker.value);
    if(!brand || !library.canReview)return;
    const message=upload.querySelector("[role=status]"),button=upload.querySelector("button");
    saving=true;button.disabled=true;picker.disabled=true;
    try{
      const file=upload.elements.logo.files[0];
      if(!file || file.type!=="image/png" || file.size>512000)throw Error("Choose a PNG under 500 KB.");
      const png=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error("Could not read the file."));reader.readAsDataURL(file);});
      const response=await fetch("api/oem-brand-library?brand="+encodeURIComponent(brand.id),{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({png,sourceNote:upload.elements.source.value,rightsNote:upload.elements.rights.value,revision:brand.dealerArtwork?.revision||0})});
      const result=await response.json();if(!response.ok)throw Error(result.error||"Could not save artwork.");
      await load(brand.id);if(library)status.textContent="Private dealership artwork saved for "+brand.name+".";
    }catch(e){message.textContent=e.message;}finally{saving=false;button.disabled=false;picker.disabled=!library;}
  };
})();
