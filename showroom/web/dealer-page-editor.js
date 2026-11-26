(() => {
  "use strict";
  const $=id=>document.getElementById(id), form=$("pageEditor"), fields=form.elements;
  const status=$("pageSaveStatus"), dialog=$("pageReviewDialog"), buffer=new Map(), liveIndex=new Map();
  let active="", doc, generation=0, busy=false, conflicted=false;
  const catalog=()=>window.DealerPages.defaults;
  const control=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
  const read=()=>({title:fields.title.value,body:fields.body.value,url:fields.url.value,enabled:fields.enabled.checked});
  const equal=(first,second)=>["title","body","url","enabled"].every(key=>first[key]===second[key]);
  const saved=()=>doc.draft?.values||doc.live;
  const dirty=()=>doc && !equal(read(),saved());
  const date=value=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
  function remember(){
    if(!doc)return;
    if(dirty())buffer.set(active,{version:doc.version,values:read()});
    else buffer.delete(active);
  }
  function redrawIndex(){
    const index=$("pageIndex"), filter=$("pageFilter").value.trim().toLowerCase();
    const grouped=new Map(), current=DealerPages.list();
    for(const base of catalog()){
      const live=liveIndex.get(base.key)||current.find(p=>p.key===base.key);
      if(![base.group,base.title,live.title,base.path].join(" ").toLowerCase().includes(filter))continue;
      if(!grouped.has(base.group))grouped.set(base.group,[]);
      grouped.get(base.group).push({key:base.key,live});
    }
    index.replaceChildren();
    for(const [group,pages] of grouped){
      const section=document.createElement("section");section.append(control("h3",group));
      for(const {key,live} of pages){
        const button=document.createElement("button");button.type="button";button.dataset.page=key;
        button.setAttribute("aria-pressed",String(key===active));
        button.append(control("span",live.title),control("small",live.enabled?"Live":"Hidden"));section.append(button);
      }
      index.append(section);
    }
    if(!grouped.size)index.append(control("p","No matching pages."));
  }
  const missingContent=()=>doc.requiresBody && fields.enabled.checked && !fields.body.value.trim();
  function updateControls(){
    if(!doc)return;
    $("pageControls").disabled=busy;
    $("savePageDraft").disabled=conflicted || (!dirty() && !doc.draft?.stale);
    $("discardPage").disabled=!dirty() && !doc.draft;
    $("discardPage").textContent=dirty()?"Undo unsaved edits":"Discard saved draft";
    $("pageRefresh").hidden=!conflicted;
    $("publishPage").disabled=busy||dirty()||conflicted||!doc.draft||doc.draft.stale||missingContent();
    $("pageRevisions").querySelectorAll("button").forEach(button=>button.disabled=busy||conflicted||!!dirty());
  }
  function fill(values){
    for(const field of ["title","body","url"])fields[field].value=values[field];
    fields.enabled.checked=values.enabled;
  }
  function renderHistory(){
    const list=$("pageRevisions");list.replaceChildren();$("pageHistory").hidden=false;
    if(!doc.history.length)list.append(control("p","Published versions will appear here after your first change."));
    for(const r of doc.history){
      const row=document.createElement("article"),caption=document.createElement("div");
      caption.append(control("strong",r.title),control("small","Version "+r.edition+" · "+date(r.at)+" · "+r.actor));
      const restore=control("button","Use as draft");restore.type="button";restore.className="quiet";
      restore.onclick=()=>act("restore",{edition:r.edition});row.append(caption,restore);list.append(row);
    }
  }
  async function openPage(key,message=""){
    const n=++generation;active=key;doc=null;conflicted=false;
    form.hidden=true;$("pageHistory").hidden=true;$("pageRefresh").hidden=true;$("pagePreview").hidden=true;
    const item=catalog().find(p=>p.key===key);
    $("pageEditHeading").textContent=item.title;$("pageRoute").textContent=item.group+" · "+item.path;
    status.textContent="Loading page…";redrawIndex();
    try{
      const response=await readDealerDesk("/api/website-pages?key="+encodeURIComponent(key),{cache:"no-store"});
      if(!response.ok)throw Error(response.status===403?"Sign in to your dealership to edit pages.":"Could not load this page.");
      const result=await response.json();if(n!==generation)return;
      doc=result;liveIndex.set(key,{title:doc.live.title,enabled:doc.visible});
      const edits=buffer.get(key);conflicted=!!edits && edits.version!==doc.version;
      fill(edits?.values||saved());form.hidden=false;
      $("pageEditHeading").textContent=doc.live.title;$("pagePreview").href=DealerPages.href(key);$("pagePreview").hidden=!doc.visible;
      $("pageLiveState").textContent=doc.visible?"Public page":"Hidden from shoppers";
      $("pageDraftState").textContent=doc.draft?"Draft saved "+date(doc.draft.at):"No saved draft";
      renderHistory();updateControls();redrawIndex();
      status.textContent=conflicted?"Your unsaved text is preserved. Copy it before reloading the changed page.":message||
        (doc.draft?.stale?"The live content changed. Review both versions and save the draft again.":edits?"Unsaved changes":"");
    }catch(error){
      if(n===generation){status.textContent=error.message;$("pageRefresh").hidden=false;}
    }
  }
  async function act(action,extra={}){
    if(busy||!doc||conflicted)return;
    const key=active;busy=true;updateControls();
    const message={draft:"Draft saved. Your live page is unchanged.",restore:"Revision loaded as a draft. Review it before publishing.",discard:"Saved draft discarded.",publish:"Changes published."}[action];
    try{
      const response=await fetch("/api/website-pages?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action,version:doc.version,...extra})});
      const result=await response.json();
      if(!response.ok){if(response.status===409)conflicted=true;throw Error(result.error||"Could not save this change.");}
      buffer.delete(key);if(dialog.open)dialog.close();
      if(action==="publish")await Store.loadProfile().catch(()=>{});
      await openPage(key,message);
    }catch(error){status.textContent=error.message;$("pageReviewStatus").textContent=error.message;}
    finally{busy=false;updateControls();}
  }
  function preview(box,values,isLive=false){
    const visibility=isLive?(doc.visible?"Visible to shoppers":"Hidden from shoppers"):
      !values.enabled?"Hidden from shoppers":missingContent()?"Page text required to publish":!doc.allowsPage?"Hidden while APR financing is disabled":"Visible when published";
    box.replaceChildren(control("small",visibility),
      control("h4",values.title),control("p",values.body||"No page text."));
    if(values.url)box.append(control("small","Action destination"),control("p",values.url));
  }
  $("reviewPage").onclick=()=>{
    preview($("pageBefore"),doc.live,true);preview($("pageAfter"),read());updateControls();
    $("pageReviewStatus").textContent=missingContent()?"Add page content before publishing this page.":dirty()?"Save your edits as a draft before publishing.":doc.draft?.stale?"Save the reviewed draft again before publishing.":doc.draft?"Publishing applies this saved draft to your dealership website.":"There is no draft to publish.";
    dialog.showModal();
  };
  $("closePageReview").onclick=()=>dialog.close();
  $("publishPage").onclick=()=>act("publish");
  $("pageRefresh").onclick=()=>{if(!busy){buffer.delete(active);openPage(active);}};
  $("pageFilter").oninput=redrawIndex;
  $("pageIndex").onclick=event=>{const button=event.target.closest("[data-page]");if(!button||busy||button.dataset.page===active)return;remember();openPage(button.dataset.page);};
  $("discardPage").onclick=()=>{if(dirty()){fill(saved());buffer.delete(active);status.textContent="Unsaved edits cleared.";updateControls();}else act("discard");};
  form.oninput=()=>{status.textContent="Unsaved changes";updateControls();};
  form.onsubmit=e=>{e.preventDefault();act("draft",{values:read()});};
  document.querySelector('[data-view="pages"]').addEventListener("click",async()=>{
    await Store.profileReady;if(busy)return;remember();openPage(active||catalog()[0].key);
  });
})();
