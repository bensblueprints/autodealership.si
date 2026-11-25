(() => {
  const form=document.getElementById("carForm");
  const {year,make,model}=form.elements;
  const years=document.getElementById("catalog-year");
  const newest=Math.max(new Date().getFullYear()+1,...Object.keys(window.EpaModelYears).map(Number));
  for(let value=newest;value>=1885;value--)years.append(new Option(String(value)));
  function refresh(){
    if(!/^\d{4}$/.test(year.value))return;
    for(const field of [make,model]){
      const choices=field===model && !make.value.trim()?[]:VehicleCatalog.choices(field.name,year.value,make.value.trim(),[]).values;
      const list=document.getElementById("catalog-"+field.name);
      if(choices.join("|")===list.dataset.choices)continue;
      list.replaceChildren(...choices.map(value=>new Option(value,value)));
      list.dataset.choices=choices.join("|");
    }
  }
  for(const field of [make,model])field.addEventListener("focus",refresh);
  year.addEventListener("change",refresh);
  make.addEventListener("change",refresh);
  window.addEventListener("vehicle-catalog-updated",()=>{if(form.closest("dialog").open)refresh()});
})();
