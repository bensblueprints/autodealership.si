(() => {
  "use strict";
  const footer = document.getElementById("dealer-contact");
  const nav = document.querySelector("[data-contact-nav]");
  const brand = document.querySelector(".brand");
  const image = brand.querySelector("[data-dealer-logo]");
  const wordmark = document.getElementById("brandname");
  const header=brand.closest("header");
  const salesLink=header.querySelector(".header-sales-phone") || document.createElement("a");
  if (!salesLink.isConnected) {
    salesLink.className="header-sales-phone";
    salesLink.hidden=true;
    header.append(salesLink);
  }
  let rendered = "";
  let lastLogo = "";
  let lastContact = "";

  const text = value => typeof value === "string" ? value.trim() : "";
  function create(tag, content) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    return node;
  }
  function safeUrl(value) {
    try {
      const url = new URL(text(value));
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }
  function updateLogo(name, source) {
    wordmark.textContent = name;
    brand.setAttribute("aria-label", name + " showroom");
    const logo = /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(source) ? source : safeUrl(source);
    if (logo === lastLogo) return;
    lastLogo = logo;
    brand.classList.remove("has-dealer-logo");
    if (!logo) {image.removeAttribute("src");return;}
    image.onload = () => { if (image.naturalWidth > 0 && image.getAttribute("src") === lastLogo) brand.classList.add("has-dealer-logo"); };
    image.onerror = () => brand.classList.remove("has-dealer-logo");
    image.src = logo;
  }
  function render() {
    if (footer.hasAttribute("data-server-location") && !Store.profileLoaded()) return;
    const settings = Store.settings(), profile = settings.profile || {};
    const name = text(settings.dealerName) || "Dealership";
    const signature = JSON.stringify([name,profile,document.documentElement.dataset.skin]);
    if (signature === rendered) return;
    rendered = signature;
    const light=["pearl","sand"].includes(document.documentElement.dataset.skin||profile.skin);
    updateLogo(name,text(light?(profile.logoLightBackground||profile.logo):(profile.logo||profile.logoLightBackground)));
    const number=text(profile.salesPhone), phoneHref=DealerLocation.dial(number);
    salesLink.hidden=!phoneHref;
    if(phoneHref){
      salesLink.href=phoneHref;
      salesLink.textContent=number;
      salesLink.setAttribute("aria-label","Call sales at "+number);
    }else salesLink.removeAttribute("href");
    const page = document.getElementById("page-location");
    const dedicated = page && ["contact","directions"].includes(DealerPages.currentKey());
    const facts = DealerLocation.facts(profile);
    const contactKey = JSON.stringify([name,facts,Boolean(dedicated)]);
    if (lastContact === contactKey) return;
    lastContact = contactKey;
    const card = DealerLocation.card(facts,dedicated);
    const container = dedicated ? page : footer;
    const hours = () => container.querySelectorAll("details[data-department]");
    const opened = new Map(Array.from(hours(),item=>[item.dataset.department,item.open]));
    const focused = document.activeElement?.closest("details[data-department]")?.dataset.department;
    footer.hidden = !card || dedicated;
    nav.hidden = !card;
    if (dedicated) {
      if (page.innerHTML !== card) page.innerHTML = card;
      nav.hash = "page-location";
    } else if (card) {
      footer.replaceChildren(create("h2","Contact "+name));
      footer.insertAdjacentHTML("beforeend",card);
    } else footer.replaceChildren();
    for (const item of hours()) {
      const key=item.dataset.department;
      if (opened.has(key)) item.open=opened.get(key);
      if (key===focused) item.querySelector("summary").focus({preventScroll:true});
    }
  }
  window.addEventListener("showroom:skin",render);
  window.addEventListener("showroom:update",render);
  window.addEventListener("storage",render);
  render();
})();
(() => {
  const contact=document.querySelector("[data-contact-nav]");
  if(!contact||!window.DealerPages)return;
  const element=(tag,content)=>{const el=document.createElement(tag);if(content)el.textContent=content;return el;};
  const button=element("button","Pages ▾");
  button.type="button";button.setAttribute("aria-label","Dealership pages");
  button.setAttribute("aria-expanded","false");button.setAttribute("aria-controls","dealership-page-menu");
  contact.before(button);
  const menu=element("nav");
  menu.id="dealership-page-menu";menu.setAttribute("aria-label","Dealership pages");menu.hidden=true;
  document.querySelector(".top").after(menu);
  const footer=document.getElementById("dealer-page-links")||element("footer");
  footer.id="dealer-page-links";
  document.getElementById("dealer-contact").after(footer);
  function close(returnFocus=false){
    if(menu.hidden)return;
    menu.hidden=true;button.setAttribute("aria-expanded","false");if(returnFocus)button.focus();
  }
  function position(){
    if(menu.hidden)return;
    const box=button.getBoundingClientRect();
    if(box.bottom<0||box.top>innerHeight){close();return;}
    menu.style.top=Math.min(box.bottom+5,innerHeight-60)+"px";
  }
  button.addEventListener("click",()=>{
    if(!menu.hidden){close();return;}
    menu.hidden=false;position();button.setAttribute("aria-expanded","true");
    menu.querySelector("a")?.focus();
  });
  document.addEventListener("keydown",e=>{if(e.key==="Escape")close(true);});
  for(const event of ["pointerdown","focusin"])document.addEventListener(event,e=>{if(!button.contains(e.target)&&!menu.contains(e.target))close();});
  for(const event of ["resize","scroll"])window.addEventListener(event,position,{passive:true});
  const groupNames={Inventory:"Inventory",Service:"Service","Service & Parts":"Service",Finance:"Financing",Financing:"Financing",About:"About",Dealership:"About"};
  let previous="";
  function refresh(){
    const pages=DealerPages.list().filter(page=>page.enabled!==false);
    const signature=JSON.stringify(pages.map(({key,title,group})=>[key,title,group]));
    if(previous===signature)return;
    previous=signature;
    const grid=element("div");grid.className="dealer-page-groups";
    for(const name of new Set(pages.map(page=>groupNames[page.group]||page.group))){
      const entries=pages.filter(page=>(groupNames[page.group]||page.group)===name);
      if(!entries.length)continue;
      const section=element("section"),list=element("ul");
      for(const page of entries){
        const item=element("li"),link=element("a",page.title);
        link.href=DealerPages.href(page.key);
        if((location.pathname===page.path || location.pathname.endsWith("page.html"))&&DealerPages.currentKey()===page.key)link.setAttribute("aria-current","page");
        item.append(link);list.append(item);
      }
      section.append(element("h3",name),list);grid.append(section);
    }
    button.hidden=footer.hidden=!grid.childElementCount;
    menu.replaceChildren(grid);footer.replaceChildren();
    if(button.hidden){close();return;}
    const navigation=element("nav");navigation.setAttribute("aria-label","More dealership pages");navigation.append(grid.cloneNode(true));footer.append(navigation);
  }
  window.addEventListener("showroom:update",refresh);
  window.addEventListener("storage",refresh);
  refresh();
})();
