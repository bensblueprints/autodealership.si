(() => {
  "use strict";
  const amountPattern = /^\$?\s*\d[\d,]*\.\d{2}$/;
  const toAmount = value => Number(value.replace(/[$,\s]/g,""));
  function read(pages, expectedVin) {
    const vin = String(expectedVin).trim().toUpperCase();
    const vins = new Set();
    for(const page of pages) for(const item of page) {
      for(const id of item.text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) || []) {
        if (/\d/.test(id)) vins.add(id);
      }
    }
    if(vins.size!==1 || !vins.has(vin)) throw Error("Ford sticker VIN mismatch.");
    const totals=new Set(), result={msrp:null,options:[],packages:[],equipment:[]};
    for(const page of pages) {
      for(const label of page.filter(item=>/^TOTAL MSRP\s*:?$/i.test(item.text))) {
        const row=page.filter(item=>item.x>label.x && item.x<label.x+215 && Math.abs(label.y-item.y)<3 && /^\$/.test(item.text) && amountPattern.test(item.text));
        if(row.length===1) totals.add(toAmount(row[0].text));
      }
      appendEquipment(page,result);
    }
    if(totals.size!==1 || [...totals][0]<=0) throw Error("Ford sticker total MSRP could not be verified.");
    result.msrp=[...totals][0];
    return result;
  }
  function appendEquipment(page,result) {
    const head=page.find(item=>/^INCLUDED ON THIS VEHICLE$/i.test(item.text));
    if(!head)return;
    const priceHeading=page.filter(item=>/^\(MSRP\)$/i.test(item.text) && Math.abs(item.y-head.y)<4 && item.x>head.x).sort((a,b)=>a.x-b.x)[0];
    const lower=page.find(item=>/^SOLD TO$/i.test(item.text) && Math.abs(item.x-head.x)<12 && item.y<head.y);
    if(!priceHeading || !lower)return;
    const right=priceHeading.x+priceHeading.width+5;
    const rows=[];
    for(const token of page.filter(item=>item.x>=head.x-2 && item.x<right && item.y<head.y-4 && item.y>lower.y+4)) {
      let row=rows.find(r=>Math.abs(r.y-token.y)<2);
      if(!row){row={y:token.y,parts:[]};rows.push(row);}
      row.parts.push(token);
    }
    for(const row of rows.sort((a,b)=>b.y-a.y)) {
      const parts=row.parts.sort((a,b)=>a.x-b.x);
      const text=parts.map(p=>p.text).join(" ");
      if(/^(?:DEALER INSTALLED|DEALER ADDED)/i.test(text))break;
      if(/^(?:OPTIONAL EQUIPMENT|\d{4} MODEL YEAR|\*|RESIDENCY RESTRICTIONS)/i.test(text))continue;
      const prices=parts.filter(p=>p.x>head.x+105 && (amountPattern.test(p.text) || /^NO CHARGE$/i.test(p.text)));
      const name=parts.filter(p=>!prices.includes(p)).map(p=>p.text).join(" ").replace(/^[.\s\u2022\u009f]+/,"").trim();
      if(!name || !/[A-Z]/i.test(name) || /DISCOUNT|SAVINGS/i.test(name))continue;
      const price=prices.length===1 ? (/^NO CHARGE$/i.test(prices[0].text)?0:toAmount(prices[0].text)) : null;
      if(/\b(?:PACKAGE|EQUIPMENT GROUP)\b/i.test(name)) result.packages.push({name,price});
      else if(price!==null) result.options.push({name,price});
      else if(!result.equipment.includes(name))result.equipment.push(name);
    }
  }
  window.FordSticker={read};
})();
