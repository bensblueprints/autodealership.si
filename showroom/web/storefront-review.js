(() => {
  const byId=id=>document.getElementById("store-review-"+id);
  const run=byId("run"),history=byId("history"),body=byId("body"),status=byId("status");
  const api="api/storefront-reports";
  let version=0,busy=false,requestId;
  const element=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
  const date=(value,zone)=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"medium",timeZone:zone});
  function show({id,at,report}){
    body.hidden=false;history.value=id;
    byId("meta").textContent=report.store+" · "+DealerSitePages.templates[report.template].label+" · Times in "+report.timezone.replaceAll("_"," ");
    byId("download").href=api+"?id="+encodeURIComponent(id)+"&download=1";
    const c=report.coverage,coverage=byId("coverage");
    coverage.replaceChildren();
    for(const [label,value] of [["Published pages",c.publishedPages],["Pages with sources",c.sourcedPages],["Live offers",c.liveOffers+" / "+c.currentOffers],["Visible slides",c.visibleBanners+" / "+c.enabledSlides],...(report.brandMarks?.length?[["Manufacturer marks",report.brandMarks.filter(m=>m.state==="Published").length+" / "+report.brandMarks.length]]:[])]){
      const item=element("div","");item.append(element("dt",label),element("dd",value));coverage.append(item);
    }
    const findings=byId("findings");findings.replaceChildren();
    if(!report.findings.length){
      findings.append(element("p",c.sourcedPages||c.currentOffers||c.enabledSlides||report.brandMarks?.length?"No issues found in the checked placements.":"No sourced page copy, current website offers or enabled slides to check."));
      return;
    }
    for(const [level,title] of [["attention","Needs attention"],["upcoming","Expires within 14 days"]]){
      const matches=report.findings.filter(f=>f.level===level);if(!matches.length)continue;
      const group=element("section",""),list=element("ul","");
      group.dataset.level=level;group.append(element("h4",title+" ("+matches.length+")"),list);
      for(const f of matches){
        const item=element("li",""),copy=element("div",""),a=element("a",{page:"Review page",offer:"Review program",banner:"Review banners",brand:"Review artwork"}[f.kind]);
        const link=new URL(location.href);link.search="";link.hash={page:"pages",offer:"oem",banner:"banners",brand:"oem"}[f.kind];
        if(f.kind!=="banner")link.searchParams.set(f.kind==="page"?"page":f.kind==="brand"?"brand":"program",f.key);
        a.href=link.href;a.target="_blank";a.rel="noopener";
        copy.append(element("strong",f.title),element("p",f.description));
        if(f.expiresAt)copy.append(element("small","Ends "+date(f.expiresAt,report.timezone)));
        item.append(copy,a);list.append(item);
      }
      findings.append(group);
    }
  }
  async function read(url){
    const r=await readDealerDesk(url,{cache:"no-store"});
    if(!r.ok)throw Error(r.status===403?"Sign in to view this dealership’s reports.":"Could not load the saved report.");
    return r.json();
  }
  async function load(preferred){
    const serial=++version;
    try{
      const {reports,latest}=await read(api);if(serial!==version)return;
      history.replaceChildren(...reports.map(row=>new Option(date(row.at,latest.report.timezone)+" · "+row.source,row.id)));
      if(!latest){body.hidden=true;status.textContent="Run the first check to save a report for this dealership.";return;}
      show(preferred && reports.some(row=>row.id===preferred.id)?preferred:latest);status.textContent="";
    }catch(error){if(serial===version){body.hidden=true;status.textContent=error.message;}}
  }
  history.onchange=async()=>{
    const serial=++version;status.textContent="Loading report…";
    try{const row=await read(api+"?id="+encodeURIComponent(history.value));if(serial===version){show(row);status.textContent="";}}
    catch(error){if(serial===version){status.textContent=error.message;body.hidden=true;}}
  };
  run.onclick=async()=>{
    if(busy)return;busy=run.disabled=true;history.disabled=true;++version;status.textContent="Checking storefront placements…";
    try{
      requestId??=crypto.randomUUID();
      const response=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:requestId})});
      const row=await response.json();if(!response.ok)throw Error(row.error||"Could not save the report.");
      requestId=null;await load(row);
    }catch(error){status.textContent=error.message+" Retry the check.";}
    finally{busy=run.disabled=false;history.disabled=false;}
  };
  document.querySelector('[data-view="oem"]').addEventListener("click",()=>{if(!busy)load();});
})();
