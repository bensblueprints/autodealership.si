const ConversationDesk=(()=>{
  const get=s=>document.getElementById(s),api="/api/conversations",box=get("conv-detail"),list=get("conv-list");
  const el=(t,v,cl)=>{const n=document.createElement(t);if(v!==undefined)n.textContent=v;if(cl)n.className=cl;return n;};
  const btn=(v,fn)=>{const n=el("button",v);n.type="button";n.onclick=fn;return n;};
  const format=v=>new Date(v).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  let team=null,version=0,selection=0,offset=0,openId="",timer;
  async function call(url,data,method){
    const res=data?await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}):await readDealerDesk(url,{cache:"no-store"});
    const result=await res.json();if(!res.ok)throw Error(result.error||"Could not load this conversation.");return result;
  }
  async function load(reset=false){
    if(reset)offset=0;
    const serial=++version,msg=get("conv-list-status");
    try{
      const params=new URLSearchParams({search:get("conv-search").value,queue:get("conv-queue").value,offset});
      const [data,members]=await Promise.all([call(api+"?"+params),call("/api/inquiries/team")]);if(serial!==version)return;team=members;
      list.replaceChildren();get("conv-prev").hidden=!offset;get("conv-next").hidden=!data.more;
      msg.textContent=data.items.length?"":"No matching conversations.";
      for(const o of data.items){
        const b=btn("",()=>show(o.id));b.dataset.opportunity=o.id;b.className="conv-row";b.setAttribute("aria-pressed",String(openId===o.id));
        b.append(el("strong",o.name),el("span",o.stage,"conv-stage"),el("small",[o.stocks && "Stock "+o.stocks,o.owner?.label||"Unassigned"].filter(Boolean).join(" · ")));list.append(b);
      }
    }catch(e){if(serial===version)msg.textContent=e.message;}
  }
  async function show(id){
    const serial=++selection;openId=id;
    for(const b of list.children)b.setAttribute("aria-pressed",String(b.dataset.opportunity===id));
    box.setAttribute("aria-busy","true");
    try{
      const data=await call(api+"?id="+encodeURIComponent(id));if(serial!==selection)return;
      const o=data.opportunity;box.replaceChildren();
      const heading=el("h3",o.name),contact=el("p",[o.phone,o.email].filter(Boolean).join(" · "),"conv-contact");
      const identity=el("small","Opportunity #"+o.id.slice(0,8).toUpperCase()),edit=el("form",undefined,"conv-assignment");
      const assignee=el("select"),stage=el("select"),status=el("p");status.setAttribute("role","status");
      function labeled(label,child){const l=el("label",label);l.append(child);return l;}
      assignee.add(new Option("Unassigned",""));for(const m of team.members)assignee.add(new Option(m.label+(m.id===team.me.id?" (you)":""),m.id));
      if(o.owner && ![...assignee.options].some(x=>x.value===o.owner.id))assignee.add(new Option(o.owner.label,o.owner.id));
      assignee.value=o.owner?.id||"";assignee.disabled=!team.manager;
      for(const v of ["New","Working","Appointment","Won","Lost"])stage.add(new Option(v,v));stage.value=o.stage;stage.disabled=!data.canEdit;
      const action=el("button",!team.manager && !o.owner?"Claim opportunity":"Save opportunity","quiet");action.type="submit";action.disabled=!data.canEdit;
      edit.append(labeled("Assigned salesperson",assignee),labeled("Opportunity stage",stage),action);
      edit.onsubmit=async e=>{e.preventDefault();action.disabled=true;try{await call(api,{id,revision:o.revision,stage:stage.value,owner:team.manager?(assignee.value||null):team.me.id},"PUT");await load();await show(id);}catch(err){status.textContent=err.message;action.disabled=false;}};
      const log=el("ol",undefined,"conv-history");log.setAttribute("aria-label","Conversation timeline");
      for(const m of data.timeline){
        const li=el("li",undefined,m.direction==="out"?"conv-sent":"conv-received");
        li.append(el("strong",[m.channel,m.direction==="in"?"Shopper":m.actor||"Dealer"].join(" · ")));
        if(m.subject)li.append(el("div",m.subject));li.append(el("p",m.body||"Media message"),el("small",[m.stock && "Stock #"+m.stock,m.state,format(m.created_at)].filter(Boolean).join(" · ")));log.append(li);
      }
      const refresh=btn("Refresh messages",()=>show(id));box.append(identity,heading,contact,edit,status,refresh,log);
      if(!data.canEdit){box.append(el("p","The assigned salesperson or dealer owner can reply."));return;}
      const stocks=data.leads.filter(l=>l.textReplyRequest),form=el("form",undefined,"conv-compose"),channel=el("select"),stock=el("select"),subject=el("input"),body=el("textarea");
      if(stocks.length)channel.add(new Option("Text message","sms"));if(o.email)channel.add(new Option("Email","email"));
      if(!channel.options.length){box.append(el("p","A shopper email or text request is needed to reply here."));return;}
      for(const l of stocks)stock.add(new Option(l.stock?"Stock #"+l.stock:l.source||"Shopper inquiry",l.id));
      const stockField=labeled("Inquiry",stock),subjectField=labeled("Subject",subject);
      subject.value="Re: Your dealership inquiry";subject.maxLength=200;body.required=true;body.rows=4;
      const send=el("button","Send reply","primary"),note=el("p");send.type="submit";note.setAttribute("role","status");
      form.append(labeled("Reply via",channel),stockField,subjectField,labeled("Message",body),send,note);box.append(form);
      let check=0,request=null,signature="",permitted=false;
      async function policy(){
        const rev=++check,isEmail=channel.value==="email";permitted=false;send.disabled=true;note.textContent="";
        stockField.hidden=isEmail||stocks.length<2;subjectField.hidden=!isEmail;subject.required=isEmail;body.maxLength=isEmail?5000:1000;
        try{
          const sms=isEmail?null:await call("/api/inquiries/texts?id="+stock.value);
          if(rev!==check)return;
          const reason=isEmail?(!data.mailbox?"Connect the dealer’s verified reply mailbox in Email connection.":""):sms.reason;
          permitted=!reason;send.disabled=!permitted;note.textContent=reason||(isEmail?"From sales@"+data.mailbox:"From "+sms.from);
        }catch(err){if(rev===check)note.textContent=err.message;}
      }
      channel.onchange=policy;stock.onchange=policy;await policy();
      form.onsubmit=async e=>{
        e.preventDefault();if(!permitted || send.disabled)return;send.disabled=true;
        try{
          if(channel.value==="email"){
            const key=JSON.stringify([subject.value,body.value]);if(signature!==key){request=crypto.randomUUID();signature=key;}
            await call(api+"/email",{id,request,subject:subject.value,body:body.value},"POST");
          }else{
            const lead=stocks.find(l=>l.id===stock.value);
            const draft=await call("/api/inquiries",{action:"save-text-draft",id:lead.id,revision:lead.textDraft?.revision||"",text:body.value},"PUT");
            lead.textDraft=draft;await call("/api/inquiries/texts",{id:lead.id,revision:draft.revision},"POST");
          }
          await load();await show(id);
        }catch(err){note.textContent=err.message;send.disabled=!permitted;}
      };
    }catch(err){if(serial===selection){box.replaceChildren(el("p",err.message),btn("Retry",()=>show(id)));}}
    finally{if(serial===selection)box.removeAttribute("aria-busy");}
  }
  get("conv-search").oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>load(true),200);};
  get("conv-queue").onchange=()=>load(true);get("conv-prev").onclick=()=>{offset=Math.max(0,offset-50);load();};get("conv-next").onclick=()=>{offset+=50;load();};
  return {load,show};
})();
