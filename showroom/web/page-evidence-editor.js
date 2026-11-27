const PageEvidenceEditor=(()=>{
  const byId=id=>document.getElementById(id),list=byId("pageSources"),ai=byId("pageAiCopy"),form=byId("pageEditor");
  const section=byId("pageEvidence"),hint=byId("pageSourcesStatus");
  const fields={year:"Year",make:"Make",model:"Model",trim:"Trim",body:"Body style",fuel:"Fuel",engine:"Engine",transmission:"Transmission",drivetrain:"Drivetrain",doors:"Doors"};
  const kinds={vehicle:"Vehicle specification",manufacturer:"Manufacturer claim",financial:"Financial offer"};
  const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text||""});
  const changed=()=>form.dispatchEvent(new Event("input"));
  let programs=[],loaded=false,pending,locked=false;
  function programOptions(select,id,revision){
    const options=[new Option("Choose an approved revision","")];
    for(const p of programs.filter(p=>p.state==="approved")){
      options.push(new Option(p.details.title+" · "+p.details.version+" · rev "+p.revision,p.program_id+"/"+p.revision));
    }
    const selected=id?id+"/"+revision:"";
    if(selected && !options.some(o=>o.value===selected))options.push(new Option("Saved revision "+revision+" · "+id,selected));
    select.replaceChildren(...options);select.value=selected;
  }
  function programHint(row){
    const [id,revision]=row.program.value.split("/");
    const p=programs.find(p=>p.program_id===id && p.revision===Number(revision));
    row.info.textContent=p?[p.details.brand,p.details.source,p.details.startsOn+" through "+p.details.endsOn,p.details.disclosure].join(" · "):
      id && loaded?"This saved revision is no longer current.":"";
  }
  async function loadPrograms(){
    if(loaded || pending)return pending;
    pending=(async()=>{
      try{
        const response=await readDealerDesk("/api/oem-programs",{cache:"no-store"});
        if(!response.ok)throw Error();
        programs=(await response.json()).programs;loaded=true;hint.textContent="";
        for(const row of list.children){
          const [id,rev]=row.program.value.split("/");programOptions(row.program,id,rev);programHint(row);
        }
      }catch{hint.textContent="Source programs could not load. Refresh the program list to retry.";}
      finally{pending=null;}
    })();return pending;
  }
  byId("refreshPageSources").onclick=()=>{loaded=false;loadPrograms();};
  section.addEventListener("toggle",()=>{if(section.open)loadPrograms();});
  function field(row,label,tag,name,limit){
    const wrapper=el("label",label),input=el(tag);if(limit)input.maxLength=limit;
    row[name]=input;wrapper.append(input);row.append(wrapper);return input;
  }
  function makeRow(c={}){
    const row=el("fieldset");row.className="page-block-row";
    const legend=el("legend","Claim source");row.append(legend);
    const kind=field(row,"Claim type","select","kind");for(const [id,label] of Object.entries(kinds))kind.add(new Option(label,id));
    kind.value=c.type||"vehicle";
    field(row,"Exact claim from the page","textarea","quote",600).value=c.quote||"";
    field(row,"Vehicle identification number (VIN)","input","vin",17).value=c.vin||"";
    const spec=field(row,"Inventory field","select","spec");spec.add(new Option("Choose a field",""));
    for(const [k,v] of Object.entries(fields))spec.add(new Option(v,k));spec.value=c.field||"";
    field(row,"Value stated in the claim","input","expected",200).value=c.expected||"";
    const program=field(row,"Approved OEM program","select","program");programOptions(program,c.program,c.revision);
    row.info=el("small");row.append(row.info);programHint(row);
    const help=el("small");row.append(help);
    const display=()=>{
      const vehicle=kind.value==="vehicle";
      row.program.parentElement.hidden=vehicle;row.info.hidden=vehicle;
      for(const item of [row.spec,row.expected])item.parentElement.hidden=!vehicle;
      help.textContent=vehicle?"Include the stock number or VIN and the inventory value in the quoted text.":
        kind.value==="financial"?"Quote the approved headline or full disclosure and include the complete disclosure on the page. Identify the vehicle on the offer line for a VIN-specific program.":
        "Use exact wording from the approved disclosure or headline. Identify the vehicle on that line for a VIN-specific program.";
      if(!vehicle && section.open)loadPrograms();
    };
    kind.onchange=()=>{display();changed();};program.onchange=()=>{programHint(row);changed();};
    const remove=el("button","Remove source");remove.type="button";remove.className="quiet";remove.onclick=()=>{row.remove();changed();byId("addPageSource").focus();};
    row.append(remove);display();return row;
  }
  byId("addPageSource").onclick=()=>{if(locked||list.children.length>=10)return;const row=makeRow();list.append(row);changed();row.kind.focus();};
  function read(){
    const claims=Array.from(list.children,row=>{
      const common={type:row.kind.value,quote:row.quote.value.trim(),vin:row.vin.value.trim().toUpperCase()};
      if(common.type==="vehicle")return {...common,field:row.spec.value,expected:row.expected.value.trim()};
      const [program,rev]=row.program.value.split("/");return {...common,program,revision:Number(rev||0)};
    });
    return claims.length||ai.checked?{ai:ai.checked,claims}:null;
  }
  function signature(e){
    return JSON.stringify([!!e?.ai,(e?.claims||[]).map(c=>[c.type,c.quote,c.vin,c.field,c.expected,c.program,c.revision])]);
  }
  function fill(e){
    ai.checked=!!e?.ai;list.replaceChildren(...(e?.claims||[]).map(makeRow));section.open=!!e;
  }
  function lock(value){
    locked=value;ai.disabled=value;byId("addPageSource").disabled=value||list.children.length>=10;
    for(const row of list.children)row.disabled=value;
  }
  function preview(box,e){
    if(!e)return;
    const group=el("div");group.className="page-source-preview";
    group.append(el("h4","Private source review"));
    if(e.ai)group.append(el("p","AI-assisted copy"));
    for(const c of e.claims){
      const item=el("div");item.className="source-detail";item.append(el("strong",kinds[c.type]),el("p",c.quote));
      if(c.type==="vehicle")item.append(el("small",[c.vin,fields[c.field],c.expected].filter(Boolean).join(" · ")));
      else{
        const p=programs.find(p=>p.program_id===c.program && p.revision===c.revision);
        item.append(el("small",p?[p.details.title,p.details.version,p.details.source,"Revision "+c.revision,p.details.endsOn,p.details.disclosure].join(" · "):"Program "+c.program+" · Revision "+c.revision));
      }
      group.append(item);
    }
    box.append(group);
  }
  return {read,signature,fill,lock,preview,loadPrograms};
})();
