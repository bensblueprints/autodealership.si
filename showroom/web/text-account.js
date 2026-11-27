const TextAccount=(()=>{
  const get=id=>document.getElementById(id), endpoint="/api/text-account";
  const month=get("text-month"),info=get("text-account-error"),discover=get("text-discover"),refresh=get("text-reconcile"),available=get("text-available");
  month.value=new Date().toISOString().slice(0,7);
  const money=(n,c="USD")=>new Intl.NumberFormat(undefined,{style:"currency",currency:c,minimumFractionDigits:2,maximumFractionDigits:5}).format(n);
  const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
  let sequence=0;
  async function call(action,sid){
    const r=action?await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,sid})}):
      await readDealerDesk(endpoint+"?month="+encodeURIComponent(month.value),{cache:"no-store"});
    const result=await r.json();if(!r.ok)throw Error(result.error||"Could not load usage.");return result;
  }
  async function load(){
    const request=++sequence;
    try{
      const v=await call();if(request!==sequence)return;
      info.textContent="";discover.hidden=refresh.hidden=!v.connected;

      const numbers=[...new Set([v.primary,...v.numbers.map(n=>n.phone)].filter(Boolean))];
      get("text-route-info").textContent=v.connected?(numbers.length?numbers.join(" · "):"No numbers imported.")+" Incoming SMS webhook: "+v.webhook:
        "Your platform administrator can connect a Twilio subaccount for this dealership.";
      get("text-totals").textContent=v.messages+" messages · "+v.eligible+" eligible SMS segments · "+v.pending+" awaiting segment counts";
      get("text-cost-info").textContent="Twilio message cost on file: "+money(v.usd_cost)+". "+v.pending_cost+" records await USD pricing. Separate carrier, number and registration fees appear on the Twilio invoice. This usage report does not charge the dealer.";
      const forecast=get("text-retail-preview");
      const covered=Math.min(v.eligible,500),over=Math.max(0,v.eligible-covered);
      forecast.textContent="Pilot pricing preview: "+covered+" of 500 included segments used. "+over+" additional segments at $0.04 = "+money(over*0.04)+". Based on provider records for the selected calendar month.";
      const wrap=get("text-usage-lines");wrap.replaceChildren();
      if(!v.lines.length){wrap.append(node("p","No text messages recorded this month."));return;}
      const table=document.createElement("table"),head=table.createTHead().insertRow();
      for(const label of ["Time","Direction","Stock","Status","Segments","Twilio cost","Message SID"])head.append(node("th",label));
      const body=table.createTBody();
      for(const l of v.lines){
        const row=body.insertRow();
        for(const value of [new Date(l.created_at).toLocaleString(),l.direction==="in"?"Incoming":"Outgoing",l.stock||"—",l.status,l.segments??"Pending",l.cost!==null&&l.currency?money(l.cost,l.currency):"Pending",l.sid||"Awaiting provider"])row.insertCell().textContent=value;
      }
      wrap.append(table,node("small","Showing the latest 100 messages. Totals include the whole month."));
    }catch(e){if(request===sequence)info.textContent=e.message;}
  }
  async function action(button,fn){button.disabled=true;info.textContent="";try{await fn();}catch(e){info.textContent=e.message;}finally{button.disabled=false;}}
  discover.onclick=()=>action(discover,async()=>{
    const v=await call("list");available.replaceChildren();
    for(const line of v.numbers){
      const li=node("li",line.phone+" "),button=node("button","Import number");button.type="button";
      button.onclick=()=>action(button,async()=>{await call("import",line.sid);await load();li.textContent=line.phone+" · Imported";info.textContent="Number imported. Check the incoming webhook in the dealer’s Messaging Service.";});
      li.append(button);available.append(li);
    }
    if(!v.numbers.length)info.textContent="No SMS-capable numbers were found in this dealership’s Messaging Service.";
  });
  refresh.onclick=()=>action(refresh,async()=>{const result=await call("reconcile");await load();info.textContent=result.updated+" message records verified. "+(result.errors?result.errors+" records need another check.":"");});
  get("text-csv").onclick=()=>action(get("text-csv"),async()=>{
    const period=month.value;
    const response=await readDealerDesk(endpoint+"?format=csv&month="+encodeURIComponent(period),{cache:"no-store"});
    if(!response.ok || !response.headers.get("content-type")?.includes("text/csv"))throw Error("Could not download this report. Reopen your dealer session and try again.");
    const url=URL.createObjectURL(await response.blob()),link=document.createElement("a");
    link.href=url;link.download="sms-usage-"+period+".csv";document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  month.onchange=load;return {load};
})();
