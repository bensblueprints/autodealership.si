(()=>{
  const money=n=>(n/100).toLocaleString("en-US",{style:"currency",currency:"USD",minimumFractionDigits:n%100?2:0});
  const frequencies=["Weekly","Biweekly","Monthly"],terms=[12,18,24,36];
  const summary=(o,s)=>`BHPH price ${money(o.price)}, cash down ${money(o.down)}, remaining ${money(o.balance)}. ${s.months} months, ${s.frequency.toLowerCase()}: ${s.count-1} payments of ${money(s.payment)}, then ${money(s.final)}.`;
  function show(car){
    const offer=car.bhph,section=document.createElement("section");section.className="bhph-offer";
    section.innerHTML='<h2>Buy Here Pay Here</h2><p></p><label>Payment schedule <select><option value="">Choose a schedule</option></select></label><p role="status"></p>';
    section.querySelector("p").textContent=`Cash price ${money(offer.cash)} · BHPH price ${money(offer.price)} · Cash down ${money(offer.down)} · Remaining ${money(offer.balance)}`;
    const select=section.querySelector("select");
    offer.schedules.forEach((s,i)=>select.add(new Option(s.months+" months · "+s.frequency+" · "+money(s.payment),i)));
    select.onchange=()=>{
      const s=select.value===""?null:offer.schedules[Number(select.value)];
      window.bhphChoice=s?{revision:offer.revision,frequency:s.frequency,months:s.months}:null;
      section.lastChild.textContent=s?summary(offer,s):"";
    };
    document.getElementById("vehicle-actions").before(section);
  }
  async function edit(car){
    const modal=document.createElement("dialog");modal.className="bhph-editor";
    modal.innerHTML='<button type="button" class="close" aria-label="Close">×</button><h2>Buy Here Pay Here</h2><p class="identity"></p><p role="status">Loading pricing…</p>';
    modal.querySelector(".identity").textContent=[car.year,car.make,car.model,"· Stock",car.stock||car.id].join(" ");
    document.body.append(modal);modal.querySelector("button").onclick=()=>modal.close();modal.onclose=()=>modal.remove();modal.showModal();
    const status=modal.querySelector("[role=status]"),url="/api/bhph?vehicle="+encodeURIComponent(car.vin||car.id);
    try{
      const response=await fetch(url),data=await response.json();if(!response.ok)throw Error(data.error);
      const o=data.offer,f=document.createElement("form");
      f.innerHTML='<label><input type="checkbox" name="enabled"> Enable BHPH for this vehicle</label><div class="bhph-prices"></div><fieldset><legend>Published payment options</legend><table><thead><tr><th>Term</th><th>Weekly</th><th>Biweekly</th><th>Monthly</th></tr></thead><tbody></tbody></table></fieldset><p class="preview" aria-live="polite"></p><button class="primary">Save vehicle pricing</button>';
      modal.insertBefore(f,status);status.textContent="";f.elements.enabled.checked=o?o.enabled:true;
      const prices=f.querySelector(".bhph-prices");
      for(const [key,label,val] of [["cash","Cash price",o?o.cash/100:car.price],["price","Buy Here Pay Here price",o?o.price/100:null],["down","Cash down",o?o.down/100:null],["override","Remaining balance override (optional)",o?.override==null?null:o.override/100]]){
        const l=document.createElement("label"),input=document.createElement("input");l.textContent=label;input.type="number";input.step=".01";input.min="0";input.required=key!=="override";input.name=key;input.value=val??"";l.append(input);prices.append(l);
      }
      const choices=[];
      for(const months of terms){
        const row=f.querySelector("tbody").insertRow();row.insertCell().textContent=months+" mo";
        for(const frequency of frequencies){
          const box=document.createElement("input");box.type="checkbox";box.setAttribute("aria-label",months+" months "+frequency);
          box.checked=o?o.schedules.some(s=>s.months===months&&s.frequency===frequency):months===24;
          row.insertCell().append(box);choices.push({box,months,frequency});
        }
      }
      const cents=k=>f.elements[k].value===""?null:Math.round(Number(f.elements[k].value)*100);
      const payload=()=>({revision:data.revision,enabled:f.elements.enabled.checked,cash:cents("cash"),price:cents("price"),down:cents("down"),override:cents("override"),choices:choices.filter(c=>c.box.checked).map(({months,frequency})=>({months,frequency}))});
      function preview(){
        const d=payload(),calculated=d.price-d.down,balance=d.override??calculated,result=f.querySelector(".preview");
        result.replaceChildren();
        if(d.price===null||d.down===null)return;
        result.append("Calculated remaining balance: "+money(calculated)+(d.override!==null?" · Dealer override: "+money(balance):""));
        if(balance<=0)return;
        for(const s of d.choices){
          const count=s.months*({Weekly:52,Biweekly:26,Monthly:12}[s.frequency])/12;
          let pay=Math.round(balance/count);if(pay*(count-1)>balance)pay=Math.floor(balance/count);
          const line=document.createElement("small");line.textContent=`${s.months} mo · ${s.frequency} · ${count-1} × ${money(pay)} + final ${money(balance-pay*(count-1))}`;result.append(line);
        }
      }
      f.oninput=preview;preview();
      f.onsubmit=async e=>{
        e.preventDefault();const btn=f.querySelector(".primary");btn.disabled=true;
        try{const res=await fetch(url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload())});const result=await res.json();if(!res.ok)throw Error(result.error);await Store.refreshInventoryStatus();modal.close();}
        catch(err){status.textContent=err.message;}finally{btn.disabled=false;}
      };
    }catch(e){status.textContent=e.message;}
  }
  window.BHPH={edit,show,money,summary};
})();
