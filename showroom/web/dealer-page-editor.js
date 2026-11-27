(() => {
  "use strict";
  const $=id=>document.getElementById(id), form=$("pageEditor"), fields=form.elements;
  const status=$("pageSaveStatus"), dialog=$("pageReviewDialog"), buffer=new Map(), liveIndex=new Map();
  let active="", doc, generation=0, busy=false, conflicted=false;
  const catalog=()=>window.DealerPages.defaults;
  const control=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text});
  const blockList=$("pageBlockList"),blockKind=$("pageBlockType");
  const readBlocks=()=>Array.from(blockList.children,row=>({kind:row.dataset.kind,heading:row.querySelector("input").value,text:row.querySelector("textarea").value}));
  const read=()=>({title:fields.title.value,body:fields.body.value,url:fields.url.value,enabled:fields.enabled.checked,blocks:readBlocks()});
  const blockOrder=values=>JSON.stringify((values.blocks||[]).map(b=>[b.kind,b.heading,b.text]));
  const equal=(first,second)=>["title","body","url","enabled"].every(key=>first[key]===second[key]) && blockOrder(first)===blockOrder(second);
  function blockField(label,tag,value,max){
    const wrap=control("label",label),input=document.createElement(tag);input.value=value;input.maxLength=max;
    if(tag==="textarea")input.rows=3;wrap.append(input);return wrap;
  }
  function blockRow({kind,heading="",text=""}){
    const row=document.createElement("fieldset");row.className="page-block-row";row.dataset.kind=kind;
    const legend=control("legend",DealerSitePages.blockKinds[kind]),actions=document.createElement("div");
    for(const [action,label] of [["up","Move up"],["down","Move down"],["remove","Remove"]]){
      const button=control("button",label);button.type="button";button.dataset.action=action;button.className="quiet";actions.append(button);
    }
    actions.className="page-block-order";
    row.append(legend,blockField(kind==="question"?"Question":"Heading","input",heading,160),
      blockField(kind==="question"?"Answer":kind==="checklist"?"Items (one per line)":"Paragraphs","textarea",text,3000),actions);
    return row;
  }
  function updateBlocks(locked){
    const rows=Array.from(blockList.children);
    blockKind.disabled=locked;$("addPageBlock").disabled=locked || rows.length>=12;
    rows.forEach((row,i)=>{
      row.disabled=locked;
      row.querySelector("legend").textContent=(i+1)+". "+DealerSitePages.blockKinds[row.dataset.kind];
      row.querySelector('[data-action="up"]').disabled=i===0;row.querySelector('[data-action="down"]').disabled=i===rows.length-1;
    });
  }
  $("addPageBlock").onclick=()=>{
    const row=blockRow({kind:blockKind.value});blockList.append(row);form.dispatchEvent(new Event("input"));row.querySelector("input").focus();
    $("pageBlockStatus").textContent="Added "+DealerSitePages.blockKinds[row.dataset.kind].toLowerCase()+".";
  };
  blockList.onclick=e=>{
    const button=e.target.closest("button[data-action]");if(!button)return;
    const row=button.closest(".page-block-row");let focusTarget=row;
    if(button.dataset.action==="up" && row.previousElementSibling)blockList.insertBefore(row,row.previousElementSibling);
    if(button.dataset.action==="down" && row.nextElementSibling)blockList.insertBefore(row.nextElementSibling,row);
    if(button.dataset.action==="remove"){focusTarget=row.nextElementSibling||row.previousElementSibling;row.remove();}
    form.dispatchEvent(new Event("input"));(focusTarget?.querySelector("input")||$("addPageBlock")).focus();
    $("pageBlockStatus").textContent=button.dataset.action==="remove"?"Block removed.":"Block order updated.";
  };
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
  let queueRead=0;
  async function refreshQueue(){
    const n=++queueRead, box=$("pageQueueItems");
    try{
      const response=await readDealerDesk("/api/website-pages?view=review-queue",{cache:"no-store"});
      if(!response.ok)throw Error();
      const data=await response.json();if(n!==queueRead)return;
      box.replaceChildren();
      for(const item of data.pages){
        const button=control("button","");button.type="button";button.dataset.reviewKey=item.key;
        button.append(control("strong",item.title),control("small",(item.state==="pending"?"Awaiting review":"Changes requested")+" · "+date(item.at)));
        box.append(button);
      }
      if(!data.pages.length)box.append(control("p","No pages waiting for review or revision."));
    }catch{if(n===queueRead)box.textContent="Review queue unavailable. Reopen Website pages to retry.";}
  }
  $("refreshPageQueue").onclick=refreshQueue;
  $("pageQueueItems").onclick=e=>{
    const button=e.target.closest("[data-review-key]");if(!button||busy)return;
    remember();openPage(button.dataset.reviewKey);
  };
  const missingContent=()=>{
    const blocks=readBlocks();return blocks.some(b=>!b.heading.trim()||!b.text.trim()) || (doc.requiresBody && fields.enabled.checked && !fields.body.value.trim() && !blocks.length);
  };
  function updateControls(){
    if(!doc)return;
    $("pageControls").disabled=busy;
    const pending=doc.review?.state==="pending", returned=doc.review?.state==="returned", governed=doc.franchise||pending;
    for(const k of ["title","body","url"])fields[k].readOnly=pending;
    fields.enabled.disabled=pending;
    updateBlocks(pending||busy);
    $("savePageDraft").disabled=pending||conflicted || (!dirty() && !doc.draft?.stale);
    $("discardPage").hidden=pending;
    $("submitPage").hidden=pending || (doc.franchise && doc.manager && !returned);
    $("submitPage").disabled=busy||dirty()||conflicted||!doc.draft||doc.draft.stale||returned||missingContent();
    $("withdrawPage").hidden=!doc.canWithdraw;
    $("pageCheckWrap").hidden=!(governed && doc.manager && doc.draft);
    $("pageReturnWrap").hidden=!(pending && doc.manager);
    $("returnPage").disabled=busy||conflicted||!$("pageReturnNote").value.trim();
    $("publishPage").hidden=governed && !doc.manager;
    $("publishPage").textContent=governed?"Approve and publish":"Publish saved draft";
    $("discardPage").disabled=!dirty() && !doc.draft;
    $("discardPage").textContent=dirty()?"Undo unsaved edits":"Discard saved draft";
    $("pageRefresh").hidden=!conflicted;
    $("publishPage").disabled=(governed && (!doc.manager || !$("pageChecked").checked))||returned||busy||dirty()||conflicted||!doc.draft||doc.draft.stale||missingContent();
    $("pageRevisions").querySelectorAll("button").forEach(button=>button.disabled=pending||busy||conflicted||!!dirty());
  }
  function fill(values){
    for(const field of ["title","body","url"])fields[field].value=values[field];
    fields.enabled.checked=values.enabled;blockList.replaceChildren(...(values.blocks||[]).map(blockRow));$("pageBlockStatus").textContent="";
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
    form.hidden=true;$("pageHistory").hidden=true;$("pageDecisions").hidden=true;$("pageRefresh").hidden=true;$("pagePreview").hidden=true;
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
      $("pageDecision").hidden=!doc.franchise && !["pending","returned"].includes(doc.review?.state);
      $("pageDecision").textContent=doc.review?.state==="pending"?"Awaiting manager review · Requested by "+doc.review.by:
        doc.review?.state==="returned"?"Changes requested by "+doc.review.by+" · "+doc.review.note:
        doc.franchise?"A dealership administrator reviews and publishes franchise pages.":"";
      $("pageChecked").checked=false;$("pageReturnNote").value="";
      const log=$("pageDecisionsList");log.replaceChildren();$("pageDecisions").hidden=!doc.events?.length;
      const verbs={submit:"Requested review",withdraw:"Withdrew request",return:"Requested changes",approve:"Approved and published",publish:"Published"};
      for(const event of doc.events||[]){
        const item=control("article",""),caption=control("div","");
        caption.append(control("strong",verbs[event.action]||event.action),control("small",event.actor+" · "+date(event.at)+(event.edition?" · Version "+event.edition:"")));
        if(event.note)caption.append(control("p",event.note));item.append(caption);log.append(item);
      }
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
    const message={draft:"Draft saved. Your live page is unchanged.",restore:"Revision loaded as a draft. Review it before publishing.",discard:"Saved draft discarded.",publish:"Changes published.",submit:"Page sent for manager review.",withdraw:"Review request withdrawn.",return:"Draft returned to the editor."}[action];
    try{
      const response=await fetch("/api/website-pages?key="+encodeURIComponent(key),{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action,version:doc.version,...extra})});
      const result=await response.json();
      if(!response.ok){if(response.status===409)conflicted=true;throw Error(result.error||"Could not save this change.");}
      buffer.delete(key);if(dialog.open)dialog.close();
      if(action==="publish")await Store.loadProfile().catch(()=>{});
      await Promise.all([openPage(key,message),refreshQueue()]);
    }catch(error){status.textContent=error.message;$("pageReviewStatus").textContent=error.message;}
    finally{busy=false;updateControls();}
  }
  function preview(box,values,isLive=false){
    const visibility=isLive?(doc.visible?"Visible to shoppers":"Hidden from shoppers"):
      !values.enabled?"Hidden from shoppers":missingContent()?"Page text required to publish":!doc.allowsPage?"Hidden while APR financing is disabled":"Visible when published";
    box.replaceChildren(control("small",visibility),
      control("h4",values.title));
    if(values.body)box.append(control("p",values.body));
    if(values.blocks?.length){
      const blocks=document.createElement("div");blocks.className="page-block-preview";
      for(const b of values.blocks){
        const section=document.createElement("section");section.append(control("small",DealerSitePages.blockKinds[b.kind]),control("strong",b.heading||"Heading required"),control("p",b.text||"Text required"));blocks.append(section);
      }
      box.append(blocks);
    }
    if(values.url)box.append(control("small","Action destination"),control("p",values.url));
  }
  $("reviewPage").onclick=()=>{
    preview($("pageBefore"),doc.live,true);preview($("pageAfter"),read());updateControls();
    $("pageReviewStatus").textContent=missingContent()?"Add page content and finish any incomplete blocks before publishing.":dirty()?"Save your edits as a draft before publishing.":doc.draft?.stale?"Save the reviewed draft again before publishing.":doc.draft?"Publishing applies this saved draft to your dealership website.":"There is no draft to publish.";
    if(doc.review?.state==="pending")$("pageReviewStatus").textContent=doc.manager?"Approve the saved draft or return it with a note.":"This saved draft is awaiting a dealership administrator.";
    else if(doc.review?.state==="returned")$("pageReviewStatus").textContent="Revise the draft to address the manager’s note.";
    else if(doc.franchise && !doc.manager && doc.draft)$("pageReviewStatus").textContent="Request manager review from the editor after saving your draft.";
    $("pageChecked").checked=false;$("pageReturnNote").value="";updateControls();dialog.showModal();
  };
  $("closePageReview").onclick=()=>dialog.close();
  $("publishPage").onclick=()=>act("publish",{checked:$("pageChecked").checked});
  $("pageChecked").onchange=updateControls;$("pageReturnNote").oninput=updateControls;
  $("submitPage").onclick=()=>act("submit");$("withdrawPage").onclick=()=>act("withdraw");
  $("returnPage").onclick=()=>act("return",{note:$("pageReturnNote").value.trim()});
  $("exportPageReview").onclick=async()=>{
    const key=active,button=$("exportPageReview");button.disabled=true;
    try{
      const r=await readDealerDesk("/api/website-pages?key="+encodeURIComponent(key)+"&export=review-history",{cache:"no-store"});
      if(!r.ok)throw Error();
      const url=URL.createObjectURL(new Blob([JSON.stringify(await r.json(),null,2)],{type:"application/json"}));
      const a=document.createElement("a");a.href=url;a.download=key+"-page-review.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch{status.textContent="Could not download the page review record.";}finally{button.disabled=false;}
  };
  $("pageRefresh").onclick=()=>{if(!busy){buffer.delete(active);refreshQueue();openPage(active);}};
  $("pageFilter").oninput=redrawIndex;
  $("pageIndex").onclick=event=>{const button=event.target.closest("[data-page]");if(!button||busy||button.dataset.page===active)return;remember();openPage(button.dataset.page);};
  $("discardPage").onclick=()=>{if(dirty()){fill(saved());buffer.delete(active);status.textContent="Unsaved edits cleared.";updateControls();}else act("discard");};
  form.oninput=()=>{status.textContent="Unsaved changes";updateControls();};
  form.onsubmit=e=>{e.preventDefault();act("draft",{values:read()});};
  document.querySelector('[data-view="pages"]').addEventListener("click",async()=>{
    await Store.profileReady;if(busy)return;remember();refreshQueue();openPage(active||catalog()[0].key);
  });
})();
