(() => {
  "use strict";
  const scriptUrl = document.currentScript.src;
  const moneyPattern = /\$\s*(\d[\d,]*(?:\.\d{2})?)/g;
  const totalLabel = /^total\s+(?:price|msrp)\b/i;
  const endOptions = /^(?:destination (?:charge|fee)|total (?:price|msrp)|warranty coverage|government .*ratings)\b/i;
  const priceIn = text => {
    const matches = [...text.matchAll(moneyPattern)];
    return matches.length === 1 ? Number(matches[0][1].replaceAll(",", "")) : null;
  };

  async function extractPage(page) {
    const {items} = await page.getTextContent();
    return items.filter(item => item.str?.trim()).map(item => ({
      text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width
    }));
  }

  function stickerVinMatches(pages, vin) {
    const found = new Set();
    for (const items of pages) {
      for (const [i,item] of items.entries()) {
        if (!/\bVIN\s*:/i.test(item.text)) continue;
        const text = [item,...items.slice(i+1,i+4).filter(next=>Math.abs(item.y-next.y)<1.5)].map(part=>part.text).join(" ");
        const value = text.split(/\bVIN\s*:/i)[1].toUpperCase().replace(/[\s\-\u2010-\u2015]/g,"").slice(0,17);
        if (/^[A-HJ-NPR-Z0-9]{17}$/.test(value)) found.add(value);
      }
    }
    return found.size === 1 && found.has(vin);
  }

  function getMsrp(pages) {
    const amounts = new Set();
    for (const items of pages) {
      for (const label of items.filter(item=>totalLabel.test(item.text))) {
        let value = priceIn(label.text);
        if (value === null) {
          const next = items.filter(item=>item.x >= label.x + label.width - 2 &&
            item.x < label.x + label.width + 140 && Math.abs(label.y-item.y)<1.5)
            .sort((a,b)=>a.x-b.x)[0];
          if(next && /^\$\s*\d/.test(next.text)) value = priceIn(next.text);
        }
        if (value > 0) amounts.add(value);
      }
    }
    if (amounts.size !== 1) throw Error("The sticker’s total MSRP could not be verified.");
    return [...amounts][0];
  }

  function collectOptions(items, result) {
    const start = items.findIndex(item=>/^optional equipment\b/i.test(item.text));
    if (start<0) return;
    const header = items[start];
    const end = items.findIndex((item,i)=>i>start && endOptions.test(item.text) && item.x>=header.x-8);
    if (end<0) return;
    const rows = [];
    for (const item of items.slice(start+1,end)) {
      if (item.y>=header.y-1 || item.x<header.x-2 || item.x>header.x+275) continue;
      let row = rows.find(row=>Math.abs(row.y-item.y)<1.25);
      if(!row) { row={y:item.y,parts:[]}; rows.push(row); }
      row.parts.push(item);
    }
    for (const row of rows.sort((a,b)=>b.y-a.y)) {
      const text = row.parts.sort((a,b)=>a.x-b.x).map(item=>item.text).join(" ");
      const price = priceIn(text);
      const name = text.replace(moneyPattern,"").replace(/\s+/g," ").trim();
      if (!name) continue;
      if (/\b(package|group)\b/i.test(name)) result.packages.push({name,price});
      else if(price!==null) result.options.push({name,price});
      else if(!result.equipment.includes(name)) result.equipment.push(name);
    }
  }

  async function read(buffer, vin, provider="stellantis") {
    vin=String(vin).trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) throw Error("A complete VIN is required.");
    if (!buffer?.byteLength || buffer.byteLength>12*1024*1024) throw Error("The sticker PDF size is unsupported.");
    const library = await import(new URL("vendor/pdf.min.mjs",scriptUrl).href);
    library.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.mjs",scriptUrl).href;
    const task=library.getDocument({data:new Uint8Array(buffer).slice(),isEvalSupported:false,useSystemFonts:false});
    try {
      const doc = await task.promise;
      if(doc.numPages>10) throw Error("The sticker PDF layout is unsupported.");
      const pages=[];
      for(let i=1;i<=doc.numPages;i++) pages.push(await extractPage(await doc.getPage(i)));
      if (provider==="ford") return window.FordSticker.read(pages,vin);
      if (provider==="gm") return window.GmSticker.read(pages,vin);
      if (!stickerVinMatches(pages,vin)) throw Error("The VIN printed on the sticker could not be matched.");
      const result={msrp:getMsrp(pages),options:[],packages:[],equipment:[]};
      const listingFields={};
      for(const items of pages){
        collectOptions(items,result);
        const start=items.findIndex(item=>/^base price:/i.test(item.text));
        const end=items.findIndex(item=>/^standard equipment/i.test(item.text));
        if(start<0 || end<=start)continue;
        const header=items.slice(start+1,end);
        for(const [index,item] of header.entries()){
          const match=/^(Exterior Color|Interior Color|Interior|Engine|Transmission):\s*(.*)$/i.exec(item.text);
          if(!match)continue;
          const key={"exterior color":"color","interior color":"interiorColor",interior:"interiorMaterial",engine:"engine",transmission:"transmission"}[match[1].toLowerCase()];
          const next=header[index+1];
          const value=match[2].trim() || (next && next.x>item.x && Math.abs(next.y-item.y)<1.5?next.text:"");
          if(value)listingFields[key]=value;
        }
      }
      result.listingFields={color:listingFields.color,interior:[listingFields.interiorColor,listingFields.interiorMaterial].filter(Boolean).join(" · "),engine:listingFields.engine,transmission:listingFields.transmission};
      return result;
    } finally { await task.destroy(); }
  }
  window.StickerReader={read};
})();
