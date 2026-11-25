(() => {
  "use strict";
  const fields = {
    year: "Year", make: "Make", model: "Model", trim: "Trim", features: "Features",
    fuel: "Fuel type", transmission: "Transmission", miles: "Mileage", engine: "Engine",
    color: "Color", body: "Body style", doors: "Doors", location: "Location", status: "Status"
  };
  const iconNames = {
    "year": "clock-outline",
    "make": "car-multiple",
    "model": "car",
    "trim": "plus-box-outline",
    "features": "clipboard-check",
    "fuel": "gas-station",
    "transmission": "car-shift-pattern",
    "miles": "speedometer",
    "engine": "engine",
    "color": "format-color-fill",
    "body": "car-side",
    "doors": "car-door",
    "location": "map-marker",
    "status": "car-connected",
    "3rd row seat": "car-seat",
    "adaptive cruise control": "car-cruise-control",
    "android auto": "android",
    "apple carplay": "apple",
    "automatic climate control": "thermometer-auto",
    "awd": "axis-arrow",
    "backup camera": "camera-rear",
    "blind spot monitor": "car-wireless",
    "bluetooth": "bluetooth",
    "fog lights": "car-light-fog",
    "forward collision warning": "car-brake-alert",
    "hands free liftgate": "car-hatchback",
    "heated seats": "car-seat-heater",
    "keyless entry": "car-key",
    "navigation": "navigation",
    "moonroof": "car-convertible"
};
  function icon(key) {
    return '<svg class="inventory-icon" aria-hidden="true"><use href="assets/inventory-icons.svg#'+(iconNames[key] || "clipboard-check")+'"></use></svg>';
  }
  const modes = {cash:"Cash", finance:"Finance", lease:"Lease"};
  const selected = new Map();
  const equipment = new Set();
  const section = document.getElementById("inventory");
  const get = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const keyFor = value => String(value).trim().toLowerCase().replace(/[-–]/g, " ").replace(/\s+/g, " ");
  const aliases = {
    "all wheel drive":"awd", "dual motor all wheel drive":"awd", "rearview camera":"backup camera",
    "rear view camera":"backup camera", "third row seating":"3rd row seat", "three row seating":"3rd row seat",
    "heated front seats":"heated seats", "power moonroof":"moonroof", "bluetooth audio":"bluetooth"
  };
  const labelFor = {
    awd:"AWD", "backup camera":"Backup camera", "3rd row seat":"3rd row seat", "heated seats":"Heated seats", moonroof:"Moonroof", bluetooth:"Bluetooth"
  };
  const featuredKeys = ["3rd row seat","adaptive cruise control","android auto","apple carplay","automatic climate control","awd","backup camera","blind spot monitor","bluetooth","fog lights","forward collision warning","hands free liftgate","heated seats","keyless entry","navigation","moonroof"];
  const featureKey = feature => aliases[keyFor(feature)] || keyFor(feature);
  let mode = "cash", minimum = null, maximum = null, layout = "browse", sort = "recommended", options = {};
  const enabled = key => options[key] !== false && (!["finance","lease"].includes(key)||Store.financingAllowed());
  function reset() {
    const down=document.getElementById("max-cash-down");if(down)down.value="";
    searchTerms.clear();
    selected.clear();
    equipment.clear();
    minimum = maximum = null;
  }
  function isNarrowed() {
    return !!document.getElementById("max-cash-down")?.value || selected.size > 0 || equipment.size > 0 || minimum !== null || maximum !== null;
  }
  function amount(car) {
    const value = window.Retail?.amount(car,mode) ?? (mode === "cash" ? car.price : null);
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
  }
  function matches(car) {
    if(mode!=="cash" && !Store.financingAllowed(car))return false;
    const down=document.getElementById("max-cash-down")?.value;
    if(down && (!car.bhph || car.bhph.down>Math.round(Number(down)*100)))return false;
    for (const [key,value] of selected) {
      if (key === "miles") {
        if (car.miles === null || car.miles === undefined || car.miles === "" || Number(car.miles)>Number(value)) return false;
      } else if (key === "make" || key === "model") {
        if (VehicleCatalog.key(car[key]) !== VehicleCatalog.key(value)) return false;
      } else if (String(car[key] ?? "") !== value) return false;
    }
    if (equipment.size) {
      const features = new Set((car.features || []).map(featureKey));
      for (const key of equipment) if (!features.has(key)) return false;
    }
    if (minimum !== null || maximum !== null) {
      const price = amount(car);
      if (price === null || (minimum !== null && price < minimum) || (maximum !== null && price > maximum)) return false;
    }
    return true;
  }
  function order(records) {
    const column = {priceLow:"price", priceHigh:"price", year:"year", miles:"miles"}[sort];
    if (!column) return records;
    const direction = sort==="year" || sort==="priceHigh" ? -1 : 1;
    return records.sort((a,b)=>{
      const first=a[column], second=b[column];
      if (first==null || first==="") return second==null || second==="" ? 0 : 1;
      if (second==null || second==="") return -1;
      return direction*(Number(first)-Number(second));
    });
  }

  let priorFeatures=[], featureCatalog=new Map(), featureChoices=[];
  function indexFeatures(cars) {
    if (cars.length===priorFeatures.length && cars.every((c,i)=>c.features===priorFeatures[i])) return;
    priorFeatures=cars.map(c=>c.features);
    featureCatalog=new Map();
    for(const car of cars)for(const feature of car.features || []) {
      const key=featureKey(feature);
      if(key && !featureCatalog.has(key))featureCatalog.set(key,labelFor[key] || feature);
    }
    featureChoices=[...featureCatalog].sort((a,b)=>a[1].localeCompare(b[1]));
  }
  const searchTerms=new Map(), fullChoices=new Map();
  function filteredChoices(key){
    const term=keyFor(searchTerms.get(key)||"").replace(/,/g,"");
    const all=fullChoices.get(key)||[];
    if(!term)return all;
    return all.filter(([value,label])=>{
      const text=keyFor(value+" "+label).replace(/,/g,"");
      return text.includes(term) || (key==="features" && value===featureKey(term));
    });
  }
  function optionMarkup(key,choices,placeholder){
    return '<option value="">'+escape(placeholder)+'</option>'+choices.map(([value,title])=>'<option value="'+escape(value)+'"'+(selected.get(key)===value?' selected':'')+'>'+escape(key==="features" && equipment.has(value)?"✓ "+title:title)+'</option>').join("");
  }
  function prepare(cars) {
    options = window.Store.settings().options || {};
    for (const field of selected.keys()) if (!enabled(field)) selected.delete(field);
    if (!enabled("features")) equipment.clear();
    if (!enabled(mode) || !enabled("price")) {
      mode = Object.keys(modes).find(enabled) || "cash";
      minimum = maximum = null;
    }
    indexFeatures(cars);
    const catalog = featureCatalog;
    for (const key of equipment) if (!catalog.has(key)) equipment.delete(key);
    const downPanel=document.getElementById("bhph-filter");downPanel.hidden=!cars.some(car=>car.bhph);if(downPanel.hidden)downPanel.querySelector("input").value="";
    renderBudget(cars);
    const fieldHtml = [];
    for (const [key,label] of Object.entries(fields)) {
      if (!enabled(key)) continue;
      let choices, hint="", disabled=false, retry=false;
      if (key === "features") {
        choices = featureChoices;
      } else if (key === "year") {
        const stockYears = cars.map(car => Number(car.year)).filter(year => Number.isInteger(year) && year >= 1885 && year <= 2100);
        const newest = Math.max(new Date().getFullYear() + 1, ...stockYears);
        choices = Array.from({length: newest - 1885 + 1}, (_, i) => {
          const year = String(newest - i);
          return [year, year];
        });
      } else if (key === "make" || key === "model") {
        const year = selected.get("year"), make = selected.get("make");
        disabled = (enabled("year") && !year) || (key === "model" && enabled("make") && !make);
        if (disabled) {
          choices = [];
          hint = !year && enabled("year") ? "Choose year first" : "Choose make first";
        } else {
          const list = VehicleCatalog.choices(key,year,make,cars);
          choices = list.values.map(v=>[v,v]);
          if (list.loading) hint = "Loading catalog…";
          else if (list.failed) { hint = "Catalog partially offline"; retry=true; }
          else if (!choices.length) hint = "No catalog entries";
        }
      } else if (key === "miles") {
        choices = [10000,25000,50000,75000,100000,150000].map(n=>[String(n), "Up to "+n.toLocaleString()+" mi"]);
      } else {
        let scope = selected.has("year") ? cars.filter(c=>String(c.year)===selected.get("year")) : cars;
        if ((key === "model" || key === "trim") && selected.has("make")) scope=scope.filter(c=>VehicleCatalog.key(c.make)===VehicleCatalog.key(selected.get("make")));
        if (key === "trim" && selected.has("model")) scope=scope.filter(c=>VehicleCatalog.key(c.model)===VehicleCatalog.key(selected.get("model")));
        const values = [...new Set(scope.map(c=>String(c[key] ?? "").trim()).filter(Boolean))];
        values.sort((a,b)=>key==="year" ? Number(b)-Number(a) : a.localeCompare(b,undefined,{numeric:true}));
        choices = values.map(v=>[v,v]);
        if (selected.has(key) && !values.includes(selected.get(key))) selected.delete(key);
      }
      const placeholder = key==="features" ? (equipment.size ? "Selected ("+equipment.size+")" : "Any feature") : "Any";
      fullChoices.set(key,choices);
      choices=filteredChoices(key);
      const featureInput='<input data-facet-search="'+key+'" type="search" aria-label="Search '+escape(label)+' options" placeholder="Search…" value="'+escape(searchTerms.get(key)||"")+'"'+(disabled?' disabled':'')+'>';
      fieldHtml.push('<div class="facet-field">'+icon(key)+label+featureInput+'<select data-facet="'+key+'" aria-label="'+label+'"'+(disabled?' disabled':'')+'>'+optionMarkup(key,choices,disabled?hint:choices.length?placeholder:"No matches")+'</select>'+(!disabled && hint?'<small>'+hint+'</small>':'')+'</div>'+(retry?'<button type="button" data-retry-catalog>Retry catalog</button>':''));

    }
    get("facetfields").innerHTML=fieldHtml.join("");
    get("filterpanel").parentElement.hidden = !fieldHtml.length && get("budget").hidden;
    section.querySelector(".inventory-layout").classList.toggle("no-sidebar",get("filterpanel").parentElement.hidden);
    const keys = [...new Set([...equipment,...featuredKeys.filter(key=>catalog.has(key))])];
    const strip = get("featurestrip");
    strip.hidden = !enabled("features") || !keys.length;
    strip.innerHTML=keys.map(key=>'<button data-feature="'+escape(key)+'" aria-pressed="'+equipment.has(key)+'">'+icon(key)+escape(catalog.get(key))+'</button>').join("");
  }
  function renderBudget(cars) {
    const box = get("budget");
    const choices = Object.keys(modes).filter(enabled);
    box.hidden = !enabled("price") || choices.length === 0;
    if (box.hidden) return;
    const ceiling = Math.max(1, ...cars.map(amount).filter(value=>value !== null).map(Math.ceil), maximum || 0, minimum || 0);
    const title = mode === "cash" ? "Cash price" : "Monthly "+modes[mode].toLowerCase()+" estimate";
    const note = mode === "cash" ? "" : (window.Retail?.assumptions?.(mode) || "Illustrative monthly estimate, before taxes and fees.");
    box.innerHTML='<div class="budget-modes">'+choices.map(m=>'<button data-mode="'+m+'" aria-pressed="'+(mode===m)+'">'+modes[m]+'</button>').join("")+'</div><h4>'+title+'</h4><div class="budget-range">'+["min","max"].map((bound,i)=>{
      const value = i ? maximum : minimum, end = i ? ceiling : 0;
      return '<label>'+ (i?"Maximum":"Minimum")+'<input type="number" step="1" min="0" inputmode="numeric" aria-label="'+title+' '+bound+'" data-budget="'+bound+'" placeholder="$'+end.toLocaleString()+'" value="'+(value ?? "")+'"><input type="range" aria-label="'+title+' '+bound+' slider" data-budget-slider="'+bound+'" min="0" max="'+ceiling+'" value="'+(value ?? end)+'"></label>';
    }).join("")+'</div>'+(note?'<small>'+escape(note)+'</small>':'');
  }
  function sync(active) {
    get("clearFilters").hidden = !(active || isNarrowed());
    get("sortInventory").value = sort;
    section.querySelectorAll("[data-layout]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.layout===layout)));
  }
  function toggleFeature(value) { if(equipment.has(value))equipment.delete(value);else equipment.add(value); }
  function change() { window.renderShowroom(); }
  section.addEventListener("click",event=>{
    const button=event.target.closest("button");
    if (!button) return;
    if (button.dataset.feature) toggleFeature(button.dataset.feature);
    else if (button.dataset.layout) layout=button.dataset.layout;
    else if (button.dataset.mode) {
      if(mode===button.dataset.mode)return;
      mode=button.dataset.mode;minimum=maximum=null;
    } else if (button.id==="clearFilters") { window.filterCars("");return; }
    else return;
    change();
  });
  section.addEventListener("input",event=>{
    const key=event.target.dataset.facetSearch;
    if(key){
      searchTerms.set(key,event.target.value);
      const choices=filteredChoices(key);
      section.querySelector('[data-facet="'+key+'"]').innerHTML=optionMarkup(key,choices,choices.length?"Choose an option":"No matches");
      return;
    }
    const bound = event.target.dataset.budgetSlider;
    if (bound) section.querySelector('[data-budget="'+bound+'"]').value = event.target.value;
  });
  section.addEventListener("change",event=>{
    if(event.target.id==="max-cash-down"){change();return;}
    const target=event.target, field=target.dataset.facet, value=target.value;
    if(field){
      searchTerms.delete(field);
      if(field==="year")searchTerms.delete("make");
      if(field==="year" || field==="make")searchTerms.delete("model");
      if(["year","make","model"].includes(field))searchTerms.delete("trim");
    }
    if(field==="features"){if(value)toggleFeature(value);else equipment.clear();}
    else if(field){
      if(value)selected.set(field,value);else selected.delete(field);
      if(field==="year"){selected.delete("make");selected.delete("model");selected.delete("trim");}
      if(field==="make"){selected.delete("model");selected.delete("trim");}
      if(field==="model")selected.delete("trim");
    } else if(target.id==="sortInventory")sort=value;
    else if(target.dataset.budget || target.dataset.budgetSlider) {
      const bound = target.dataset.budget || target.dataset.budgetSlider;
      const numeric = value==="" ? null : Math.max(0,Math.round(Number(value)));
      if(bound==="min"){minimum=numeric;if(minimum!==null && maximum!==null && maximum<minimum)maximum=minimum;}
      else {maximum=numeric;if(minimum!==null && maximum!==null && minimum>maximum)minimum=maximum;}
    } else return;
    change();
    if (field) section.querySelector('[data-facet="'+field+'"]')?.focus({preventScroll:true});
  });
  section.addEventListener("click",event=>{if(event.target.closest("[data-retry-catalog]"))VehicleCatalog.retry();});
  const mobile=window.matchMedia("(max-width: 760px)");
  get("filterpanel").open=!mobile.matches;
  mobile.addEventListener("change",e=>get("filterpanel").open=!e.matches);
  window.Facets={prepare,matches,order,sync,reset,isNarrowed,amount,get paymentMode(){return enabled("price") && enabled(mode) ? mode : "cash"},get layout(){return layout},get sorted(){return sort!=="recommended"}};
})();

