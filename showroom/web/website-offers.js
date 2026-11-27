const WebsiteOffers=(()=>{
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const printedDate=day=>new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(day+"T12:00:00Z"));
  function markup(offers,kind,key){
    const matches=offers.filter(offer=>kind==="page"?offer.page===key:offer.cars.some(car=>car.vin===key));
    return matches.map(offer=>{
      const links=kind==="page" && offer.cars.length?'<ul class="offer-vehicles">'+offer.cars.map(car=>'<li><a href="vehicle.html?stock='+encodeURIComponent(car.vin)+'">'+esc(car.label||car.vin)+(car.stock?' · Stock '+esc(car.stock):'')+'</a></li>').join("")+'</ul>':"";
      return '<article class="dealer-offer" data-offer-expires="'+esc(offer.expiresAt)+'"><header><small>Dealership offer</small><span>Through '+esc(printedDate(offer.day))+'</span></header><h2>'+esc(offer.headline)+'</h2><p>'+esc(offer.disclosure)+'</p>'+links+'</article>';
    }).join("");
  }
  let current=[],offset=0,deadline,request=0;
  const now=()=>Date.now()+offset;
  function cards(){
    const available=new Set(current.filter(o=>Date.parse(o.expiresAt)>now()).flatMap(o=>o.cars.map(c=>c.vin)));
    for(const node of document.querySelectorAll("[data-offer-vin]")){
      const show=available.has(node.dataset.offerVin);
      node.hidden=!show;
      if(show)node.textContent="View offer terms";
    }
  }
  function watchExpiry(){
    clearTimeout(deadline);
    const times=[...current.map(o=>Date.parse(o.expiresAt)),...Array.from(document.querySelectorAll("[data-offer-expires]"),n=>Date.parse(n.dataset.offerExpires))];
    const upcoming=times.filter(n=>n>now());
    document.querySelectorAll("[data-offer-expires]").forEach(n=>{if(Date.parse(n.dataset.offerExpires)<=now())n.remove();});
    if(upcoming.length)deadline=setTimeout(()=>{cards();watchExpiry();},Math.min(2147483647,Math.max(1,Math.min(...upcoming)-now())));
  }
  function start(){
    const panel=document.getElementById("website-offers"),isVehicle=!!document.getElementById("vehicle-page");
    const key=isVehicle?new URL(location.href).searchParams.get("stock"):window.DealerPages?.currentKey();
    const specialPage=!isVehicle && typeof DealerSitePages!=="undefined" && DealerSitePages.catalog.some(page=>page.key===key && page.group==="Specials");
    if(!isVehicle && !specialPage && !document.getElementById("cards"))return;
    const draw=()=>{
      if(panel){
        const html=markup(current.filter(o=>Date.parse(o.expiresAt)>now()),isVehicle?"vehicle":"page",key);
        if(panel.innerHTML!==html)panel.innerHTML=html;
      }
      cards();watchExpiry();
    };
    const sync=async()=>{
      if(document.hidden)return;
      const serial=++request;
      try{
        const layout=document.documentElement.dataset.previewLayout;
        const endpoint=layout?"/api/storefront-preview/website-offers?layout="+encodeURIComponent(layout):"api/website-offers";
        const res=await fetch(endpoint,{cache:"no-store",signal:AbortSignal.timeout(9000)});
        if(!res.ok)throw Error();
        const offers=await res.json();if(serial!==request)return;
        const server=Date.parse(res.headers.get("Date"));offset=Number.isFinite(server)?server-Date.now():0;
        current=offers;
      }catch{if(serial!==request)return;current=[];}
      draw();
    };
    watchExpiry();sync();
    setInterval(sync,60000);
    document.addEventListener("visibilitychange",()=>{if(!document.hidden){watchExpiry();sync();}});
    window.addEventListener("pageshow",e=>{if(e.persisted)sync();});
  }
  return {markup,cards,start};
})();
if(typeof document!=="undefined"){
  window.WebsiteOffers=WebsiteOffers;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",WebsiteOffers.start,{once:true});
  else WebsiteOffers.start();
}
