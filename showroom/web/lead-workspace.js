const LeadWorkspace=(()=>{
  const get=id=>document.getElementById(id);
  const element=(tag,text,css)=>{
    const e=document.createElement(tag);
    if(text!==undefined)e.textContent=text;
    if(css)e.className=css;
    return e;
  };
  const states=["New","Contacted","Appointment set","Closed"];
  const kinds=["Call shopper","Review inquiry","Reply by email","Prepare text reply","Confirm appointment","Other"];
  const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const stamp=new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"});
  const when=iso=>stamp.format(new Date(iso));
  let team=null;
  const announce=()=>window.dispatchEvent(new Event("showroom:update"));
  async function directory(){
    const r=await readDealerDesk("/api/inquiries/team",{cache:"no-store"});
    if(!r.ok)throw Error("Could not load the dealership team. Refresh the inbox to retry.");
    team=await r.json();
  }
  const narrowed=()=>Boolean(get("lead-search").value.trim() || get("lead-queue").value!=="all");
  function filter(rows){
    const search=get("lead-search").value.trim().toLowerCase();
    const digits=search.replace(/\D/g,""),phoneSearch=digits.length>=3 && /^[+\d().\s-]+$/.test(search);
    const queue=get("lead-queue").value,now=Date.now();
    const matches=rows.filter(row=>{
      const work=row.followUp||{},due=Date.parse(work.task?.dueAt);
      const values=[row.name,row.phone,row.email,row.car?.vin,row.car?.stock,row.car?.make,row.car?.model,row.message,work.owner?.label];
      return (!search || values.some(v=>String(v||"").toLowerCase().includes(search)) || (phoneSearch && String(row.phone||"").replace(/\D/g,"").includes(digits))) &&
        (queue==="all" || (queue==="mine" && team && work.owner?.id===team.me.id) || (queue==="unassigned" && !work.owner && row.status!=="Closed") ||
        (queue==="overdue" && due<=now) || (queue==="upcoming" && due>now));
    });
    if(queue==="overdue" || queue==="upcoming")matches.sort((a,b)=>a.followUp.task.dueAt.localeCompare(b.followUp.task.dueAt));
    get("lead-work-count").textContent=matches.length+" "+(matches.length===1?"inquiry":"inquiries");
    return matches;
  }
  function card(row,container,details){
    const work=row.followUp||{},aside=element("div",undefined,"inquiry-work");
    aside.append(element("span",row.status,"inquiry-state"),element("strong",work.owner?.label||"Unassigned"));
    if(work.task){
      const deadline=element("small",work.task.kind+" · "+when(work.task.dueAt));
      if(Date.parse(work.task.dueAt)<=Date.now()){deadline.className="work-overdue";deadline.prepend("Overdue · ");}
      aside.append(deadline);
    }
    const button=element("button","Manage inquiry","quiet");
    button.type="button";button.onclick=()=>edit(row,button);
    aside.append(button);container.append(details,aside);
  }
  function today(rows){
    const box=get("today-task-list"),panel=get("today-tasks");
    const end=new Date();end.setHours(23,59,59,999);
    const due=rows.filter(r=>r.followUp?.task && Date.parse(r.followUp.task.dueAt)<=+end && r.status!=="Closed")
      .sort((a,b)=>a.followUp.task.dueAt.localeCompare(b.followUp.task.dueAt));
    panel.hidden=!due.length || !!Store.inquiryState();box.replaceChildren();
    for(const row of due.slice(0,8)){
      const task=row.followUp.task,line=element("article",undefined,"due-row"),copy=element("div");
      copy.append(element("strong",row.name+" · "+task.kind),element("small",[row.followUp.owner?.label,when(task.dueAt)].filter(Boolean).join(" · ")));
      if(Date.parse(task.dueAt)<=Date.now())copy.append(element("small","Overdue","work-overdue"));
      const button=element("button","Open inquiry","quiet");button.type="button";button.onclick=()=>edit(row,button);
      line.append(copy,button);box.append(line);
    }
    if(due.length>8)box.append(element("small","Showing the earliest 8 of "+due.length+" due through today."));
  }
  function localInput(iso){
    const d=new Date(iso);
    return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  }
  async function edit(row,trigger){
    if(document.getElementById("inquiry-editor"))return;
    const work=row.followUp||{},modal=element("dialog");modal.id="inquiry-editor";modal.setAttribute("aria-labelledby","inquiry-editor-title");
    modal.innerHTML='<div class="sectionhead"><h2 id="inquiry-editor-title"></h2><button type="button" data-close>Close</button></div><p data-vehicle></p><p data-question></p><p data-message role="status">Loading team and activity…</p><form hidden><div class="work-fields"><label>Salesperson<select name="owner"></select></label><label>Lead status<select name="status"></select></label><label>Next action<select name="action"></select></label><label data-kind>Follow-up type<select name="kind"></select></label><label data-time>Due time<input type="datetime-local" name="due"><small></small></label><label class="work-wide">Private staff note<textarea name="note" maxlength="1000" rows="2"></textarea></label></div><button type="submit" class="primary">Save inquiry</button></form><details class="work-history"><summary>Activity history</summary><ol></ol></details>';
    const q=selector=>modal.querySelector(selector),message=q("[data-message]"),form=q("form"),f=form.elements;
    q("h2").textContent=row.name;q("[data-question]").textContent=row.message||"";
    q("[data-vehicle]").textContent=[row.car?.year,row.car?.make,row.car?.model,row.car?.stock?"· Stock "+row.car.stock:""].filter(Boolean).join(" ");
    q("[data-close]").onclick=()=>modal.close();modal.onclose=()=>{modal.remove();if(trigger.isConnected)trigger.focus();};
    document.body.append(modal);modal.showModal();
    try{
      const [,historyResponse]=await Promise.all([directory(),readDealerDesk("/api/inquiries/history?id="+encodeURIComponent(row.id),{cache:"no-store"})]);
      if(!historyResponse.ok)throw Error("Could not load inquiry activity. Reopen the inquiry to retry.");
      const history=await historyResponse.json();
      if(!modal.open)return;
      for(const event of [...history].reverse()){
        const item=element("li");
        item.append(element("strong",event.actor.label+" · "+when(event.at)),element("span",[event.status,event.owner?.label||"Unassigned",event.completed?"Completed "+event.previousTask?.kind:event.task?event.task.kind+" due "+when(event.task.dueAt):null].filter(Boolean).join(" · ")));
        if(event.note)item.append(element("p",event.note));q("ol").append(item);
      }
      const received=element("li");received.append(element("strong","Inquiry received"),element("span",(row.source||"Showroom")+" · "+when(row.createdAt)));q("ol").append(received);
      const canEdit=team.manager || !work.owner || work.owner.id===team.me.id;
      if(!canEdit){message.textContent="Assigned to "+work.owner.label+". The assigned salesperson or a manager can update this inquiry.";q("details").open=true;return;}
      message.textContent=team.directoryReady?"":"The staff directory is refreshing. You can still claim this inquiry.";
      for(const [key,label] of [["","Unassigned"],...team.members.filter(m=>team.manager || work.owner || m.id===team.me.id).map(m=>[m.id,m.label+(m.id===team.me.id?" (you)":"")])]){
        f.owner.add(new Option(label,key));
      }
      if(work.owner && !Array.from(f.owner.options).some(o=>o.value===work.owner.id))f.owner.add(new Option(work.owner.label+" (previous assignee)",work.owner.id));
      f.owner.value=work.owner?.id||"";
      for(const state of states)f.status.add(new Option(state,state));f.status.value=row.status;
      f.action.add(new Option(work.task?"Keep "+work.task.kind+" · "+when(work.task.dueAt):"No scheduled follow-up","keep"));
      f.action.add(new Option(work.task?"Reschedule or change follow-up":"Schedule follow-up","schedule"));
      if(work.task){f.action.add(new Option("Mark follow-up complete","complete"));f.action.add(new Option("Remove follow-up","clear"));}
      for(const kind of kinds)f.kind.add(new Option(kind,kind));
      if(work.task){f.kind.value=work.task.kind;f.due.value=localInput(work.task.dueAt);}
      q("[data-time] small").textContent="Your time zone · "+zone.replaceAll("_"," ");
      const fields=()=>{
        const schedule=f.action.value==="schedule";q("[data-time]").hidden=q("[data-kind]").hidden=!schedule;
        f.due.required=schedule;if(schedule && !f.owner.value)f.owner.value=team.me.id;
      };
      f.action.onchange=fields;fields();form.hidden=false;
      form.onsubmit=async e=>{
        e.preventDefault();
        const button=q("[type=submit]"),due=f.action.value==="schedule"?new Date(f.due.value):null;
        if(due && (!Number.isFinite(+due) || localInput(due)!==f.due.value)){message.textContent="Choose a valid local time.";return;}
        button.disabled=true;
        try{
          const resp=await fetch("/api/inquiries",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:row.id,action:"save-follow-up",revision:work.revision||0,owner:f.owner.value||null,status:f.status.value,taskAction:f.action.value,kind:f.kind.value,dueAt:due?.toISOString(),note:f.note.value})});
          const data=await resp.json();
          if(!resp.ok){if(resp.status===409)await Store.loadLeads();throw Error(data.error||"Could not save this inquiry.");}
          await Store.loadLeads();modal.close();get("lead-save-notice").textContent="Inquiry saved.";
        }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
      };
    }catch(error){if(modal.open)message.textContent=error.message;}
  }
  if(window.postgresInventory){
    get("lead-work-filters").hidden=false;
    get("lead-search").oninput=announce;get("lead-queue").onchange=announce;
    get("view-work").onclick=()=>document.querySelector('[data-view="inquiries"]').click();
    const reload=async()=>{
      try{await directory();}catch{team=null;}
      await Store.loadLeads();
    };
    get("lead-refresh").onclick=reload;
    directory().then(announce).catch(()=>{});
    setInterval(()=>{if(!document.hidden && (!get("inquiries").hidden || !get("today").hidden))reload();},60000);
  }
  return {filter,narrowed,card,today};
})();
