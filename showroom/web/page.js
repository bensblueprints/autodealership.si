(() => {
  "use strict";
  const byId=id=>document.getElementById(id);
  const pageKey=DealerPages.currentKey();
  const usd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0});
  const lower=value=>String(value||"").trim().toLowerCase();
  const predicates=DealerSitePages.inventoryFilters;
  const links={
    "service-department":"Explore service offerings","schedule-service":"Open online scheduler","parts-catalog":"Open parts catalog",
    "apply-financing":"Start credit application","finance-center":"Visit financing center","value-trade":"Start trade appraisal","contact":"Contact the dealership",
    about:"Learn about the dealership",staff:"View staff directory",testimonials:"Read customer testimonials","why-service":"Explore dealership service"
  };
  const related={
    "service-department":["schedule-service","parts-catalog","why-service"],"schedule-service":["service-department","contact"],
    "parts-catalog":["service-department","contact"],"why-service":["schedule-service","service-department"],
    "finance-center":["payment-calculator","apply-financing","value-trade"],"apply-financing":["finance-center","payment-calculator"],
    "payment-calculator":["apply-financing","finance-center"],"value-trade":["pre-owned","contact"],
    about:["staff","testimonials","contact"],staff:["contact","about"],testimonials:["about","contact"]
  };
  function el(tag,text,className){
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  }
  function anchor(title,href,external=false){
    const a=el("a",title);a.href=href;
    if(external){a.target="_blank";a.rel="noopener noreferrer";}
    return a;
  }
  function replaceParam(name,value) {
    const url=new URL(location.href);
    if(value)url.searchParams.set(name,value);else url.searchParams.delete(name);
    history.replaceState(null,"",url);
  }
  function inventory(parent,test){
    const url=new URL(location.href),controls=el("div",undefined,"page-controls"),count=el("span"),input=el("input");
    count.setAttribute("role","status");
    input.type="search";input.placeholder="Search make, model, VIN or stock";input.setAttribute("aria-label","Search these vehicles");
    input.value=url.searchParams.get("search")||"";
    controls.append(count,input);const grid=el("div",undefined,"page-grid"),pagination=el("nav",undefined,"pagination");
    pagination.setAttribute("aria-label","Inventory pages");parent.append(controls,grid,pagination);
    const all=Store.cars().filter(test);
    function draw(){
      const words=lower(input.value).split(/\s+/).filter(Boolean),matches=all.filter(c=>{
        const hay=lower([c.year,c.make,c.model,c.trim,c.vin,c.stock].join(" "));
        return words.every(term=>hay.includes(term));
      });
      const perPage=24, total=Math.max(1,Math.ceil(matches.length/perPage)),n=Number(new URL(location.href).searchParams.get("p"));
      const page=Math.max(1,Math.min(total, Number.isInteger(n)?n:1));grid.replaceChildren();pagination.replaceChildren();
      count.textContent=matches.length.toLocaleString()+" vehicle"+(matches.length===1?"":"s");
      for(const c of matches.slice((page-1)*perPage,page*perPage)){
        const a=anchor("","vehicle.html?stock="+encodeURIComponent(c.id));a.className="result-card";
        const missing=()=>el("div","Photo unavailable","missing-img");
        if(c.image && (DealerPages.safeUrl(c.image)||/^(?:assets\/|\/api\/vehicle-photos\/)/.test(c.image)||/^data:image\/(jpeg|png|webp);base64,/i.test(c.image))){
          const img=el("img");img.alt=c.imageType==="stock"?"Representative image":"";img.loading="lazy";img.src=c.image;
          img.onerror=()=>img.replaceWith(missing());a.append(img);
        }else a.append(missing());
        const copy=el("div",undefined,"copy");copy.append(el("h2",[c.year,c.make,c.model].filter(Boolean).join(" ")));
        if(c.imageType==="stock")copy.append(el("p","Representative image"));
        copy.append(el("p",[c.trim,Number.isFinite(c.miles)?c.miles.toLocaleString()+" mi":""].filter(Boolean).join(" · ")),
          el("strong",typeof c.price==="number"&&c.price>0?usd.format(c.price):"Ask for price"));
                  const ids=el("div",undefined,"card-identifiers");
          for(const [label,value] of [["Stock #",c.stock],["VIN",c.vin]]){
            const line=el("span",label+" ");line.append(el("b",value||"Unavailable"));ids.append(line);
          }
          copy.insertBefore(ids,copy.lastElementChild);
          a.append(copy);grid.append(a);
      }
      if(!matches.length)grid.append(el("p","No matching vehicles. Try another search."));
      function pager(label,number) {
        const href=new URL(location.href);href.searchParams.set("p",String(number));
        return anchor(label,href.pathname+href.search);
      }
      if(total>1){
        if(page>1)pagination.append(pager("← Previous",page-1));
        pagination.append(el("span","Page "+page+" of "+total));
        if(page<total)pagination.append(pager("Next →",page+1));
      }
    }
    input.oninput=()=>{replaceParam("search",input.value.trim());replaceParam("p","");draw();};draw();
  }
  function calculator(parent){
    const form=el("form",undefined,"calc"), fields={};
    const values=[["price","Vehicle price ($)",30000,0,100000000,.01],["down","Down payment ($)",3000,0,100000000,.01],["rate","Annual percentage rate (%)",7,0,100,.01],["months","Loan term (months)",60,1,120,1]];
    for(const [key,label,value,min,max,step] of values){
      const item=el("label",label),input=el("input");input.type="number";input.value=value;input.min=min;input.max=max;input.step=step;input.required=true;
      fields[key]=input;item.append(input);form.append(item);
    }
    const output=el("output");output.setAttribute("aria-live","polite");
    const calculate=()=>{
      const read=k=>fields[k].valueAsNumber;
      if(!Object.values(fields).every(f=>f.validity.valid)||read("down")>read("price")){output.textContent="Check your loan amounts and term.";return;}
      const monthly=Retail.amount({price:read("price")},"finance",{months:read("months"),rate:read("rate"),down:read("down")});
      output.textContent=usd.format(monthly)+" / month";
    };
    form.addEventListener("input",calculate);form.onsubmit=e=>e.preventDefault();
    form.append(output,el("small","Estimate before taxes and fees. Your lender determines the final terms."));calculate();parent.append(form);
  }
  function render(){
    const all=DealerPages.list(), page=all.find(p=>p.key===pageKey&&p.enabled);
    byId("tools").replaceChildren();byId("related").replaceChildren();
    byId("group").textContent=page?.group||"";byId("heading").textContent=page?.title||"Page unavailable";
    byId("intro").textContent=page?.body||"";document.title=byId("heading").textContent+" · "+Store.settings().dealerName;
    if(!page)return;
    const tools=byId("tools");
    if(page.url){
      const group=el("div",undefined,"page-actions");group.append(anchor(links[page.key]||"Visit dealer website",page.url,true));tools.append(group);
    }
    if(predicates[page.key])inventory(tools,predicates[page.key]);
    if(page.key==="payment-calculator")calculator(tools);
    const group=el("nav",undefined,"page-related");group.setAttribute("aria-label","Related pages");
    for(const key of related[page.key]||[]){
      const other=all.find(p=>p.key===key&&p.enabled);if(other)group.append(anchor(other.title,DealerPages.href(other.key)));
    }
    if(group.childElementCount)byId("related").append(group);
  }
  Store.profileReady.then(()=>{
    render();
    window.addEventListener("showroom:update",render);
    window.addEventListener("storage",render);
  });
})();
