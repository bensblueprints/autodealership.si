(() => {
  "use strict";
  const requests = new Map();
  const key = value => String(value ?? "").trim().toLowerCase();
  function lookup(url, select) {
    if (requests.has(url)) return requests.get(url);
    const state = {values: [], loading: true, failed: false};
    requests.set(url,state);
    fetch(url,{signal:AbortSignal.timeout(9000)})
      .then(response => {
        if (!response.ok) throw Error("Catalog unavailable");
        return response.json();
      })
      .then(data => {state.values = select(data);})
      .catch(() => {state.failed = true;})
      .finally(() => {state.loading=false;window.renderShowroom?.();window.dispatchEvent(new Event("vehicle-catalog-updated"));});
    return state;
  }
  function choices(field,year,make,cars) {
    const scoped = cars.filter(car => (!year || String(car.year)===year) &&
      (field==="make" || !make || key(car.make)===key(make)));
    const values = new Map();
    const add = value => {if(value && !values.has(key(value))) values.set(key(value),value);};
    scoped.forEach(car=>add(car[field]));
    const local = window.EpaModelYears[year] || {};
    const catalogMake = Object.keys(local).find(value=>key(value)===key(make));
    (field==="make" ? Object.keys(local) : local[catalogMake] || []).forEach(add);
    const results=[];
    if (year && (field==="make" || make)) {
      const query = new URLSearchParams({modelYear:year,issueType:"r"});
      if(field==="model") query.set("make",make);
      results.push(lookup("https://api.nhtsa.gov/products/vehicle/"+field+"s?"+query,data=>
        data.results.map(record=>record[field])));
      if(field==="model" && Number(year)>=1981) {
        const url="https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeYear/make/"+encodeURIComponent(make)+"/modelyear/"+year+"?format=json";
        results.push(lookup(url,data=>data.Results.filter(record=>key(record.Make_Name)===key(make)).map(record=>record.Model_Name)));
      }
    }
    results.forEach(result=>result.values.forEach(add));
    return {values:[...values.values()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),loading:results.some(r=>r.loading),failed:results.some(r=>r.failed)};
  }
  window.VehicleCatalog={choices,key,retry(){for(const [url,state] of requests)if(state.failed)requests.delete(url);window.renderShowroom?.();window.dispatchEvent(new Event("vehicle-catalog-updated"));}};
})();
