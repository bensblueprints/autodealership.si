const InventoryWorklist=(()=>{
  const labels={photo:"Needs vehicle photo",price:"Missing cash price",miles:"Missing mileage",stock:"Missing stock number",duplicate:"Duplicate stock number"};
  const target={photo:"photo",price:"price",miles:"miles",stock:"stock",duplicate:"stock"};
  function today(zone,instant=new Date()){
    return new Intl.DateTimeFormat("sv-SE",{timeZone:zone||"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(instant);
  }
  function age(date,day){
    if(!/^\d{4}-\d\d-\d\d$/.test(date||""))return null;
    const days=(Date.parse(day)-Date.parse(date))/86400000;
    return Number.isInteger(days) && days>=0?days:null;
  }
  function records(cars,status,day){
    const stockKey=c=>String(c.stock||"").trim().toLowerCase(),counts=new Map();
    for(const car of cars){
      const key=stockKey(car);
      if(key && status(car.vin||car.id)!=="sold")counts.set(key,(counts.get(key)||0)+1);
    }
    return cars.map(car=>{
      const issues=[],key=stockKey(car),sold=status(car.vin||car.id)==="sold";
      if(!sold){
        if(typeof car.image!=="string" || !car.image.trim() || car.imageType==="stock")issues.push("photo");
        if(!(Number.isFinite(Number(car.price)) && Number(car.price)>0))issues.push("price");
        if(!/^\d+$/.test(String(car.miles??"").trim()) || !Number.isSafeInteger(Number(car.miles)))issues.push("miles");
        if(!key)issues.push("stock");else if(counts.get(key)>1)issues.push("duplicate");
      }
      return {car,sold,issues,days:age(car.lotDate,day)};
    });
  }
  const queues={current:r=>!r.sold,attention:r=>!r.sold&&r.issues.length>0,aged:r=>!r.sold&&r.days!==null&&r.days>=60,sold:r=>r.sold};
  function select(rows,{queue,issue,date,sort,search}){
    const words=search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matched=rows.filter(r=>{
      if(!queues[queue](r) || (issue && !r.issues.includes(issue)))return false;
      if(date==="unknown" && r.days!==null || date==="recent" && !(r.days!==null&&r.days<30) || date==="middle" && !(r.days>=30&&r.days<60) || date==="aged" && !(r.days>=60))return false;
      const c=r.car,hay=[c.year,c.make,c.model,c.vin,c.stock,c.trim,c.location,c.condition].join(" ").toLowerCase();
      return words.every(w=>hay.includes(w));
    });
    const byStock=(a,b)=>String(a.car.stock||a.car.vin||"").localeCompare(String(b.car.stock||b.car.vin||""),undefined,{numeric:true});
    if(sort==="age")matched.sort((a,b)=>(b.days??-1)-(a.days??-1)||byStock(a,b));
    if(sort==="stock")matched.sort(byStock);
    if(sort==="issues")matched.sort((a,b)=>b.issues.length-a.issues.length||byStock(a,b));
    return matched;
  }
  return {today,records,select,labels,target,queues};
})();
