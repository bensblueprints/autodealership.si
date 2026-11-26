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
  function safeUrl(value){
    try{const u=new URL(value);return u.protocol==="https:" && !u.username && !u.password?u.href:"";}catch{return "";}
  }
  function list(settings={},tenant=true,apr=true){
    const saved=settings?.pages||{};
    const overrides=Array.isArray(saved)?Object.fromEntries(saved.filter(p=>p?.key).map(p=>[p.key,p])):saved;
    return catalog.map(base=>{
      const edit=overrides[base.key],body=edit?.body??base.body;
      const enabled=edit?(edit.enabled!==false):base.key==="all-inventory"||(!tenant&&!base.editorial);
      return {...base,title:edit?.title?.trim()||base.title,body,
        enabled:enabled && (!base.editorial || !!body.trim()) && (apr || !requiresApr.has(base.key)),
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
  return {catalog,list,safeUrl,requiresApr,inventoryFilters};
})();
if(typeof window!=="undefined"){
  const nativeRoutes=()=>window.postgresInventory && (window.clientSite || location.hostname==="demo.autodealership.si") && !location.pathname.startsWith("/clients/");
  const href=key=>nativeRoutes()?DealerSitePages.catalog.find(p=>p.key===key)?.path:"page.html?page="+encodeURIComponent(key);
  const currentKey=()=>DealerSitePages.catalog.find(p=>p.path===location.pathname)?.key || new URL(location.href).searchParams.get("page") || "about";
  window.DealerPages={href,currentKey,safeUrl:DealerSitePages.safeUrl,
    get defaults(){return DealerSitePages.list({},!!window.clientSite);},
    list:()=>DealerSitePages.list(Store.settings(),!!window.clientSite,Store.aprAllowed())};
}
