(() => {
  const $ = id => document.getElementById(id);
  const exists = value => value !== null && value !== undefined && value !== '';
  const miles = car => exists(car.miles) ? Number(car.miles).toLocaleString('en-US')+' mi' : '';
  const currency = value => !exists(value) ? 'Contact for price' : Number(value).toLocaleString('en-US', {style:'currency', currency:'USD', maximumFractionDigits:0});
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const cars = () => window.Store.cars();
  const find = id => cars().find(car => String(car.id) === String(id));
  const title = car => [car.year,car.make,car.model].filter(Boolean).join(' ');
  const specs = car => [...new Set([car.trim,car.body,miles(car)].filter(Boolean))].join(' · ');
  let saved;
  try { saved = JSON.parse(localStorage.getItem('apex-showroom-saved') || '[]'); } catch { saved=[]; }
  let category='', query='', savedOnly=false, slide=0, selectedIds=null;
  function matches(car) {
    if (!Facets.matches(car)) return false;
    if(selectedIds)return selectedIds.has(String(car.id)) && (!category || car.body===category);
    const words = query.trim().toLowerCase();
    const haystack=[title(car),car.trim,car.body,car.id,car.stock,car.vin,car.miles,miles(car),car.price,currency(car.price),car.fuel,car.transmission,car.engine,car.color,car.doors,car.location,car.status,...(car.features || [])].join(' ').toLowerCase();
    return (!savedOnly || saved.includes(String(car.id))) && (!category || car.body===category) && (!words || words.split(/\s+/).every(word => haystack.includes(word)));
  }
  function card(car) {
    const id=escape(car.id), favorite=saved.includes(String(car.id));
    const monthly=!exists(car.price) || Facets.paymentMode==='cash' ? null : Facets.amount(car);
    const payment=monthly===null ? '' : '<div class="monthly-estimate">Est. '+currency(monthly)+'/mo · '+escape(Facets.paymentMode)+'</div>';
    return '<article class="card"><a class="carlink" href="vehicle.html?stock='+encodeURIComponent(car.id)+'" data-car="'+id+'">'+(car.image?'<img loading="lazy" src="'+escape(car.image)+'" alt="">':'<div class="photo-missing"><svg aria-hidden="true"><use href="assets/inventory-icons.svg#car-side"></use></svg><span>Photo unavailable</span></div>')+'<div class="cardinfo">'+(car.imageType==='stock'?'<small>Representative photo</small>':'')+'<h4>'+escape(title(car))+'</h4><div class="spec">'+escape(specs(car))+'</div><div class="card-identifiers"><span>Stock # <b>'+escape(car.stock || "Unavailable")+'</b></span><span>VIN <b>'+escape(car.vin || "Unavailable")+'</b></span></div><strong>'+currency(car.price)+'</strong>'+payment+'</div></a><button class="save" aria-label="'+(favorite?'Unsave ':'Save ')+escape(title(car))+'" aria-pressed="'+favorite+'" data-save="'+id+'">'+(favorite?'♥':'♡')+'</button>'+(window.Retail?.card(car) || '')+'</article>';
  }
  const pageSize=24;
  let page=0,previousResults='';
  function render() {
    const list=cars();
    Facets.prepare(list);
    const filtered=Facets.order(list.filter(matches));
    $('brandname').textContent=window.Store.settings?.()?.dealerName || 'Capital City CDJR';
    document.title=$('brandname').textContent+' · Showroom';
    const active=Boolean(selectedIds || query.trim() || category || savedOnly);
    const browse=!active && !Facets.isNarrowed() && !Facets.sorted && Facets.layout==="browse" && filtered.length>3;
    $('cards').classList.toggle('browse',browse);
    $('cards').classList.toggle('list-layout',Facets.layout==="list");
    Facets.sync(active);
    const shelf=(name,records)=>'<section class="shelf"><div class="shelfheading"><h3>'+escape(name)+'</h3><div><button data-scroll="-1" aria-label="Scroll '+escape(name)+' left">←</button><button data-scroll="1" aria-label="Scroll '+escape(name)+' right">→</button></div></div><div class="rail">'+records.map(card).join('')+'</div></section>';
    const signature=filtered.map(car=>car.id).join('|')+Facets.layout;
    if(previousResults!==signature){page=0;previousResults=signature;}
    const pages=Math.ceil(filtered.length/pageSize);
    const batch=filtered.slice(page*pageSize,(page+1)*pageSize);
    const budget=filtered.filter(car=>exists(car.price)&&car.price<30000).slice(0,8);
    const utility=filtered.filter(car=>['SUV','Truck'].includes(car.body)).slice(0,8);
    $('cards').innerHTML=browse ? [shelf('Inventory',batch),page===0&&budget.length?shelf('Under $30,000',budget):'',page===0&&utility.length?shelf('SUVs & trucks',utility):''].join(''):batch.map(card).join('');
    $('inventoryPager').hidden=pages<2;
    $('inventoryPage').textContent='Page '+(page+1)+' of '+pages;
    $('inventoryPrev').disabled=page===0;
    $('inventoryNext').disabled=page+1>=pages;
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
      if(card && !e.target.closest('a') && !window.getSelection()?.toString())card.querySelector('.carlink')?.click();
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
    try{localStorage.setItem('apex-showroom-saved',JSON.stringify(saved));}catch{}
    render();
  };
  for(const [id,step] of [['inventoryPrev',-1],['inventoryNext',1]]){
    $(id).onclick=()=>{page+=step;render();$('rowtitle').scrollIntoView({block:'start'});};
  }
  $('search').oninput=e=>{selectedIds=null;query=e.target.value;render();};
  $('reset').onclick=()=>window.filterCars('');
  $('savednav').onclick=()=>{Facets.reset();selectedIds=null;savedOnly=true;category='';query='';$('search').value='';render();jump();};
  document.querySelector('a[href="#inventory"]').onclick=()=>window.filterCars('');
  $('prev').onclick=()=>{slide=(slide+cars().length-1)%cars().length;render();};
  $('next').onclick=()=>{slide=(slide+1)%cars().length;render();};
  $('details').onclick=()=>window.showCar(cars()[slide%cars().length]?.id);
  $('searchmic').onclick=()=>window.dispatchEvent(new Event('open-assistant'));
  $('assistantlaunch').onclick=()=>window.dispatchEvent(new Event('open-assistant'));
  window.addEventListener('showroom:update',render);
  window.addEventListener('storage',render);
  render();
  const initialCar = new URLSearchParams(location.search).get('vehicle');
  if (initialCar) location.replace("vehicle.html?stock="+encodeURIComponent(initialCar));
})();
