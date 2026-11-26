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
