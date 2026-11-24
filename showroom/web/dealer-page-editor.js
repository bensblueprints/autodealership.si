(() => {
  "use strict";
  const byId=id=>document.getElementById(id);
  const form=byId("pageEditor"), index=byId("pageIndex"),status=byId("pageSaveStatus");
  const fields=form.elements;
  const drafts=new Map();
  let active="",baseline=null,saving=false;
  const defaults=()=>window.DealerPages.defaults;
  function stored(key){
    const template=defaults().find(page=>page.key===key);
    const saved=Store.settings().pages?.[key] || {};
    return {title:saved.title??template.title,body:saved.body??template.body??"",enabled:saved.enabled??template.enabled??true,url:saved.url??template.url??""};
  }
  const read=()=>({title:fields.title.value,body:fields.body.value,url:fields.url.value,enabled:fields.enabled.checked});
  const equal=(a,b)=>["title","body","enabled","url"].every(key=>a[key]===b[key]);
  function remember(){
    if(!active)return;
    const draft=read();
    if(equal(draft,baseline))drafts.delete(active);
    else drafts.set(active,{values:draft,baseline});
  }
  function redrawIndex(){
    index.replaceChildren();
    const groups=new Map();
    for(const page of defaults()){
      if(!groups.has(page.group))groups.set(page.group,[]);
      groups.get(page.group).push(page);
    }
    for(const [group,pages] of groups){
      const section=document.createElement("section"),heading=document.createElement("h3");
      heading.textContent=group;section.append(heading);
      for(const item of pages){
        const saved=stored(item.key),button=document.createElement("button"),label=document.createElement("span"),state=document.createElement("small");
        button.type="button";button.dataset.page=item.key;button.setAttribute("aria-pressed",String(active===item.key));
        label.textContent=saved.title;state.textContent=saved.enabled?"Visible":"Hidden";button.append(label,state);section.append(button);
      }
      index.append(section);
    }
  }
  function select(key){
    active=key;
    const draft=drafts.get(key),values=draft?.values||stored(key);
    baseline=draft?.baseline||stored(key);
    for(const field of ["title","body","url"])fields[field].value=values[field];
    fields.enabled.checked=values.enabled;
    byId("pageEditHeading").textContent=stored(key).title;
    const preview=byId("pagePreview");preview.href="page.html?page="+encodeURIComponent(key);
    preview.hidden=!stored(key).enabled;
    status.textContent=draft?"Unsaved edits":"";
    form.hidden=false;redrawIndex();
  }
  document.querySelector('[data-view="pages"]').addEventListener("click",async()=>{
    await Store.profileReady;
    if(!defaults().length)return;
    remember();select(active || defaults()[0].key);
  });
  index.onclick=event=>{
    const button=event.target.closest("button[data-page]");
    if(button&&!saving){remember();select(button.dataset.page);}
  };
  form.addEventListener("input",()=>{status.textContent="Unsaved edits";});
  byId("discardPage").onclick=()=>{if(!saving){drafts.delete(active);select(active);}};
  form.onsubmit=async event=>{
    event.preventDefault();
    if(saving || !active)return;
    const changes=read();changes.title=changes.title.trim();changes.url=changes.url.trim();
    if(!changes.title){status.textContent="Enter a page title.";return;}
    if(changes.url){
      try{
        const link=new URL(changes.url);
        if(link.protocol!=="https:"||link.username||link.password)throw Error();
        changes.url=link.href;
      }catch{status.textContent="Enter a valid HTTPS destination without embedded credentials.";return;}
    }
    if(!equal(baseline,stored(active))){status.textContent="This page changed in another session. Discard edits to load the current version.";return;}
    saving=true;
    const inputs=form.querySelectorAll("input,textarea,button");inputs.forEach(input=>input.disabled=true);
    try{
      await Store.saveSettings({pages:{...Store.settings().pages,[active]:changes}});
      drafts.delete(active);select(active);status.textContent="Page saved.";
    }catch(err){status.textContent=err.message || "Could not save the page. Your edits are still here.";}
    finally{saving=false;inputs.forEach(input=>input.disabled=false);}
  };
})();
