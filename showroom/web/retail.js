(() => {
  "use strict";
  const options = () => Store.settings().options || {};
  const enabled = key => options()[key] !== false;
  const html = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const usd = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD",maximumFractionDigits:0});
  const hasNumber = value => value != null && String(value).trim() !== "" && Number.isFinite(Number(value));
  const money = value => hasNumber(value) ? usd.format(value) : "Contact dealer";
  const name = car => [car.year, car.make, car.model].join(" ");
  const vehicle = id => Store.cars().find(car => String(car.id) === String(id));
  const terms = {
    finance:{months:60, rate:7, down:0},
    lease:{months:36, rate:6, down:0, residual:55}
  };
  function amount(car, mode="cash", input=terms[mode]) {
    if ((mode!=="cash" && !Store.aprAllowed(car)) || !hasNumber(car.price)) return null;
    const price = Number(car.price);
    if (!Number.isFinite(price) || price < 0) return null;
    if (mode === "cash") return price;
    if (!input || input.months <= 0 || input.rate < 0 || input.down < 0) return null;
    const capital = Math.max(0,price-input.down);
    if (mode === "finance") {
      const interest = input.rate / 1200;
      return interest === 0 ? capital / input.months : capital * interest / -Math.expm1(-input.months*Math.log1p(interest));
    }
    if (mode !== "lease") return null;
    const residual = Number(car.msrp || price) * input.residual / 100;
    return Math.max(0,(capital-residual)/input.months+(capital+residual)*input.rate/2400);
  }
  function assumptions(mode) {
    if(mode==="cash")return "Listed vehicle price";
    const t=terms[mode];
    if(!t)return "";
    return t.months+" months · "+t.rate+"% "+(mode==="lease"?"equivalent APR · "+t.residual+"% residual":"APR")+" · "+money(t.down)+" down · before taxes and fees";
  }

  const selected = new Set();
  const button = (action, label, extra="") => '<button type="button" data-retail="'+action+'" '+extra+'>'+html(label)+'</button>';
  function card(car) {
    const id=html(car.id);
    const actions=['<a class="drive-link" href="vehicle.html?stock='+encodeURIComponent(car.id)+'&amp;book=1">Schedule a test drive</a>',button("question","Ask about this vehicle")];
    const offer=car.bhph;
    const schedules=offer?.schedules||[];
    const plan=offer?'<div class="bhph-card-terms">'+
      (schedules.length?'<details><summary>Payment schedules</summary>'+schedules.map(s=>'<p>'+html(s.months)+' months · '+html(s.frequency)+' · '+html(s.count-1)+' payments of '+html(BHPH.money(s.payment))+', final '+html(BHPH.money(s.final))+'</p>').join("")+'</details>':'')+'</div>':'';
    if (Store.aprAllowed(car) && amount(car) !== null && enabled("payment") && (enabled("finance") || enabled("lease"))) actions.push(button("payment","Calculate payment"));
    if (enabled("trade")) actions.push(button("trade","Value my trade"));
    if (enabled("availability")) actions.push(button("availability","Confirm availability"));
    const showPricing=enabled("pricing"),showCompare=enabled("compare");
    const link='<a class="open-vehicle" href="vehicle.html?stock='+encodeURIComponent(car.id)+'">View full vehicle details ↗</a>';
    const pricing=showPricing ? '<div class="retail-facts">'+
      (car.msrp!=null && car.msrp!=="" ? '<p>MSRP <b>'+money(car.msrp)+'</b></p>' : '')+
      (car.adminFee!=null && car.adminFee!=="" ? '<p>Admin fee'+(car.adminFeeIncluded ? " (included)" : "")+' <b>'+money(car.adminFee)+'</b></p>' : '')+
      '<p>Asking price <b>'+money(car.price)+'</b></p></div>' : '';
    return '<div class="retail-card" data-retail-car="'+id+'">'+link+(offer?plan:pricing)+'<div class="retail-actions">'+actions.join("")+'</div>'+(showCompare?button("compare",selected.has(String(car.id))?"✓ Selected for comparison":"+ Compare",'aria-pressed="'+selected.has(String(car.id))+'"'):"")+'</div>';
  }
  let dialog,tray;
  function setup() {
    if(dialog)return;
    dialog=document.createElement("dialog");dialog.className="retail-dialog";dialog.setAttribute("aria-labelledby","retail-title");
    document.body.append(dialog);
    tray=document.createElement("div");tray.className="retail-tray";tray.hidden=true;document.body.append(tray);
    dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close();});
  }
  function sync() {
    setup();
    const valid=new Set(Store.cars().map(c=>String(c.id)));
    for(const id of selected)if(!valid.has(id)||!enabled("compare"))selected.delete(id);
    tray.hidden=!selected.size;
    tray.innerHTML='<span>'+selected.size+' of 3 selected</span>'+button("compareList","View comparison")+button("clear","Clear");
  }
  function present(title,content) {
    setup();
    dialog.innerHTML='<header><h2 id="retail-title">'+html(title)+'</h2>'+button("close","×",'aria-label="Close window"')+'</header>'+content;
    if(!dialog.open)dialog.showModal();
    dialog.scrollTop=0;
  }
  function compareList() {
    const cars=[...selected].map(vehicle).filter(Boolean);
    const rows=[["Price",c=>money(c.price)],["Mileage",c=>hasNumber(c.miles) ? Number(c.miles).toLocaleString()+" mi" : "Unlisted"],["Body style",c=>c.body],["Trim",c=>c.trim],["Fuel",c=>c.fuel],["Equipment",c=>(c.features||[]).join(", ")]];
    present("Compare vehicles",'<div class="retail-table"><table><thead><tr><th scope="col">Vehicle</th>'+cars.map(c=>'<th scope="col">'+html(name(c))+'</th>').join("")+'</tr></thead><tbody>'+rows.map(([label,read])=>'<tr><th scope="row">'+label+'</th>'+cars.map(c=>'<td>'+html(read(c)||"Unlisted")+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>');
  }
  function num(label,key,value,max,step="1",min=0) {
    return '<label>'+label+'<input type="number" name="'+key+'" min="'+min+'" max="'+max+'" step="'+step+'" value="'+value+'" required></label>';
  }
  function payment(car,mode=enabled("finance")?"finance":"lease") {
    if (!Store.aprAllowed(car))return;
    if (amount(car) === null) {
      present("Price available from dealer", "<p>Contact the dealership for the asking price before estimating a monthly payment.</p>"+button("close","Done"));
      return;
    }
    const t=terms[mode];
    const modes=["finance","lease"].filter(enabled);
    present("Calculate your payment",'<p class="retail-model">'+html(name(car))+' · '+money(car.price)+'</p><div class="retail-tabs">'+modes.map(m=>button("mode",m==="finance"?"Finance":"Lease",'data-mode="'+m+'" aria-pressed="'+(m===mode)+'"')).join("")+'</div><form class="retail-form"><div class="retail-fields">'+num("Term in months","months",t.months,120,"1",1)+num(mode==="finance"?"APR (%)":"Equivalent APR (%)","rate",t.rate,50,"0.01")+num("Down payment ($)","down",Math.min(t.down,car.price),car.price,"0.01")+(mode==="lease"?num("Residual value (%)","residual",t.residual,100,"0.1"):"")+'</div><div class="retail-estimate"><small>Estimated monthly payment</small><output aria-live="polite"></output></div><p class="retail-note">Illustrative terms. Taxes, registration and fees are excluded.'+(mode==="lease"?' Residual uses '+(car.msrp?'listed MSRP':'asking price as an assumed MSRP')+'. Lease eligibility and actual terms require dealer confirmation.':' Financing is subject to lender approval.')+'</p></form>');
    const form=dialog.querySelector("form");
    function update() {
      const inputs=Object.fromEntries([...new FormData(form)].map(([k,v])=>[k,Number(v)]));
      form.querySelector("output").textContent=form.checkValidity()?money(amount(car,mode,inputs))+"/mo":"Check your entries";
    }
    form.addEventListener("input",update);form.addEventListener("submit",e=>e.preventDefault());update();
    dialog.querySelectorAll('[data-retail="mode"]').forEach(btn=>btn.dataset.car=String(car.id));
  }
  function providerUrl() {
    try {const url=new URL(Store.settings().tradeUrl);return url.protocol==="https:" ? url.href : "";}catch{return "";}
  }
  function inquiry(car,kind) {
    const question=kind==="question",trade=kind==="trade",source=question?"Vehicle inquiry":trade?"Trade-in appraisal":"Availability request",url=trade&&providerUrl();
    present(question?"Ask about this vehicle":trade?"Value your trade":"Confirm availability",'<p class="retail-model">'+html(name(car))+' · Stock '+html(car.stock||car.id)+'</p>'+(url?'<a class="retail-provider" href="'+html(url)+'" target="_blank" rel="noopener noreferrer">Open dealer valuation tool ↗</a>':'')+'<form class="retail-form">'+(question?'<label>Your question<textarea name="question" rows="3" maxlength="2000" required></textarea></label>':'')+(trade?'<label>Your trade vehicle<input name="tradeCar" placeholder="Year, make and model" maxlength="160" required></label>'+num("Trade mileage","tradeMiles","",9999999)+'<label>Condition and equipment<textarea name="condition" maxlength="800" placeholder="Tell the appraiser about your car"></textarea></label>':'')+'<div class="retail-fields"><label>Your name<input name="name" autocomplete="name" maxlength="100" required></label><label>Email<input type="email" name="email" maxlength="200" autocomplete="email" required></label></div><label>Phone (optional)<input type="tel" name="phone" maxlength="40" autocomplete="tel"></label><button class="primary">'+(question?"Send inquiry":trade?"Request dealer appraisal":"Request availability check")+'</button><p class="retail-note" role="status"></p></form>');
    const form=dialog.querySelector("form");
    form.addEventListener("submit",async e=>{
      e.preventDefault();
      const data=Object.fromEntries(new FormData(form)),send=form.querySelector("button");
      if(send.disabled)return;
      if(question&&!data.question.trim()){form.elements.question.focus();return;}
      if(trade&&!data.tradeCar.trim()){form.elements.tradeCar.focus();return;}
      send.disabled=true;
      try {
        await Store.addLead({name:data.name,email:data.email,phone:data.phone,carId:car.id,source,
          message:question?data.question.trim():trade?"Please appraise my "+data.tradeCar.trim()+" ("+Number(data.tradeMiles).toLocaleString()+" mi). "+data.condition.trim():"Please confirm availability of "+name(car)+"."});
        present("Request received",'<p>Your '+(question?"vehicle inquiry":trade?"appraisal request":"availability request")+' for '+html(name(car))+' is in the dealer’s inbox.</p>'+button("close","Done"));
      }catch(err){form.querySelector('[role="status"]').textContent=err.message;send.disabled=false;}
    });
  }
  function refresh(){window.renderShowroom?.();sync();}
  document.addEventListener("click",event=>{
    const btn=event.target.closest?.("[data-retail]");
    if(!btn)return;
    event.stopPropagation();
    const action=btn.dataset.retail,id=btn.closest("[data-retail-car]")?.dataset.retailCar || btn.dataset.car,car=vehicle(id);
    if(action==="close"){dialog.close();return;}
    if(action==="clear"){selected.clear();refresh();return;}
    if(action==="compareList"){if(enabled("compare"))compareList();return;}
    if(!car)return;
    if(action==="compare" && enabled("compare")){
      if(selected.has(id))selected.delete(id);
      else if(selected.size<3)selected.add(id);
      else {present("Compare up to three vehicles","<p>Deselect a vehicle to make room for another.</p>"+button("close","Done"));return;}
      refresh();
    }else if(["payment","mode"].includes(action)&&enabled("payment")&&(enabled("finance")||enabled("lease"))){
      payment(car,btn.dataset.mode);
    }else if(action==="question" || (["trade","availability"].includes(action)&&enabled(action))){inquiry(car,action);}
  },true);
  window.Retail={amount,assumptions,card,sync};
})();
