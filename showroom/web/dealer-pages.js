(() => {
  "use strict";
  const official = "https://www.capcitycdjr.com";
  const rows = [
    ["new-vehicles","New Vehicles","Inventory","Shop new cars, trucks, SUVs and vans. Select a vehicle for its listed equipment, price and availability."],
    ["pre-owned","Pre-Owned Vehicles","Inventory","Browse pre-owned inventory, including certified pre-owned vehicles."],
    ["certified-pre-owned","Certified Pre-Owned Vehicles","Inventory","These listings are identified as certified pre-owned by the dealership. Ask the sales team about the certification and coverage on the vehicle you select."],
    ["under-20k","Priced Under 20K","Inventory","Explore pre-owned vehicles with an advertised asking price below $20,000."],
    ["service-department","Service Department","Service","Contact a service advisor about maintenance, diagnostics or repairs. Have your vehicle’s year, model and current mileage ready.","/service-department/"],
    ["schedule-service","Schedule Service","Service","Choose your service and appointment time using the dealership’s online scheduler. For timing questions or help choosing a service, call the service department.","/service-department/schedule-service/"],
    ["parts-catalog","Parts Catalog","Service","Use the dealership’s parts catalog to look up Mopar parts and accessories. A parts specialist can help confirm fitment using your VIN.","/parts-catalogs/"],
    ["finance-center","Finance Center","Financing","Explore financing for a vehicle on the lot. Estimate a monthly payment or use the dealer’s credit application to discuss available terms.","/finance/"],
    ["apply-financing","Apply for Financing","Financing","Continue to the dealer’s financing application to submit your information directly to its finance team.","/finance/apply-for-financing/"],
    ["payment-calculator","Payment Calculator","Financing","Estimate a monthly loan payment by adjusting the vehicle price, down payment, interest rate and loan term."],
    ["value-trade","Value Your Trade","Financing","Start a trade-in appraisal with your VIN, mileage and vehicle condition. The dealer can confirm the value after reviewing your vehicle.","/value-your-trade/"],
    ["about","About Us","About","Learn about the dealership, meet the team and find the right department for your visit.","/about-us/"],
    ["contact","Contact Us","About","Contact the sales, service or parts department to plan your visit or ask about a vehicle."],
    ["staff","Meet Our Staff","About","Find the dealership team member who can help with sales, financing, service or parts.","/about-us/staff/"],
    ["testimonials","Customer Testimonials","About","Read published customer experiences on the dealership’s testimonials page.","/about-us/customer-testimonials/"],
    ["why-service","Why Service Here","About","Learn about the dealership’s service facilities and maintenance offerings, then schedule a visit with the service team.","/why-service-here/"]
  ];
  const defaults=rows.map(([key,title,group,body,path])=>({key,title,group,body,url:path?official+path:"",enabled:true}));
  function safeUrl(value) {
    try {
      const url=new URL(value);
      return url.protocol==="https:" && !url.username && !url.password ? url.href : "";
    } catch {return "";}
  }
  function list() {
    const overrides=window.Store?.settings()?.pages||{};
    const byKey=Array.isArray(overrides) ? Object.fromEntries(overrides.filter(p=>p?.key).map(p=>[p.key,p])) : overrides;
    return defaults.map(base=>{
      if(!Store.financingAllowed() && ["finance-center","apply-financing","payment-calculator"].includes(base.key))return {...base,enabled:false,url:""};
      const change=byKey[base.key]||{};
      if(window.clientSite && !byKey[base.key])return {...base,enabled:false,url:""};
      return {...base,title:typeof change.title==="string" && change.title.trim()?change.title.trim():base.title,
        body:typeof change.body==="string"?change.body:base.body,
        url:safeUrl(typeof change.url==="string"?change.url:(window.clientSite?"":base.url)),enabled:change.enabled!==false};
    });
  }
  const href=key=>"page.html?page="+encodeURIComponent(key);
  window.DealerPages={defaults,list,href,safeUrl};
})();


