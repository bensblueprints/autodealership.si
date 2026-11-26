import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { products, guides, planned, makes } from "./content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "https://autodealership.si";
const demo = "https://demo.autodealership.si/";
const meeting = "/#book-demo";
const plain = value => String(value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const pathFor = key => "/" + key + "/";
const brandPath = name => "oem/" + name.toLowerCase().replaceAll(" ", "-");
const indexable = new Set(["/", "/signup.html", "/ads-management/"]);
const catalog = new Map([...products.map(([id, ...other]) => ["products/" + id, ...other]), ...guides].map(row => [row[0], row]));
const category = {
  products: ["Products", "Website, inventory and AI tools", "Explore the tools that take a shopper from a search result or incoming call to a vehicle question and a booked visit."],
  solutions: ["Solutions", "Find your dealership setup", "Choose the type of store or website you operate to see how the showroom, concierge and staff tools fit together."],
  resources: ["Resources", "Dealer resources", "Find product updates, practical dealership guides and a walkthrough you can use with the sales team."],
  company: ["Company", "About AutoDealership.SI", "Meet the team behind the platform and see how we approach inventory websites, shopper conversations and dealership onboarding."],
  partners: ["Partners", "Integrations and partnerships", "Explore current platform connections and the information needed to evaluate an integration for a specific dealership."],
  oem: ["OEM programs", "OEM programs", "Manufacturer website programs are Coming Soon. Select a make to review its current status and discuss the requirements your rooftop follows."]
};
const nav = [
  ["products", "Products", [
    ["Digital showroom", ["products/lotline","products/local-reach","products/answer-index","ads-management","products/deal-path","products/feed-desk"]],
    ["Dealer operations", ["products/offer-board","products/shopper-paths","products/rooftop-profile","products/stock-inbox","products/visit-count","products/contact-permissions","products/access-review"]],
    ["AI and conversations", ["products/lot-guide","products/front-desk","products/lot-chat","products/copy-desk"]]]],
  ["solutions", "Solutions", [["By dealership", ["solutions/independent-dealers","solutions/buy-here-pay-here","solutions/franchise-dealers","solutions/dealer-groups"]],["By setup",["solutions/keep-your-website","products/lotline"]]]],
  ["oem", "OEMs", []],
  ["resources", "Resources", [["Learn", ["resources/release-notes","resources/walkthroughs","resources/field-notes"]],["Field guides",["resources/vehicle-page-checklist","resources/measuring-test-drives"]]]],
  ["company", "Company", [["Our team",["company/about","company/leadership","company/work-with-us"]],["Our work",["company/our-approach","company/dealer-stories"]]]],
  ["partners", "Partners", [["Working together",["partners/integrations","partners/standards"]]]]
];
const descriptions = { "products/lotline":"Dealership websites", "products/answer-index":"AI search visibility", "products/deal-path":"Digital retailing",
  "solutions/keep-your-website":"Phone and chat packages" };
const linkName = key => key === "ads-management" ? "Campaign Studio" : catalog.get(key)[1];
const isPlanned = key => planned.has(key.replace(/^products\//, ""));
const description = key => descriptions[key] || (key === "ads-management" ? "Managed digital advertising" : catalog.get(key)[2]);

function links(items, compact=false) {
  return items.map(key => `<a href="${pathFor(key)}"><span>${plain(linkName(key))}</span>${compact ? "" : `<small>${plain(description(key))}${isPlanned(key) ? " · Planned" : ""}</small>`}</a>`).join("");
}
function group(title, content) {
  return `<div class="mn-group"><p>${plain(title)}</p>${content}</div>`;
}
function dropdown([key,label,groups]) {
  const compact = key !== "products";
  const groupsHTML = key === "oem" ? [makes.slice(0,8),makes.slice(8,16),makes.slice(16,24),makes.slice(24)].map(section =>
    group(section[0][0] + " – " + section.at(-1)[0], section.map(make => `<a href="${pathFor(brandPath(make))}">${plain(make)}</a>`).join(""))).join("") :
    groups.map(([label,items]) => group(label, links(items, compact))).join("");
  const descriptor = key === "oem" ? "Manufacturer website programs are in development." : category[key][2];
  const trigger=key==="oem" ? '<span>OEMs<small class="mn-future">Coming Soon</small></span>' : label;
  return `<details class="mn-disclosure" name="site-menu"><summary>${trigger}<i aria-hidden="true"></i></summary>
    <div class="mn-panel${compact ? " mn-compact" : ""}"><div class="mn-grid"><div class="mn-intro">
    ${key === "oem" ? '<strong class="mn-status">Coming Soon</strong>' : ""}<strong class="mn-title">${plain(category[key][1])}</strong><p>${plain(descriptor)}</p>
    <a href="/${key}/">Explore ${plain(category[key][0].toLowerCase())} <span aria-hidden="true">→</span></a></div>
    ${groupsHTML}</div></div></details>`;
}
const header = `<header class="mast"><a class="mn-skip" href="#page-content">Skip to content</a>
  <div class="mn-utility"><div><a href="/#pricing">Pricing</a><a href="/signup.html">Dealer signup</a><a href="/resources/dealer-sign-in/">Client access <span aria-hidden="true">↗</span></a></div></div>
  <div class="mn-bar"><a class="mn-logo" href="/" aria-label="AutoDealership.SI home"><img src="/brand/logo-dark.webp" alt="AutoDealership.SI" width="216" height="72"></a>
  <button class="mn-mobile" type="button" aria-expanded="false" aria-controls="main-nav" hidden>Menu</button>
  <nav class="mn-nav" id="main-nav" aria-label="Main navigation">${nav.map(dropdown).join("")}<a class="mn-contact" href="/contact/">Contact</a></nav>
  <a class="mn-cta" href="/#book-demo">Book a demo <span aria-hidden="true">↗</span></a></div></header>`;
const assets = '<link rel="stylesheet" href="/navigation.css?v=1"><script defer src="/navigation.js?v=1"></script>';
const foot = '<footer class="catalog-foot"><a href="/"><img src="/brand/logo-dark.webp" alt="AutoDealership.SI" width="166" height="55"></a><div><a href="/#pricing">Pricing</a><a href="/signup.html">Dealer signup</a><a href="/contact/">Contact</a></div><small>Website Design and Super Intelligence by <a href="https://autodealership.si/">AutoDealership.SI</a></small></footer>';

function crumbs(items) {
  return `<nav class="catalog-trail" aria-label="Breadcrumb"><a href="/">Home</a>${items.map(([name,url])=>`<span aria-hidden="true">/</span>${url ? `<a href="${url}">${plain(name)}</a>` : `<span aria-current="page">${plain(name)}</span>`}`).join("")}</nav>`;
}
function page(key,title,desc,main,trail,noindex=false) {
  const url=pathFor(key);
  const structured = { "@context":"https://schema.org", "@type":"BreadcrumbList", itemListElement:[["Home","/"],...trail].map(([name,link],i)=>({"@type":"ListItem",position:i+1,name,item:origin+(link || url)}))};
  const content=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#101113"><title>${plain(title)} | AutoDealership.SI</title>
<link rel="canonical" href="${origin}${url}"><meta name="description" content="${plain(desc)}">${noindex ? '<meta name="robots" content="noindex,follow">' : ""}
<link rel="stylesheet" href="/site.css">${assets}<script type="application/ld+json">${JSON.stringify(structured).replaceAll("<","\\u003c")}</script></head>
<body>${header}<main id="page-content" class="catalog">${crumbs(trail)}${main}</main>${foot}</body></html>
`;
  const file=join(root,key,"index.html");mkdirSync(dirname(file),{recursive:true});writeFileSync(file,content);
  if(!noindex)indexable.add(url);
}
function button(href,label,quiet=false) {
  return `<a class="${quiet?"catalog-link":"catalog-action"}" href="${plain(href)}">${plain(label)} <span aria-hidden="true">↗</span></a>`;
}
function tiles(keys) {
  return `<div class="catalog-tiles">${keys.map(key => `<a href="${pathFor(key)}"><small>${plain(description(key))}${isPlanned(key)?" · Planned":""}</small><b>${plain(linkName(key))} <span aria-hidden="true">↗</span></b><p>${plain(key==="ads-management"?"Explore ten dealership campaign examples across five stages of buyer awareness.":catalog.get(key)[3])}</p></a>`).join("")}</div>`;
}
function heading(kicker,title,desc,status="") {
  return `<div class="catalog-heading"><p class="catalog-kicker">${plain(kicker)}</p><h1>${plain(title)}</h1>${status ? `<strong class="catalog-status">${plain(status)}</strong>` : ""}<p class="catalog-deck">${plain(desc)}</p></div>`;
}
function heroAction(key) {
  if(key==="contact")return button(meeting,"Book a meeting");
  if(key.endsWith("walkthroughs"))return button("/#demo-video","Watch the demo");
  if(key.endsWith("dealer-sign-in"))return "";
  if(key.endsWith("franchise-dealers"))return button("/oem/","View OEM status");
  if(isPlanned(key))return button(meeting,"Discuss this roadmap");
  if(["products/lotline","products/deal-path","products/lot-guide","company/dealer-stories","solutions/buy-here-pay-here","solutions/independent-dealers"].includes(key))return button(demo,"Explore the showroom");
  if(["products/front-desk","products/lot-chat","solutions/keep-your-website"].includes(key))return button("/#pricing","Compare plans");
  return button(meeting,"Book a walkthrough");
}
const related = {
  products:["products/lotline","products/lot-guide","products/stock-inbox","products/visit-count"],
  solutions:["products/lotline","products/deal-path","products/lot-guide"],
  resources:["resources/vehicle-page-checklist","resources/measuring-test-drives","resources/walkthroughs"],
  company:["company/our-approach","resources/walkthroughs","company/leadership"],
  partners:["partners/integrations","partners/standards","products/feed-desk"],
  contact:["resources/dealer-sign-in","resources/walkthroughs","solutions/keep-your-website"]
};
for(const [key,label,topic,desc,a,detailA,b,detailB] of catalog.values()){
  const prefix=key.split("/")[0], isaProduct=prefix==="products";
  const section=category[prefix];
  const trail=[...(section?[[section[0],"/"+prefix+"/"]]:[]),[label,null]];
  const signIn=key.endsWith("dealer-sign-in");
  const fields=signIn?`<form class="dealer-find" action="/resources/dealer-sign-in/" id="dealer-finder"><label for="store-slug">Dealership subdomain</label><input id="store-slug" name="store" required autocomplete="off" placeholder="your-dealership" pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*" maxlength="63"><span>.autodealership.si</span><button>Open dealer dashboard →</button><noscript>Open your store’s subdomain and select Dealer sign-in in its footer.</noscript></form><div class="catalog-actions">${button("/admin","Platform admin",true)}${button("/onboarding/","Engineer sign-in",true)}</div>`:"";
  const recommended=(related[prefix] || related.contact).filter(k=>k!==key).slice(0,2);
  const notes = isPlanned(key) ? "Planned" : "";
  page(key,isaProduct?label+" · "+topic:label,desc,`<section class="catalog-hero"><div>${heading(topic,label,desc,notes)}<div class="catalog-actions">${heroAction(key)}${!signIn&&key!=="contact"?button("/contact/","Talk to our team",true):""}</div>${fields}</div>
  <div class="catalog-notes"><section><h2>${plain(a)}</h2><p>${plain(detailA)}</p></section><section><h2>${plain(b)}</h2><p>${plain(detailB)}</p></section></div></section>
  <section class="catalog-related"><h2>Explore next</h2>${tiles(recommended)}</section>`,trail);
}
for(const [key,[label,title,desc]] of Object.entries(category)){
  const descriptor=nav.find(item=>item[0]===key);
  let body;
  if(key==="oem"){
    body=`<div class="oem-list">${makes.map(make=>`<a href="${pathFor(brandPath(make))}">${plain(make)} <span aria-hidden="true">↗</span></a>`).join("")}</div><div class="catalog-actions">${button(meeting,"Discuss your manufacturer")}</div>`;
  }else{
    body=descriptor[2].map(([heading,keys])=>`<section class="catalog-collection"><h2>${plain(heading)}</h2>${tiles(keys)}</section>`).join("");
  }
  page(key,title,desc,`<section class="catalog-overview">${heading(label,title,desc,key==="oem"?"Coming Soon":"")}${body}</section>`,[[label,null]]);
}
for(const make of makes){
  const key=brandPath(make);
  const desc=`AutoDealership.SI’s ${make} OEM website program is Coming Soon. Certification is a future milestone and dealer enrollment has yet to open.`;
  const detail=`<section class="catalog-hero"><div>${heading("Manufacturer programs", make+" websites",desc,"Coming Soon")}<div class="catalog-actions">${button(meeting,"Discuss this manufacturer")}${button("/oem/","View all makes",true)}</div></div>
  <div class="catalog-notes"><section><h2>What your team can review</h2><p>Explore the franchise showroom, inventory feed and artwork review process in a guided demonstration.</p></section><section><h2>Before enrollment</h2><p>Bring the current website program requirements from your ${plain(make)} representative. Enrollment and eligibility for reimbursement depend on the manufacturer’s written approval.</p></section></div></section>`;
  page(key,make+" OEM program · Coming Soon",desc,detail,[["OEM programs","/oem/"],[make,null]],true);
}
// Preserve hand-authored sections and commerce pages while updating their shared header.
for (const entry of ["index.html","ads-management/index.html","signup.html"]) {
  const file=join(root,entry);
  let html=readFileSync(file,"utf8").replace(/<header\b[^>]*>[\s\S]*?<\/header>/,()=>header);
  if(!html.includes('href="/navigation.css'))html=html.replace("</head>",assets+"</head>");
  html=html.replace(/<main(?=[ >])(?![^>]* id="page-content")/,'<main id="page-content"');
  if(entry==="ads-management/index.html")html=html.replace('<p class="eyebrow">Managed advertising</p>','<p class="eyebrow">Campaign Studio · Managed advertising</p>');
  writeFileSync(file,html);
}
writeFileSync(join(root,"sitemap.xml"),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...indexable].sort().map(path=>`  <url><loc>${origin}${path}</loc></url>`).join("\n")}\n</urlset>\n`);
