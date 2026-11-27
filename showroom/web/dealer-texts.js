const DealerTexts=(()=>{
  const byId=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
  const when=date=>new Date(date).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  const labels={pending:"Awaiting provider confirmation",unconfirmed:"Awaiting provider confirmation",accepted:"Accepted by provider",queued:"Queued",sending:"Sending",sent:"Sent to carrier",delivered:"Delivered",undelivered:"Undelivered",failed:"Failed",canceled:"Canceled",received:"Received"};
  async function read(url){
    const res=await readDealerDesk(url,{cache:"no-store"});
    if(!res.ok)throw Error("Could not load texts. Check your dealer sign-in and try again.");
    return res.json();
  }
  async function post(url,method,data){
    const res=await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
    const result=await res.json();if(!res.ok)throw Error(result.error||"Could not save the reply.");return result;
  }
  const panel=byId("recent-texts"),recent=byId("recent-text-list");
  let listRequest=0;
  async function refreshRecent(){
    const serial=++listRequest;
    try{
      const {threads}=await read("/api/inquiries/texts");
      if(serial!==listRequest)return;
      recent.replaceChildren();
      if(!threads.length){recent.append(el("p","No text conversations yet."));return;}
      for(const row of threads){
        const button=el("button",undefined,"text-recent-row");button.type="button";
        button.append(el("strong",row.phone),el("span",(row.direction==="in"?"Shopper · ":"Dealer · ")+(row.body||"Media message")),el("small",when(row.created_at)));
        button.onclick=()=>open(null,button,row.id);recent.append(button);
      }
    }catch(err){if(serial===listRequest)recent.textContent=err.message;}
  }
  panel.ontoggle=()=>{if(panel.open)refreshRecent();};
  byId("refresh-text-list").onclick=refreshRecent;

  function open(lead,trigger,messageId){
    if(byId("text-conversation"))return;
    const modal=el("dialog");modal.id="text-conversation";modal.setAttribute("aria-labelledby","sms-title");
    modal.innerHTML='<div class="sms-head"><div><h2 id="sms-title">Text conversation</h2><p data-context></p></div><button type="button" data-close>Close</button></div><section class="sms-transcript" aria-label="Text messages"><div class="sms-subhead"><h3>Messages</h3><button type="button" data-refresh>Refresh</button></div><ol data-history></ol></section><p data-info></p><form hidden><label>Reply<textarea required rows="3" maxlength="1000"></textarea></label><div class="sms-actions"><button type="submit" class="primary" data-send>Send text</button><button type="button" data-save>Save draft</button></div></form><button type="button" data-find hidden>Find matching inquiries</button><p data-status role="status" aria-live="polite"></p>';
    const q=s=>modal.querySelector(s),status=q("[data-status]"),field=q("textarea"),send=q("[data-send]"),save=q("[data-save]");
    let revision=lead?.textDraft?.revision||"",savedText=lead?.textDraft?.text||"",thread=null,busy=false,readId=0;
    if(lead){
      const vehicle=[lead.car?.year,lead.car?.make,lead.car?.model].filter(Boolean).join(" ");
      q("[data-context]").textContent=[lead.name,lead.textReplyRequest.number,vehicle,lead.car?.stock && "Stock #"+lead.car.stock].filter(Boolean).join(" · ");
      field.value=savedText||"Hi "+lead.name+", this is "+Store.settings().dealerName+". Thanks for asking about the "+vehicle+(lead.car?.stock?" (stock "+lead.car.stock+")":"")+".";
    }
    const endpoint="/api/inquiries/texts?"+new URLSearchParams(lead?{id:lead.id}:{message:messageId});
    function controls(){
      const attempted=revision && savedText===field.value.trim() && thread?.messages.some(m=>m.id===revision);
      save.disabled=busy||!field.value.trim();send.disabled=busy||!thread||!!thread.reason||!!attempted||!field.value.trim();
      q("[data-refresh]").disabled=busy;field.disabled=busy;
      send.hidden=!!thread && !thread.from;
      if(lead)q("[data-info]").textContent=thread?.reason||(attempted?"An attempt is already recorded for this draft.":thread?.from?"Sending from "+thread.from:"");
    }
    function draw(){
      const list=q("[data-history]");list.replaceChildren();
      if(!thread.messages.length)list.append(el("li","No messages on this number yet.","sms-empty"));
      for(const m of thread.messages){
        const row=el("li",undefined,m.direction==="out"?"sms-out":"sms-in");
        row.append(el("strong",m.direction==="in"?"Shopper":m.actor||"Dealer"),el("p",m.body||"Media message"),el("small",[m.stock && "Stock #"+m.stock,labels[m.state]||m.state,when(m.created_at)].filter(Boolean).join(" · ")));
        list.append(row);
      }
      list.scrollTop=list.scrollHeight;
      if(!lead){q("[data-context]").textContent=thread.phone;q("[data-find]").hidden=false;}
      q("form").hidden=!lead;controls();
    }
    async function refresh(){
      const serial=++readId;
      try{const data=await read(endpoint);if(!modal.open || serial!==readId)return;thread=data;draw();}
      catch(e){if(serial===readId){thread=null;controls();status.textContent=e.message;}}
    }
    async function submit(deliver){
      if(busy||!field.reportValidity())return;
      busy=true;controls();status.textContent=deliver?"Submitting text…":"Saving draft…";
      try{
        if(!revision || savedText!==field.value.trim()){
          const draft=await post("/api/inquiries","PUT",{action:"save-text-draft",id:lead.id,text:field.value,revision});
          revision=draft.revision;savedText=draft.text;lead.textDraft=draft;
        }
        if(deliver){
          const result=await post("/api/inquiries/texts","POST",{id:lead.id,revision});
          status.textContent=labels[result.state]||"Message status updated.";
        }else status.textContent="Draft saved.";
        await Store.loadLeads();
      }catch(err){status.textContent=err.message;}
      finally{await refresh();busy=false;controls();if(panel.open)refreshRecent();}
    }
    q("form").onsubmit=e=>{e.preventDefault();if(!send.disabled)submit(true);};
    save.onclick=()=>submit(false);field.oninput=controls;q("[data-refresh]").onclick=refresh;
    q("[data-find]").onclick=()=>{if(!thread)return;byId("statusFilter").value="";byId("lead-queue").value="all";byId("lead-search").value=thread.phone;window.dispatchEvent(new Event("showroom:update"));modal.close();byId("lead-search").focus();};
    q("[data-close]").onclick=()=>modal.close();
    document.body.append(modal);modal.showModal();status.textContent="Loading conversation…";
    refresh().then(()=>{if(thread && status.textContent==="Loading conversation…")status.textContent="";});
    const timer=setInterval(()=>{if(!document.hidden && !busy)refresh();},30000);
    modal.onclose=()=>{clearInterval(timer);modal.remove();if(trigger?.isConnected && !byId("lead-search").matches(":focus"))trigger.focus();};
  }
  return {open};
})();
