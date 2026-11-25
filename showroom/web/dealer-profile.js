(() => {
  "use strict";
  const footer = document.getElementById("dealer-contact");
  const nav = document.querySelector("[data-contact-nav]");
  const brand = document.querySelector(".brand");
  const image = brand.querySelector("[data-dealer-logo]");
  const wordmark = document.getElementById("brandname");
  let rendered = "";
  let lastLogo = "";

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
  function link(label, href, external = false) {
    const anchor = create("a", label);
    anchor.href = href;
    if (external) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    return anchor;
  }
  function dial(value) {
    const match = /^([+\d().\s-]+?)(?:\s*(?:ext\.?|x|#)\s*(\d+))?$/i.exec(value);
    if (!match) return "";
    const digits = match[1].replace(/\D/g, "");
    return digits.length >= 7 && digits.length <= 15
      ? "tel:" + (match[1].trim().startsWith("+") ? "+" : "") + digits + (match[2] ? ";ext=" + match[2] : "")
      : "";
  }
  function group(label) {
    const section = create("section");
    section.append(create("h3", label));
    return section;
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
    const settings = Store.settings(), profile = settings.profile || {};
    const name = text(settings.dealerName) || "Dealership";
    const signature = JSON.stringify([name,profile,document.documentElement.dataset.skin]);
    if (signature === rendered) return;
    rendered = signature;
    const light=["pearl","sand"].includes(document.documentElement.dataset.skin||profile.skin);
    updateLogo(name,text(light?(profile.logoLightBackground||profile.logo):(profile.logo||profile.logoLightBackground)));
    const grid = create("div");
    grid.className = "contact-grid";
    const phones = group("Call a department");
    for (const [label, key] of [["Sales","salesPhone"],["Parts","partsPhone"],["Service","servicePhone"]]) {
      const number = text(profile[key]), href = dial(number);
      if (!href) continue;
      const anchor = link("",href);
      anchor.className = "department-phone";
      anchor.append(create("span",label),create("strong",number));
      phones.append(anchor);
    }
    if (phones.childElementCount > 1) grid.append(phones);

    const locality=[text(profile.city),[text(profile.region),text(profile.postal)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const lines=[text(profile.street),locality,text(profile.country)].filter(Boolean);
    if (text(profile.street) || locality) {
      const locations = group("Visit the dealership"), address=create("address");
      lines.forEach(line=>address.append(create("span",line)));
      const location = lines.join(", ");
      locations.append(address,link("Get directions ↗","https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(location),true));
      grid.append(locations);
    }
    const socials=group("Follow us"), socialList=create("div");
    socialList.className="social-links";
    for(const [label,key] of [["Facebook","facebook"],["Instagram","instagram"],["YouTube","youtube"],["TikTok","tiktok"],["X","x"],["LinkedIn","linkedin"]]){
      const href=safeUrl(profile[key]);
      if (href) socialList.append(link(label,href,true));
    }
    if(socialList.childElementCount){socials.append(socialList);grid.append(socials);}
    footer.replaceChildren();
    footer.hidden = !grid.childElementCount;
    nav.hidden = footer.hidden;
    if (!footer.hidden) {
      const title=create("h2","Contact " + name);
      footer.append(title,grid);
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
  const footer=element("footer");
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
    for(const name of ["Inventory","Service","Financing","About"]){
      const entries=pages.filter(page=>(groupNames[page.group]||page.group)===name);
      if(!entries.length)continue;
      const section=element("section"),list=element("ul");
      for(const page of entries){
        const item=element("li"),link=element("a",page.title);
        link.href=DealerPages.href(page.key);
        if(location.pathname.endsWith("page.html")&&new URLSearchParams(location.search).get("page")===page.key)link.setAttribute("aria-current","page");
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
