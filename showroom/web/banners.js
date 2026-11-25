const panel=document.querySelector("#sale-slides");
async function showPromotions(){
  const response=await fetch("/api/banners");
  if(!response.ok)return;
  const {slides,heroImage}=await response.json();
  if(heroImage){
    const photo=new Image();
    photo.onload=()=>{
      const original=document.querySelector(".hero");
      if(!original)return;
      const hero=document.createElement("section");hero.className="hero";hero.setAttribute("aria-label","Dealership showroom");
      hero.innerHTML='<div class="scrim"></div><div class="herotext"><div class="eyebrow">Our showroom</div><h1></h1><div class="actions"><a class="primary" href="#inventory">Browse inventory</a><button type="button" class="secondary">Ask concierge</button></div></div>';
      hero.querySelector("h1").textContent=window.Store.settings().dealerName;
      hero.querySelector("button").onclick=()=>document.querySelector("#assistantlaunch").click();
      photo.alt="Dealership exterior";photo.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center";
      hero.prepend(photo);original.before(hero);original.style.display="none";
    };
    photo.src=heroImage;
  }
  if(!slides.length)return;
  let index=0,paused=matchMedia("(prefers-reduced-motion: reduce)").matches,timer;
  const frame=document.createElement("div"),controls=document.createElement("div");
  controls.className="sale-controls";
  const status=document.createElement("span");
  function draw(){
    clearTimeout(timer);
    const slide=slides[index],img=new Image();
    img.src=slide.image;img.alt=slide.alt;
    if(slide.link){const a=document.createElement("a");a.href=slide.link;a.append(img);frame.replaceChildren(a);}
    else frame.replaceChildren(img);
    status.textContent=(index+1)+" / "+slides.length;
    if(slides.length>1 && !paused && !document.hidden && !panel.matches(":focus-within, :hover"))timer=setTimeout(()=>move(1),6500);
  }
  function move(step){index=(index+step+slides.length)%slides.length;draw();}
  function button(label,click){const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=click;controls.append(b);return b;}
  panel.append(frame);panel.hidden=false;
  if(slides.length>1){
    panel.append(controls);button("Previous",()=>move(-1));controls.append(status);button("Next",()=>move(1));
    const toggle=button(paused?"Play":"Pause",()=>{paused=!paused;toggle.textContent=paused?"Play":"Pause";draw();});
    for(const event of ["mouseenter","focusin"])panel.addEventListener(event,()=>clearTimeout(timer));
    for(const event of ["mouseleave","focusout"])panel.addEventListener(event,()=>setTimeout(()=>{if(!panel.contains(document.activeElement))draw();},0));
    document.addEventListener("visibilitychange",draw);
  }
  draw();
}
showPromotions().catch(()=>{});
