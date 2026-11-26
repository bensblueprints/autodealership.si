(() => {
  const $ = id => document.getElementById(id);
  const exists = value => value !== null && value !== undefined && value !== '';
  const miles = car => exists(car.miles) ? Number(car.miles).toLocaleString('en-US')+' mi' : '';
  const currency = value => !exists(value) ? 'Contact for price' : Number(value).toLocaleString('en-US', {style:'currency', currency:'USD', minimumFractionDigits:0,maximumFractionDigits:2});
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const categoryPage=document.body.dataset.inventoryPage;
  const pageFilter=categoryPage && DealerSitePages.inventoryFilters[categoryPage];
  const cars=()=>pageFilter?Store.cars().filter(pageFilter):Store.cars();
  const find = id => cars().find(car => String(car.id) === String(id));
  const title = car => [car.year,car.make,car.model].filter(Boolean).join(' ');
  const specs = car => [...new Set([car.trim,car.body,miles(car)].filter(Boolean))].join(' · ');
  let saved;
  try { saved = JSON.parse(localStorage.getItem(('apex-showroom-saved'+(window.clientSite?':'+clientSite.slug:''))) || '[]'); } catch { saved=[]; }
  let category='', query='', savedOnly=false, slide=0, selectedIds=null;
  function matches(car) {
    if (!Facets.matches(car)) return false;
    if(selectedIds)return selectedIds.has(String(car.id)) && (!category || car.body===category);
    const words = query.trim().toLowerCase();
    const haystack=[title(car),car.trim,car.body,car.id,car.stock,car.vin,car.miles,miles(car),car.price,currency(car.price),car.fuel,car.transmission,car.engine,car.color,car.interior,InventorySearch.drivetrain(car),car.doors,car.location,car.status,...(car.features || [])].join(' ').toLowerCase();
    return (!savedOnly || saved.includes(String(car.id))) && (!category || car.body===category) && (!words || words.split(/\s+/).every(word => haystack.includes(word)));
  }
  function card(car) {
    const id=escape(car.id), favorite=saved.includes(String(car.id));
    const monthly=!exists(car.price) || Facets.paymentMode==='cash' ? null : Facets.amount(car);
    const payment=monthly===null ? '' : '<div class="monthly-estimate">Est. '+currency(monthly)+'/mo · '+escape(Facets.paymentMode)+'</div>';
    return '<article class="card"><a class="carlink" href="vehicle.html?stock='+encodeURIComponent(car.id)+'" data-car="'+id+'">'+(car.image?'<img loading="lazy" src="'+escape(car.image)+'" alt="">':'<div class="photo-missing"><svg aria-hidden="true"><use href="assets/inventory-icons.svg#car-side"></use></svg><span>Photo unavailable</span></div>')+'<div class="cardinfo">'+(car.imageType==='stock'?'<small>Representative photo</small>':'')+'<h4>'+escape(title(car))+'</h4><div class="spec">'+escape(specs(car))+'</div><div class="card-identifiers"><span>Stock # <b>'+escape(car.stock || "Unavailable")+'</b></span><span>VIN <b>'+escape(car.vin || "Unavailable")+'</b></span></div><strong>'+(car.bhph?'Cash '+BHPH.money(car.bhph.cash):currency(car.price))+'</strong>'+(car.bhph?'<p>Buy Here Pay Here '+BHPH.money(car.bhph.price)+' · '+BHPH.money(car.bhph.down)+' down</p>':'')+payment+'<span class="inventory-offer" data-offer-vin="'+id+'" hidden></span></div></a><button class="save" aria-label="'+(favorite?'Unsave ':'Save ')+escape(title(car))+'" aria-pressed="'+favorite+'" data-save="'+id+'">'+(favorite?'♥':'♡')+'</button>'+(window.Retail?.card(car) || '')+'</article>';
  }
  const pageSize=24;
  const initialParams=new URLSearchParams(location.search);
  let page=0,previousResults=null,landingReady=false,pageToOpen=Number(initialParams.get("p"))||1;
  let scrollToSearch=false, projectedHash="", chipSignature="", restoredState=null;
  function readLocation(){
    const incoming=InventorySearch.read(location.hash,Facets.fields);
    savedOnly=false;selectedIds=null;category="";previousResults=null;
    if(incoming){Facets.restore(incoming);restoredState=incoming;query=incoming.query;pageToOpen=incoming.page;scrollToSearch=true;}
    else{
      Facets.reset();query=pageFilter?new URLSearchParams(location.search).get("search")||"":"";
      pageToOpen=pageFilter?Number(new URLSearchParams(location.search).get("p"))||1:1;
    }
    $("search").value=query;
  }
  readLocation();
  function updateSearch(){
    const share=$("share-search"),url=new URL(location.href);
    const shareable=!savedOnly && !selectedIds;
    const state={...Facets.searchState(),query,page:1};
    const criteria=shareable && InventorySearch.write(state);
    projectedHash=shareable?InventorySearch.write({...state,page:page+1}):"";
    share.hidden=!projectedHash;
    if(criteria || (!pageFilter && projectedHash)){
      url.hash=projectedHash;url.searchParams.delete("search");url.searchParams.delete("p");
    }else{
      if(url.hash.startsWith("#inventory?"))url.hash="inventory";
      if(pageFilter){
        url.searchParams.delete("search");
        if(page>0)url.searchParams.set("p",page+1);else url.searchParams.delete("p");
      }
    }
    if(url.href!==location.href){try{history.replaceState(history.state,"",url);}catch{/* The explicit copy action also works when browser history updates are limited. */}}
    if(restoredState){
      const prior=restoredState;restoredState=null;
      if(prior.selected.some(([key])=>!state.selected.some(([k])=>k===key)) || prior.equipment.length>state.equipment.length || prior.mode!==state.mode || (prior.bhph && !state.bhph) || (prior.down!==null && state.down==="") || (prior.frequency && !state.frequency) || (prior.installment!==null && state.installment==="") || (prior.maximum!==null && state.maximum===null) || (prior.minimum!==null && state.minimum===null)){
        $("search-feedback").textContent="Some filters in this link are disabled by the dealership. The applied filters are shown below.";
      }
    }
    const chips=Facets.chips();
    if(query.trim() && shareable)chips.unshift(["q","Search · "+query.trim()]);
    const signature=JSON.stringify(chips);
    if(signature!==chipSignature){
      chipSignature=signature;
      const group=$("active-search");group.hidden=!chips.length;group.replaceChildren();
      for(const [key,label] of chips){
        const b=document.createElement("button");b.type="button";b.dataset.remove=key;b.textContent=label+" ×";b.setAttribute("aria-label","Remove "+label);group.append(b);
      }
    }
    if(!$("search-link-fallback").hidden && $("search-link-fallback").querySelector("input").value!==shareUrl())$("search-link-fallback").hidden=true;
  }
  function shareUrl(){return projectedHash?location.origin+location.pathname+projectedHash:"";}
  $("share-search").onclick=async()=>{
    const url=shareUrl();if(!url)return;
    try{await navigator.clipboard.writeText(url);$("search-feedback").textContent="Search link copied.";}
    catch{const box=$("search-link-fallback"),input=box.querySelector("input");input.value=url;box.hidden=false;input.focus();input.select();$("search-feedback").textContent="Select and copy the search link.";}
  };
  $("active-search").onclick=e=>{
    const button=e.target.closest("[data-remove]");if(!button)return;
    const index=[...button.parentElement.children].indexOf(button);
    if(button.dataset.remove==="q"){query="";$("search").value="";}else Facets.remove(button.dataset.remove);
    render();
    const children=$("active-search").children;
    (children[Math.min(index,children.length-1)]||$("search")).focus({preventScroll:true});
  };
  window.addEventListener("hashchange",e=>{
    if([e.oldURL,e.newURL].some(h=>new URL(h).hash.startsWith("#inventory?"))){readLocation();render();}
  });
  function showLotContact(){
    const strip=$("lot-contact"),profile=Store.settings().profile||{};
    strip.replaceChildren();strip.hidden=!document.body.classList.contains("compact-lot");if(strip.hidden)return;
    const address=[profile.street,profile.city,profile.region,profile.postal].filter(Boolean).join(", ");
    if(address){const span=document.createElement("span");span.textContent=address;strip.append(span);}
    if(profile.salesPhone){
      const a=document.createElement("a");a.href="tel:"+profile.salesPhone.replace(/[^+0-9]/g,"");a.textContent="Sales "+profile.salesPhone;strip.append(a);
    }
    const hoursByDay=profile.salesHours||profile.driveHours;
    if(hoursByDay){
      const zone=profile.driveTimezone||"America/Chicago";
      const day=new Intl.DateTimeFormat("en-US",{weekday:"short",timeZone:zone}).format(new Date());
      const range=hoursByDay[day];
      const clock=value=>{const [h,m]=value.split(":").map(Number);return (h%12||12)+":"+String(m).padStart(2,"0")+(h>=12?" PM":" AM");};
      const hours=document.createElement("span");hours.textContent=range?(profile.salesHours?"Sales today · ":"Test drives today · ")+range.map(clock).join(" – ")+" (dealer local time)":(profile.salesHours?"Sales closed today":"Closed for test drives today");
      strip.append(hours);
    }
    strip.hidden=!strip.children.length;
  }
  let shortcutSignature="";
  function showShoppingLinks(list){
    const bar=$("shopping-shortcuts");
    if(categoryPage || !bar)return;
    const pages=DealerPages.list().filter(p=>p.enabled);
    const inventory=pages.find(p=>p.key==="all-inventory");
    const bhph=list.some(car=>car.bhph);
    showTemplate(list,pages);
    const services=["value-trade","schedule-service","directions","contact"].map(key=>pages.find(p=>p.key===key)).filter(Boolean);
    const signature=JSON.stringify([document.body.dataset.storeTemplate,inventory?.key,bhph,services.map(p=>[p.key,p.title])]);
    if(signature===shortcutSignature)return;shortcutSignature=signature;bar.replaceChildren();
    function link(title,href){const a=document.createElement("a");a.href=href;a.textContent=title;bar.append(a);}
    if(inventory)link("Shop all vehicles",DealerPages.href(inventory.key));
    if(bhph){
      const btn=document.createElement("button");btn.type="button";btn.textContent="Shop Buy Here Pay Here";
      btn.onclick=()=>{window.filterCars("");$("bhph-only").checked=true;$("filterpanel").open=true;render();jump();};bar.append(btn);
    }
    for(const service of services)link(service.title,DealerPages.href(service.key));
    bar.hidden=!bar.childElementCount;
    if(document.body.dataset.storeTemplate && document.body.dataset.storeTemplate!=="classic")bar.hidden=true;
  }
  function showTemplate(list,pages){
    const settings=Store.settings(), key=DealerSitePages.templateKey(settings.profile?.siteTemplate);
    const section=$("dealer-template");
    document.body.dataset.storeTemplate=key;
    if(!section || key==="classic"){if(section)section.hidden=true;return;}
    const template=DealerSitePages.templates[key];
    const enabled=template.links.map(k=>pages.find(page=>page.key===k)).filter(Boolean);
    const picks=key==="bhph"?list.filter(car=>car.bhph?.schedules?.length).slice(0,3):[];
    const signature=JSON.stringify([key,enabled.map(p=>[p.key,p.title]),picks.map(c=>[c.id,c.bhph.revision,c.bhph.down,c.bhph.schedules[0]])]);
    if(section.dataset.signature===signature)return;
    section.dataset.signature=signature;section.hidden=false;
    section.querySelector("h2").textContent=key==="bhph"&&!picks.length?"Browse available vehicles":template.heading;
    const grid=section.querySelector(".template-links");grid.replaceChildren();
    const add=(label,href,detail)=>{
      const a=document.createElement("a"),name=document.createElement("strong");
      a.href=href;name.textContent=label;a.append(name);
      if(detail){const small=document.createElement("small");small.textContent=detail;a.append(small);}
      grid.append(a);
    };
    const money=cents=>(cents/100).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0,maximumFractionDigits:2});
    for(const car of picks){
      const offer=car.bhph,s=offer.schedules[0];
      add(title(car),"vehicle.html?stock="+encodeURIComponent(car.vin)+"#vehicle-payment-schedules",
        money(offer.down)+" down · "+money(s.payment)+" "+s.frequency.toLowerCase()+" · "+s.months+" months");
    }
    for(const page of enabled)add(page.title,DealerPages.href(page.key));
    if(picks.length){
      const shortcut=document.createElement("button");shortcut.type="button";shortcut.textContent="Filter by down payment";
      shortcut.onclick=()=>{window.filterCars("");$("bhph-only").checked=true;$("filterpanel").open=true;render();jump();$("max-cash-down").focus();};
      grid.append(shortcut);
    }
    section.hidden=!grid.childElementCount;
  }
  function render() {
    if(!landingReady)return [];
    const list=cars();
    Facets.prepare(list);showLotContact();showShoppingLinks(list);
    const filtered=Facets.order(list.filter(matches));
    $('brandname').textContent=window.Store.settings?.()?.dealerName || 'Capital City CDJR';
    if(!pageFilter)document.title=$('brandname').textContent+' · Showroom';
    const active=Boolean(selectedIds || query.trim() || category || savedOnly);
    const browse=!pageFilter && !document.body.classList.contains("compact-lot") && !active && !Facets.isNarrowed() && !Facets.sorted && Facets.layout==="browse" && filtered.length>3;
    $('cards').classList.toggle('browse',browse);
    $('cards').classList.toggle('list-layout',Facets.layout==="list");
    Facets.sync(active);
    const shelf=(name,records)=>'<section class="shelf"><div class="shelfheading"><h3>'+escape(name)+'</h3><div><button data-scroll="-1" aria-label="Scroll '+escape(name)+' left">←</button><button data-scroll="1" aria-label="Scroll '+escape(name)+' right">→</button></div></div><div class="rail">'+records.map(card).join('')+'</div></section>';
    const signature=filtered.map(car=>car.id).join('|')+Facets.layout;
    if(previousResults!==signature){page=previousResults===null && Number.isSafeInteger(pageToOpen)?Math.max(0,pageToOpen-1):0;previousResults=signature;}
    const pages=Math.ceil(filtered.length/pageSize);
    page=Math.max(0,Math.min(page,pages-1));
    updateSearch();
    const batch=filtered.slice(page*pageSize,(page+1)*pageSize);
    const budget=filtered.filter(car=>exists(car.price)&&car.price<30000).slice(0,8);
    const utility=filtered.filter(car=>['SUV','Truck'].includes(car.body)).slice(0,8);
    $('cards').innerHTML=browse ? [shelf('Inventory',batch),page===0&&budget.length?shelf('Under $30,000',budget):'',page===0&&utility.length?shelf('SUVs & trucks',utility):''].join(''):batch.map(card).join('');
    $('inventoryPager').hidden=pages<2;
    $('inventoryPage').textContent='Page '+(page+1)+' of '+pages;
    $('inventoryPrev').disabled=page===0;
    $('inventoryNext').disabled=page+1>=pages;
    window.WebsiteOffers?.cards();
    window.Retail?.sync();
    $('rowtitle').textContent=savedOnly?'Your saved vehicles':category||'Inventory';
    $('resultcount').textContent=filtered.length+' vehicle'+(filtered.length===1?'':'s');
    $('savecount').textContent=saved.length?' ('+saved.length+')':'';
    $('empty').hidden=filtered.length>0;
    const hero=list[slide%list.length];
    $('details').disabled=!hero;
    $('prev').disabled=$('next').disabled=list.length<2;
    if(hero){
      $('heroimg').hidden=!hero.image;
      $('heroimg').closest('.hero').classList.toggle('hero-no-photo',!hero.image);
      if(hero.image)$('heroimg').src=hero.image;else $('heroimg').removeAttribute('src');
      $('heroimg').alt=title(hero);
      $('heroyear').textContent=hero.year+' '+hero.make;
      $('heroname').textContent=hero.model;
      $('herospec').textContent=[hero.trim,miles(hero),currency(hero.price),hero.imageType==="stock"?"Representative photo":""].filter(Boolean).join('  ·  ');
      $('slidecount').textContent=String(slide%list.length+1).padStart(2,'0')+' / '+String(list.length).padStart(2,'0');
    }
    if(scrollToSearch){scrollToSearch=false;requestAnimationFrame(()=>$('inventory').scrollIntoView({block:'start'}));}
    return filtered;
  }
  function jump() { $('inventory').scrollIntoView({behavior:'smooth'}); }
  window.renderShowroom=render;
  window.filterCars=(value,ids)=>{
    Facets.reset();
    selectedIds=Array.isArray(ids)?new Set(ids.map(String)):null;
    query=String(value||'');category='';savedOnly=false;$('search').value=query;
    const filtered=render();jump();return filtered;
  };
  window.showCar=id=>{
    if(!find(id))return false;
    location.assign("vehicle.html?stock="+encodeURIComponent(id));
    return true;
  };
  $('cards').onclick=e=>{
    const btn=e.target.closest('button');
    if(!btn){
      const card=e.target.closest('.card');
      if(card && !e.target.closest('a,details') && !window.getSelection()?.toString())card.querySelector('.carlink')?.click();
      return;
    }
    if(btn.hasAttribute('data-scroll')){
      const rail=btn.closest('.shelf').querySelector('.rail');
      rail.scrollBy({left:Number(btn.dataset.scroll)*rail.clientWidth*.8,behavior:'smooth'});return;
    }
    if(btn.hasAttribute('data-car')){window.showCar(btn.dataset.car);return;}
    if (!btn.hasAttribute('data-save')) return;
    const id=btn.dataset.save;
    saved=saved.includes(id)?saved.filter(item=>item!==id):[...saved,id];
    try{localStorage.setItem(('apex-showroom-saved'+(window.clientSite?':'+clientSite.slug:'')),JSON.stringify(saved));}catch{}
    render();
  };
  for(const [id,step] of [['inventoryPrev',-1],['inventoryNext',1]]){
    $(id).onclick=()=>{page+=step;render();$('rowtitle').scrollIntoView({block:'start'});};
  }
  $('search').oninput=e=>{selectedIds=null;query=e.target.value;render();};
  $('reset').onclick=()=>window.filterCars('');
  $('savednav').onclick=()=>{Facets.reset();selectedIds=null;savedOnly=true;category='';query='';$('search').value='';render();jump();};
  document.querySelector('a[href="#inventory"]').onclick=e=>{e.preventDefault();window.filterCars('');};
  $('prev').onclick=()=>{slide=(slide+cars().length-1)%cars().length;render();};
  $('next').onclick=()=>{slide=(slide+1)%cars().length;render();};
  $('details').onclick=()=>window.showCar(cars()[slide%cars().length]?.id);
  $('searchmic').onclick=()=>window.dispatchEvent(new Event('open-assistant'));
  $('assistantlaunch').onclick=()=>window.dispatchEvent(new Event('open-assistant'));
  window.addEventListener('showroom:update',render);
  window.addEventListener('storage',render);
  Promise.all([Store.inventoryReady,Store.profileReady]).then(()=>{landingReady=true;render();});
  const initialCar = new URLSearchParams(location.search).get('vehicle');
  if (initialCar) location.replace("vehicle.html?stock="+encodeURIComponent(initialCar));
})();
