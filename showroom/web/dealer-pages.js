const DealerSitePages=(()=>{
  const demoOrigin="https://www.capcitycdjr.com";
  const core=[
    ["all-inventory", "All vehicles", "Inventory", "/inventory/", "Explore available vehicles and open a listing for photos, prices and test drives."],
    ["new-vehicles", "New Vehicles", "Inventory", "/inventory/new/", "Shop new cars, trucks, SUVs and vans. Select a vehicle for its listed equipment, price and availability."],
    ["pre-owned", "Pre-Owned Vehicles", "Inventory", "/inventory/used/", "Browse pre-owned inventory, including certified pre-owned vehicles."],
    ["certified-pre-owned", "Certified Pre-Owned Vehicles", "Inventory", "/inventory/certified/", "These listings are identified as certified pre-owned by the dealership. Ask the sales team about the certification and coverage on the vehicle you select."],
    ["under-20k", "Priced Under 20K", "Inventory", "/inventory/under-20000/", "Explore pre-owned vehicles with an advertised asking price below $20,000."],
    ["service-department", "Service Department", "Service", "/service/", "Contact a service advisor about maintenance, diagnostics or repairs. Have your vehicle’s year, model and current mileage ready.", "/service-department/"],
    ["schedule-service", "Schedule Service", "Service", "/service/schedule/", "Choose your service and appointment time using the dealership’s online scheduler. For timing questions or help choosing a service, call the service department.", "/service-department/schedule-service/"],
    ["parts-catalog", "Parts Catalog", "Parts", "/parts/", "Use the dealership’s parts catalog to look up compatible parts and accessories. A parts specialist can help confirm fitment using your VIN.", "/parts-catalogs/"],
    ["finance-center", "Finance Center", "Financing", "/finance/", "Explore financing for a vehicle on the lot. Estimate a monthly payment or use the dealer’s credit application to discuss available terms.", "/finance/"],
    ["apply-financing", "Apply for Financing", "Financing", "/finance/apply/", "Continue to the dealer’s financing application to submit your information directly to its finance team.", "/finance/apply-for-financing/"],
    ["payment-calculator", "Payment Calculator", "Financing", "/finance/payment-calculator/", "Estimate a monthly loan payment by adjusting the vehicle price, down payment, interest rate and loan term."],
    ["value-trade", "Value Your Trade", "Trade-in", "/trade-in/", "Start a trade-in appraisal with your VIN, mileage and vehicle condition. The dealer can confirm the value after reviewing your vehicle.", "/value-your-trade/"],
    ["about", "About Us", "About", "/dealership/", "Learn about the dealership, meet the team and find the right department for your visit.", "/about-us/"],
    ["contact", "Contact Us", "About", "/dealership/contact/", "Contact the sales, service or parts department to plan your visit or ask about a vehicle."],
    ["staff", "Meet Our Staff", "About", "/dealership/staff/", "Find the dealership team member who can help with sales, financing, service or parts.", "/about-us/staff/"],
    ["testimonials", "Customer Testimonials", "About", "/dealership/reviews/", "Read published customer experiences on the dealership’s testimonials page.", "/about-us/customer-testimonials/"],
    ["why-service", "Why Service Here", "About", "/service/why-service-here/", "Learn about the dealership’s service facilities and maintenance offerings, then schedule a visit with the service team.", "/why-service-here/"]
  ];
  const optional=[
    ["model-research", "Model research", "Inventory", "/inventory/model-research/"],
    ["incoming", "Incoming vehicles", "Inventory", "/inventory/incoming/"],
    ["comparisons", "Model comparisons", "Inventory", "/inventory/comparisons/"],
    ["leasing", "Leasing", "Financing", "/finance/leasing/"],
    ["sell-car", "Sell your car", "Trade-in", "/trade-in/sell-your-car/"],
    ["new-specials", "New vehicle specials", "Specials", "/specials/new/"],
    ["used-specials", "Used vehicle specials", "Specials", "/specials/used/"],
    ["finance-specials", "Finance specials", "Specials", "/specials/finance/"],
    ["lease-specials", "Lease specials", "Specials", "/specials/lease/"],
    ["service-specials", "Service specials", "Specials", "/specials/service/"],
    ["parts-specials", "Parts specials", "Specials", "/specials/parts/"],
    ["maintenance", "Maintenance and service pricing", "Service", "/service/maintenance/"],
    ["recalls", "Recall information", "Service", "/service/recalls/"],
    ["order-parts", "Order parts", "Parts", "/parts/order/"],
    ["accessories", "Accessories", "Parts", "/parts/accessories/"],
    ["fleet", "Fleet and business sales", "Commercial", "/commercial/fleet/"],
    ["ev-inventory", "Electric vehicles", "Electric vehicles", "/inventory/electric/"],
    ["ev-ownership", "Charging and ownership", "Electric vehicles", "/electric/ownership/"],
    ["ev-incentives", "EV incentives", "Electric vehicles", "/electric/incentives/"],
    ["directions", "Hours and directions", "About", "/dealership/hours-directions/"],
    ["careers", "Careers", "About", "/dealership/careers/"],
    ["community", "Community", "About", "/dealership/community/"],
    ["news", "News and articles", "News & events", "/news/"],
    ["events", "Dealership events", "News & events", "/news/events/"],
    ["campaign", "Campaign offers", "Specials", "/specials/campaign/"],
    ["privacy", "Privacy notice", "Legal", "/legal/privacy/"],
    ["terms", "Terms of use", "Legal", "/legal/terms/"],
    ["accessibility", "Accessibility", "Legal", "/legal/accessibility/"],
    ["disclosures", "Advertising disclosures", "Legal", "/legal/disclosures/"]
  ];
  const catalog=[...core,...optional].map(([key,title,group,path,body="",demoPath=""])=>({key,title,group,path,body,demoPath,editorial:!body}));
  const requiresApr=new Set(["finance-center","apply-financing","payment-calculator","leasing","finance-specials","lease-specials"]);
  const templates={
    classic:{label:"Showroom",heading:"Explore inventory",pages:[]},
    franchise:{label:"Franchise / OEM",heading:"Shop by department",pages:["new-vehicles","pre-owned","certified-pre-owned"],links:["new-vehicles","pre-owned","certified-pre-owned","new-specials","schedule-service","order-parts"]},
    independent:{label:"Independent dealer",heading:"Find your next vehicle",pages:["pre-owned","under-20k"],links:["all-inventory","under-20k","value-trade","contact"]},
    bhph:{label:"Buy Here Pay Here",heading:"Shop by payment",pages:["pre-owned"],links:["all-inventory","contact"]}
  };
  function templateKey(value){return Object.hasOwn(templates,value)?value:"classic";}
  function safeUrl(value){
    try{const u=new URL(value);return u.protocol==="https:" && !u.username && !u.password?u.href:"";}catch{return "";}
  }
  const blockKinds={section:"Text section",checklist:"Checklist",question:"Question and answer"};
  function blocksForDraft(input){
    if(input===undefined)return [];
    if(!Array.isArray(input)||input.length>12)throw Error("Use up to 12 content blocks per page.");
    return input.map((b,i)=>{
      if(!b || !Object.hasOwn(blockKinds,b.kind)||typeof b.heading!=="string"||b.heading.length>160||typeof b.text!=="string"||b.text.length>3000)
        throw Error("Check the type, heading (160 characters) and text (3,000 characters) of block "+(i+1)+".");
      return {kind:b.kind,heading:b.heading.trim(),text:b.text.trim()};
    });
  }
  function blockMarkup(blocks=[]){
    const escape=s=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    return blocks.filter(b=>b.heading && b.text && Object.hasOwn(blockKinds,b.kind)).map(b=>{
      const heading=escape(b.heading),text=escape(b.text);
      if(b.kind==="question")return '<details class="page-question"><summary>'+heading+'</summary><p>'+text+'</p></details>';
      const body=b.kind==="checklist"?"<ul>"+text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>"<li>"+line+"</li>").join("")+"</ul>":"<p>"+text+"</p>";
      return '<section class="page-copy-section"><h2>'+heading+"</h2>"+body+"</section>";
    }).join("");
  }
  function list(settings={},tenant=true,apr=true){
    const saved=settings?.pages||{};
    const overrides=Array.isArray(saved)?Object.fromEntries(saved.filter(p=>p?.key).map(p=>[p.key,p])):saved;
    return catalog.map(base=>{
      const edit=overrides[base.key],body=edit?.body??base.body;
      const enabled=edit?(edit.enabled!==false):base.key==="all-inventory"||templates[templateKey(settings.profile?.siteTemplate)].pages.includes(base.key)||(!tenant&&!base.editorial);
      const blocks=Array.isArray(edit?.blocks)?edit.blocks.filter(b=>b && Object.hasOwn(blockKinds,b.kind) && typeof b.heading==="string" && typeof b.text==="string" && b.heading.trim() && b.text.trim()):[];
      return {...base,title:edit?.title?.trim()||base.title,body,...(blocks.length?{blocks}:{}),
        enabled:enabled && (!base.editorial || !!body.trim() || !!blocks.length) && (apr || !requiresApr.has(base.key)),
        url:safeUrl(edit?.url??(!tenant&&base.demoPath?demoOrigin+base.demoPath:""))};
    });
  }
  const condition=car=>String(car.condition||"").trim().toLowerCase();
  const used=car=>/used|pre.?owned|certified/.test(condition(car));
  const inventoryFilters={
    "all-inventory":()=>true,"new-vehicles":car=>condition(car)==="new","pre-owned":used,
    "certified-pre-owned":car=>condition(car).includes("certified"),
    "under-20k":car=>used(car) && Number(car.price)>0 && Number(car.price)<20000,
    incoming:car=>/in transit|incoming/i.test(car.status||""),
    "ev-inventory":car=>/^(electric|electricity|battery electric)$/i.test(car.fuel||"")
  };
  return {catalog,list,safeUrl,requiresApr,inventoryFilters,templates,templateKey,blockKinds,blocksForDraft,blockMarkup};
})();
if(typeof window!=="undefined"){
  const nativeRoutes=()=>window.postgresInventory && (window.clientSite || location.hostname==="demo.autodealership.si") && !location.pathname.startsWith("/clients/");
  const href=key=>nativeRoutes()?DealerSitePages.catalog.find(p=>p.key===key)?.path:"page.html?page="+encodeURIComponent(key);
  const currentKey=()=>DealerSitePages.catalog.find(p=>p.path===location.pathname)?.key || new URL(location.href).searchParams.get("page") || "about";
  window.DealerPages={href,currentKey,safeUrl:DealerSitePages.safeUrl,
    get defaults(){return DealerSitePages.list({profile:Store.settings().profile},!!window.clientSite);},
    list:()=>DealerSitePages.list(Store.settings(),!!window.clientSite,Store.aprAllowed())};
}
