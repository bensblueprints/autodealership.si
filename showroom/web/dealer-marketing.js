(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const dialog = byId("campaign-dialog"), form = byId("campaign-form"), fields = form.elements;
  const status = byId("marketing-status"), feedback = byId("campaign-result");
  const endpoint = "api/dealer-marketing";
  const states = {draft:"Draft",review:"Awaiting review",changes:"Changes requested",approved:"Approved copy"};
  const decisions = {save:"Draft saved",submit:"Submitted for review",approve:"Copy approved",return:"Changes requested"};
  let excluded=[],feedPage=0;
  function renderFeedIssues(){
    const query=byId("feed-query").value.trim().toLowerCase(),size=25;
    const matches=excluded.filter(row=>[row.vin,row.stock,...row.issues].join(" ").toLowerCase().includes(query));
    const start=feedPage*size,end=Math.min(start+size,matches.length);
    byId("feed-issues").replaceChildren(...matches.slice(start,end).map(row=>{
      const item=node("li",""),link=node("button",row.stock||row.vin);
      link.type="button";link.setAttribute("aria-label","Find "+row.vin+" in inventory");
      link.onclick=()=>{
        document.querySelector('[data-view="inventory"]').click();
        const search=byId("inventorySearch");search.value=row.vin;search.dispatchEvent(new Event("input"));search.focus();
      };
      item.append(link,node("span",row.issues.join(" · ")));return item;
    }));
    byId("feed-range").textContent=matches.length?(start+1)+"–"+end+" of "+matches.length:"No matching vehicles";
    byId("feed-prev").disabled=feedPage===0;byId("feed-next").disabled=end>=matches.length;
  }
  byId("feed-query").addEventListener("input",()=>{feedPage=0;renderFeedIssues();});
  byId("feed-prev").onclick=()=>{feedPage--;renderFeedIssues();};
  byId("feed-next").onclick=()=>{feedPage++;renderFeedIssues();};
  let data, active, loading = 0, feedRequest = 0, busy = false;
  const node = (tag, value) => Object.assign(document.createElement(tag), {textContent:value});
  function brief() {
    return {name:fields.namedItem("name").value.trim(), program:fields.program.value,channel:fields.channel.value,
      market:fields.market.value.trim(),monthlyCents:Math.round(Number(fields.budget.value)*100),origin:fields.origin.value,
      landingPath:fields.landingPath.value.trim(),copy:fields.copy.value.trim(),evidence:fields.evidence.value.trim()};
  }
  function buttons() {
    const review = active.state === "review", reviewer = review && data.canReview;
    byId("campaign-fields").disabled = busy || review;
    byId("campaign-review").hidden = !reviewer;
    byId("campaign-save").hidden = review;
    byId("campaign-submit").hidden = !["draft","changes"].includes(active.state) || active.revision===0;
    byId("campaign-approve").hidden = byId("campaign-return").hidden = !reviewer;
    for (const button of form.querySelectorAll("button")) button.disabled = busy;
    byId("campaign-submit").disabled = busy || Object.entries(brief()).some(([k,v]) => active.brief[k] !== v);
  }
  function open(row) {
    active = row || {id:crypto.randomUUID(),revision:0,state:"draft",brief:{}};
    form.reset();
    for (const [key, options] of [["channel",data.channels],["program",data.programs]]) {
      fields[key].replaceChildren(...options.map(value => new Option(value,value)));
    }
    fields.landingPath.value = "/inventory/";
    fields.budget.value = "0";
    for (const [key, value] of Object.entries(active.brief)) {
      if (key==="monthlyCents") fields.budget.value = (value/100).toFixed(2);
      else if (fields.namedItem(key)) fields.namedItem(key).value = value;
    }
    byId("campaign-heading").textContent = row ? states[row.state] : "New campaign";
    byId("campaign-history").hidden = !row;
    byId("campaign-history").open = false;
    byId("campaign-log").replaceChildren();
    feedback.textContent = row?.latest?.note || (row?.state==="approved" ? "Saving edits creates a new draft for review." : "");
    buttons();
    dialog.showModal();
  }
  function render() {
    for(const key of ["attended","missed","unrecorded","canceled"])byId("visits-"+key).textContent=data.report.visits?.[key]??"—";
    byId("marketing-inquiries").textContent = data.report.inquiries;
    byId("marketing-bookings").textContent = data.report.bookings;
    byId("booking-channels").textContent = data.report.concierge_bookings+" booked through the concierge";
    const list = byId("marketing-list");
    list.replaceChildren();
    if (!data.campaigns.length) list.append(node("p","Create a campaign to plan its budget and send its copy for review."));
    for (const campaign of data.campaigns) {
      const card = node("article",""), content = node("div","");
      const budget = (campaign.brief.monthlyCents/100).toLocaleString("en-US",{style:"currency",currency:"USD"});
      content.append(node("strong",campaign.brief.name),node("p",campaign.brief.channel+" · "+campaign.brief.program+" · "+budget+"/month"),node("small",states[campaign.state]+" · Revision "+campaign.revision));
      const button = node("button",campaign.state==="review" && data.canReview ? "Review campaign" : "Open campaign");
      button.type = "button";
      button.addEventListener("click",()=>open(campaign));
      card.append(content,button);
      list.append(card);
    }
    byId("marketing-work").hidden = false;
  }
  async function load(message="") {
    const version = ++loading;
    status.textContent = "Loading campaigns…";
    try {
      const response = await window.readDealerDesk(endpoint,{cache:"no-store"});
      if (!response.ok) throw Error(response.status===403 ? "Sign in to open this dealership’s marketing workspace." : "Could not load marketing. Select Refresh to retry.");
      const result = await response.json();
      if (version!==loading) return;
      data = result;
      render();
      loadFeed(version);
      status.textContent = message;
    } catch (error) {
      if (version!==loading) return;
      byId("marketing-work").hidden = true;
      status.textContent = message ? message+" "+error.message : error.message;
    }
  }
  async function loadFeed(version) {
    const request=++feedRequest;
    const summary=byId("feed-summary"), address=byId("feed-address"), diagnostics=byId("feed-diagnostics");
    address.hidden=diagnostics.hidden=true;summary.textContent="Checking inventory…";
    try{
      const response=await window.readDealerDesk("api/vehicle-feed-status",{cache:"no-store"});
      if(!response.ok)throw Error();
      const feed=await response.json();
      if(version!==loading || request!==feedRequest)return;
      const availability=feed.enabled?"Feed enabled":!feed.supportedCountry?"The vehicle feed supports U.S. dealerships":!feed.storeCode?"Add your Google store code to enable the feed":"Enable public cash pricing to publish the feed";
      summary.textContent=availability+" · "+feed.eligible+" of "+feed.available+" inventory records meet the listing checks.";
      if(feed.enabled){byId("feed-url").value=feed.url;address.hidden=false;}
      diagnostics.hidden=!feed.excluded.length;
      byId("feed-reasons").textContent=feed.excluded.length+" vehicles need attention";
      excluded=feed.excluded;feedPage=0;renderFeedIssues();
    }catch{if(version===loading && request===feedRequest)summary.textContent="Could not check the feed. Select Refresh to retry.";}
  }
  byId("feed-settings").addEventListener("click",()=>byId("brandSettings").click());
  byId("settings").addEventListener("close",()=>{if(!byId("marketing").hidden)loadFeed(loading);});
  byId("feed-url").addEventListener("focus",event=>event.target.select());
  async function act(action) {
    if (busy || (action==="save" && !form.reportValidity())) return;
    const input = {id:active.id,revision:active.revision,action,brief:brief(),verified:fields.verified.checked,note:fields.note.value};
    busy = true;
    buttons();
    feedback.textContent = "Saving…";
    try {
      const response = await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Unable to save this change.");
      dialog.close();
      await load({save:"Campaign draft saved.",submit:"Campaign submitted for review.",approve:"Copy approved. Ad delivery requires a connected account and a separate launch.",return:"Campaign returned to its author."}[action]);
    } catch (error) { feedback.textContent = error.message; }
    finally { busy = false; buttons(); }
  }
  form.addEventListener("submit",event=>{event.preventDefault();act("save");});
  form.addEventListener("input",buttons);
  dialog.addEventListener("cancel",event=>{if(busy)event.preventDefault();});
  byId("campaign-close").addEventListener("click",()=>dialog.close());
  byId("campaign-history").addEventListener("toggle",async event=>{
    if(!event.target.open) return;
    const id = active.id, log = byId("campaign-log");
    log.textContent = "Loading review history…";
    try {
      const response = await window.readDealerDesk(endpoint+"?history="+encodeURIComponent(id),{cache:"no-store"});
      if(!response.ok) throw Error();
      const entries = await response.json();
      if(active.id!==id) return;
      log.replaceChildren();
      for(const entry of entries.reverse()) {
        const detail = node("details","");
        detail.append(node("summary",decisions[entry.action]+" · Revision "+entry.revision),node("p",entry.actor+" · "+new Date(entry.at).toLocaleString()));
        if(entry.note) detail.append(node("p",entry.note));
        if(entry.brief) detail.append(node("p",entry.brief.copy),node("p","Sources: "+entry.brief.evidence));
        log.append(detail);
      }
    } catch { if(active.id===id)log.textContent = "Could not load the history. Reopen to retry."; }
  });
  for(const action of ["submit","approve","return"]) byId("campaign-"+action).addEventListener("click",()=>act(action));
  document.querySelector('[data-view="marketing"]').addEventListener("click",()=>load());
  byId("marketing-new").addEventListener("click",()=>open());
  byId("marketing-reload").addEventListener("click",()=>load());
})();
