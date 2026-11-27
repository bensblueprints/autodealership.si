const DealerReputation=(()=>{
  const get=id=>document.getElementById(id),form=get("review-settings"),list=get("review-list"),status=get("review-status"),link=get("review-open"),copy=get("review-copy");
  let offset=0,seq=0,revision=0;
  async function load(){
    const request=++seq;status.textContent="Loading…";
    try{
      const res=await readDealerDesk("/api/reputation?offset="+offset,{cache:"no-store"}),data=await res.json();
      if(request!==seq)return;if(!res.ok)throw Error(data.error||"Could not load reputation.");
      revision=data.revision;form.hidden=!data.manager;form.elements.link.value=data.link;link.hidden=copy.hidden=!data.link;
      if(data.link)link.href=data.link;else link.removeAttribute("href");
      status.textContent=data.link?"":"A manager can add the dealership’s review link.";
      list.replaceChildren();
      for(const row of data.items){
        const b=document.createElement("button"),name=document.createElement("strong"),info=document.createElement("span");b.type="button";b.className="review-client";
        name.textContent=row.name;info.textContent=[row.experience,new Date(row.at).toLocaleDateString(),row.vin].filter(Boolean).join(" · ");
        b.append(name,info);b.onclick=()=>DealerClients.open({id:row.id});list.append(b);
      }
      if(!data.items.length)list.textContent="Attended visits and signed purchases will appear here.";
      get("review-prev").hidden=!offset;get("review-next").hidden=!data.more;
    }catch(e){if(seq===request){status.textContent=e.message;list.replaceChildren();form.hidden=link.hidden=copy.hidden=true;}}
  }
  form.onsubmit=async e=>{
    e.preventDefault();const save=form.querySelector("button");save.disabled=true;
    try{const res=await fetch("/api/reputation",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision,link:form.elements.link.value.trim()})}),data=await res.json();
      if(!res.ok)throw Error(data.error||"Could not save the link.");await load();status.textContent="Review link saved.";
    }catch(err){status.textContent=err.message;}finally{save.disabled=false;}
  };
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(link.href);status.textContent="Review link copied.";}catch{status.textContent="Use Open review page to copy the address.";}};
  get("review-prev").onclick=()=>{offset=Math.max(0,offset-50);load();};get("review-next").onclick=()=>{offset+=50;load();};
  return {load};
})();
