window.InventoryDrafts=(()=>{
  const el=id=>document.getElementById(id);
  const area=el("bulk-vins"),file=el("bulk-file"),submit=el("bulk-save"),status=el("bulk-status");
  const panel=el("draft-list"),count=el("draft-count"),items=el("draft-rows");
  let page=0,revision=0,busy=false,openDraft;
  function parse(){
    const vins=new Set(),invalid=[];
    let repeated=0;
    for(const token of area.value.toUpperCase().split(/[\s,;]+/).filter(Boolean)){
      if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(token)){invalid.push(token);continue;}
      if(vins.has(token))repeated++;
      vins.add(token);
    }
    return {vins:[...vins],invalid,repeated};
  }
  function preview(){
    const {vins,invalid,repeated}=parse();
    submit.disabled=busy || !vins.length;
    el("bulk-preview").textContent=area.value.trim()?vins.length+" unique VINs · "+repeated+" repeated · "+invalid.length+" invalid":"";
    el("bulk-invalid").hidden=!invalid.length;
    el("bulk-invalid-list").textContent=invalid.join(", ");
  }
  async function load(){
    const check=++revision;
    try{
      const r=await readDealerDesk("/api/inventory-drafts?offset="+page*20,{cache:"no-store"});
      if(!r.ok)throw Error(r.status===403?"Sign in again to load drafts.":"Could not load drafts.");
      const data=await r.json();
      if(check!==revision)return;
      if(page && !data.rows.length){page--;return load();}
      count.textContent=String(data.total);
      el("draft-back").disabled=page===0;
      el("draft-next").disabled=(page+1)*20>=data.total;
      el("draft-pages").hidden=data.total<=20;
      el("draft-page").textContent="Page "+(page+1)+" of "+Math.max(1,Math.ceil(data.total/20));
      items.replaceChildren();
      for(const {vin,specs} of data.rows){
        const row=document.createElement("div"),identity=document.createElement("div"),title=document.createElement("strong"),number=document.createElement("small"),action=document.createElement("button");
        title.textContent=[specs?.ModelYear,specs?.Make,specs?.Model,specs?.Trim].filter(Boolean).join(" ")||"Vehicle details pending";
        number.textContent=vin;identity.append(title,number);
        action.type="button";action.className="quiet";action.textContent="Review draft";action.setAttribute("aria-label","Review draft "+vin);
        action.onclick=()=>openDraft({vin,specs});row.append(identity,action);items.append(row);
      }
      el("draft-status").textContent=data.total?"":"Imported vehicles will appear here until you publish them.";
    }catch(error){if(check===revision){count.textContent="—";el("draft-status").textContent=error.message;}}
  }
  area.oninput=()=>{status.textContent="";preview();};
  file.onchange=async()=>{
    const selected=file.files[0];if(!selected)return;
    try{
      if(selected.size>2_000_000)throw Error("Choose a text file under 2 MB.");
      area.value=await selected.text();status.textContent="";preview();
    }catch(error){status.textContent=error.message;}
  };
  el("import-vins").onclick=()=>{el("bulk-dialog").showModal();preview();area.focus();};
  el("draft-back").onclick=()=>{if(page){page--;load();}};
  el("draft-next").onclick=()=>{page++;load();};
  panel.ontoggle=()=>{if(panel.open)load();};
  submit.onclick=async()=>{
    if(busy)return;
    const {vins,invalid,repeated}=parse();if(!vins.length)return;
    busy=true;area.disabled=file.disabled=submit.disabled=true;
    let added=0,previous=0,listed=0,pending=0,processed=0;
    try{
      for(let i=0;i<vins.length;i+=10){
        status.textContent="Importing VINs "+(i+1)+"–"+Math.min(i+10,vins.length)+" of "+vins.length+"…";
        const r=await fetch("/api/inventory-drafts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:vins.slice(i,i+10).join("\n")})});
        const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"Import interrupted. Reopen your dealership and retry this list.");
        added+=data.added.length;previous+=data.drafts.length;listed+=data.existing.length;pending+=data.needsLookup;processed+=vins.slice(i,i+10).length;
      }
      const summary=added+" new drafts · "+previous+" already drafted · "+listed+" already in inventory"+(pending?" · "+pending+" need VIN review":"")+(invalid.length?" · "+invalid.length+" invalid skipped":"")+(repeated?" · "+repeated+" repeats skipped":"")+".";
      status.textContent=el("draft-result").textContent=summary;
      area.value="";file.value="";el("bulk-dialog").close();panel.open=true;page=0;await load();
    }catch(error){status.textContent=processed+" of "+vins.length+" processed. "+error.message+" Retrying skips saved VINs.";await load();}
    finally{busy=false;area.disabled=file.disabled=false;preview();}
  };
  return {load,init(callback){openDraft=callback;}};
})();
