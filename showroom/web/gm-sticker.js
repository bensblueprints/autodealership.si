(() => {
  "use strict";
  const vinPattern = /^[A-HJ-NPR-Z0-9]{17}$/;
  const pricePattern = /^(-?)\$?\s*(\d[\d,]*\.\d{2})(-?)$/;
  const totalLabel = /^TOTAL VEHICLE PRICE\s*\*?$/i;
  const bullet = /^[•●*]\s*/;

  function printedVins(items) {
    const vins = new Set();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const printed = item.text.match(/^VIN\s*[:#]?\s*([A-HJ-NPR-Z0-9]{17})\b/i);
      const embedded = item.text.match(/"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/i);
      if (printed) vins.add(printed[1].toUpperCase());
      if (embedded) vins.add(embedded[1].toUpperCase());
      if (/^VIN\s*:?$/i.test(item.text)) {
        const next = items[i + 1];
        if (next && Math.abs(next.y - item.y) < 2 && vinPattern.test(next.text)) vins.add(next.text);
      }
    }
    return vins;
  }

  function price(text) {
    if (/^(INC\.?|INCLUDED|NO (?:CHARGE|COST))$/i.test(text)) return 0;
    const match = text.match(pricePattern);
    return match ? (match[1] || match[3] ? -1 : 1) * Number(match[2].replaceAll(",", "")) : null;
  }

  function listedAmount(items, i) {
    const next = items[i + 1], label = items[i];
    if (!next || next.x <= label.x || Math.abs(next.y - label.y) > 2) return null;
    return price(next.text);
  }

  function standardEquipment(items) {
    const details = [];
    let started = false, current = "", base = 0;
    function flush() { if (current) details.push(current); current = ""; }
    for (const item of items) {
      if (/^(SAFETY & SECURITY|PERFORMANCE & MECHANICAL|CONNECTIVITY & TECHNOLOGY|INTERIOR|EXTERIOR)$/i.test(item.text)) {
        started = true; flush(); continue;
      }
      if (!started) continue;
      if (/MANUFACTURER.S SUGGESTED RETAIL PRICE|STANDARD VEHICLE PRICE/i.test(item.text)) break;
      if (bullet.test(item.text)) { flush(); current = item.text.replace(bullet, ""); base = item.x; }
      else if (current && item.x > base + 1) current += " " + item.text;
      else flush();
    }
    flush();
    return details;
  }

  function collectOptions(items, result) {
    const start = items.findIndex(item => /^OPTIONS\s*&\s*PRICING$/i.test(item.text));
    if (start < 0) return;
    result.equipment.push(...standardEquipment(items.slice(0,start)));
    const end = items.findIndex((item, i) => i > start && /^(?:TOTAL OPTIONS|TOTAL VEHICLE & OPTIONS|DESTINATION CHARGE|TOTAL VEHICLE PRICE\*?)$/i.test(item.text));
    if (end < 0) return;
    for (let i = start + 1; i < end; i++) {
      const amount = listedAmount(items, i);
      if (amount === null) continue;
      let name = items[i].text;
      i++; // consume the price printed alongside this name
      while (i + 1 < end && !bullet.test(items[i + 1].text) && listedAmount(items, i + 1) === null &&
             price(items[i + 1].text) === null && !/^(?:CREDIT|DISCOUNT|TOTAL)\b/.test(items[i + 1].text)) {
        name += " " + items[++i].text;
      }
      const group = /\b(?:PACKAGE|GROUP|EDITION)\b/i.test(name) ? "packages" : "options";
      result[group].push({name, price:amount});
    }
  }

  function read(pages, vin) {
    const items = pages.flat(), vins = printedVins(items);
    if (!vinPattern.test(vin) || vins.size !== 1 || !vins.has(vin)) throw Error("The GM sticker VIN could not be matched.");
    const totals = new Set();
    for (const page of pages) {
      page.forEach((item,i) => {
        if (!totalLabel.test(item.text)) return;
        const amount = listedAmount(page, i);
        if (amount > 0) totals.add(amount);
      });
    }
    if (totals.size !== 1) throw Error("The GM sticker total MSRP could not be verified.");
    const result = {msrp:[...totals][0], options:[], packages:[], equipment:[]};
    pages.forEach(page => collectOptions(page,result));
    return result;
  }
  window.GmSticker = {read};
})();
