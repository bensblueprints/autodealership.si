const panel=document.querySelector("#sale-slides");
function enableHeroConcierge(){
  const button=document.querySelector("[data-hero-concierge]");
  if(button && !document.documentElement.dataset.previewLayout){
    button.hidden=false;button.onclick=()=>window.dispatchEvent(new Event("open-assistant"));
  }
}
enableHeroConcierge();
async function showPromotions(){
  const layout=document.documentElement.dataset.previewLayout;
  const endpoint=layout?"/api/storefront-preview/banners?media=links&layout="+encodeURIComponent(layout):"api/banners?media=links";
  const response=await fetch(endpoint);
  if(!response.ok)return;
  const config=await response.json(),heroImage=config.heroImage;
  let slides=config.slides,governed=config.governed,tag=response.headers.get("ETag");
  const original=document.querySelector('[aria-label="Featured vehicle"]');
  if(original && !original.hasAttribute("data-hero-resolved") && !document.body.dataset.inventoryPage && (heroImage || config.heroArtwork)){
    await window.Store.profileReady;
    const hero=HeroFraming.markup({photo:heroImage,art:config.heroArtwork,focus:config.heroFocus},window.Store.settings().dealerName);
    if(hero){original.insertAdjacentHTML("beforebegin",hero);original.hidden=true;enableHeroConcierge();}
  }
  if(!slides.length && !governed)return;
  let index=0,paused=matchMedia("(prefers-reduced-motion: reduce)").matches,timer,expiry,pending=false;
  const frame=document.createElement("div"),controls=document.createElement("div");
  controls.className="sale-controls";
  const status=document.createElement("span");
  function draw(){
    clearTimeout(timer);clearTimeout(expiry);
    const now=Date.now();slides=slides.filter(s=>!s.expiresAt || Date.parse(s.expiresAt)>now);
    panel.hidden=!slides.length;if(!slides.length){frame.replaceChildren();return;}
    index=index%slides.length;controls.hidden=slides.length<2;
    const deadlines=slides.filter(s=>s.expiresAt).map(s=>Date.parse(s.expiresAt));
    if(deadlines.length)expiry=setTimeout(draw,Math.min(2147483647,Math.max(1,Math.min(...deadlines)-now)));
    const slide=slides[index],img=new Image();
    img.src=slide.image;img.alt=slide.alt;
    if(slide.link){const a=document.createElement("a");a.href=slide.link;a.append(img);frame.replaceChildren(a);}
    else frame.replaceChildren(img);
    if(slide.disclosure){
      const terms=document.createElement("p");terms.className="offer-disclosure";terms.textContent=slide.disclosure;
      frame.append(terms);
    }
    status.textContent=(index+1)+" / "+slides.length;
    if(slides.length>1 && !paused && !document.hidden && !panel.matches(":focus-within, :hover"))timer=setTimeout(()=>move(1),6500);
  }
  function move(step){index=(index+step+slides.length)%slides.length;draw();}
  function button(label,click){const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=click;controls.append(b);return b;}
  panel.append(frame,controls);
  {
    button("Previous",()=>move(-1));controls.append(status);button("Next",()=>move(1));
    const toggle=button(paused?"Play":"Pause",()=>{paused=!paused;toggle.textContent=paused?"Play":"Pause";draw();});
    for(const event of ["mouseenter","focusin"])panel.addEventListener(event,()=>clearTimeout(timer));
    for(const event of ["mouseleave","focusout"])panel.addEventListener(event,()=>setTimeout(()=>{if(!panel.contains(document.activeElement))draw();},0));
  }
  async function sync(){
    if(!governed || document.hidden || pending)return;
    pending=true;
    try{
      const res=await fetch(endpoint,{cache:"no-store",headers:tag?{"If-None-Match":tag}:{}});
      if(res.status===304 || !res.ok)return;
      const next=await res.json();slides=next.slides;tag=res.headers.get("ETag");governed=next.governed;draw();
    }catch{/* Expiry still applies while the network is unavailable. */}
    finally{pending=false;}
  }
  if(governed)setInterval(sync,60000);
  document.addEventListener("visibilitychange",()=>{draw();if(!document.hidden)sync();});
  draw();
}
showPromotions().catch(()=>{});
