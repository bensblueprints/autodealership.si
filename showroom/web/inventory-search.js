"use strict";
const InventorySearch = (() => {
  const prefix = "#inventory?";
  const sorts = ["recommended", "priceLow", "priceHigh", "year", "miles"];
  const layouts = ["browse", "grid", "list"];
  function read(hash, fields) {
    if (!hash.startsWith(prefix)) return null;
    const params = new URLSearchParams(hash.slice(prefix.length));
    const value = key => (params.get(key) || "").trim();
    const money = key => {
      const v = value(key);
      return /^\d+(?:\.\d{1,2})?$/.test(v) && Number.isSafeInteger(Math.round(Number(v)*100)) ? Number(v) : null;
    };
    const selected = [];
    for (const key of Object.keys(fields)) {
      const v = value(key);
      if (key === "features" || !v) continue;
      if (key === "miles" && !/^\d+$/.test(v)) continue;
      if (key === "year" && !/^\d{4}$/.test(v)) continue;
      selected.push([key, v]);
    }
    const min = money("min"), max = money("max");
    const page = Number(value("page"));
    return {
      query: value("q"), selected, equipment: [...new Set(params.getAll("feature").map(s=>s.trim()).filter(Boolean))],
      mode: ["cash","finance","lease"].includes(value("mode")) ? value("mode") : "cash",
      minimum: min, maximum: min!==null && max!==null ? Math.max(min,max) : max,
      bhph: value("bhph")==="1", down: money("down"), installment: money("installment"),
      frequency: ["Weekly","Biweekly","Monthly"].includes(value("frequency")) ? value("frequency") : "",
      sort: sorts.includes(value("sort")) ? value("sort") : "recommended",
      layout: layouts.includes(value("view")) ? value("view") : "browse",
      page: Number.isSafeInteger(page) && page>0 ? page : 1
    };
  }
  function write(state) {
    const p = new URLSearchParams();
    if (state.query.trim()) p.set("q",state.query.trim());
    for (const [key,value] of state.selected) p.set(key,value);
    for (const value of state.equipment) p.append("feature",value);
    if (state.mode!=="cash") p.set("mode",state.mode);
    for (const [key,n] of [["min",state.minimum],["max",state.maximum],["down",state.down],["installment",state.installment]]) {
      if (n!=null && n!=="") p.set(key,String(n));
    }
    if (state.bhph) p.set("bhph","1");
    if (state.frequency) p.set("frequency",state.frequency);
    if (state.sort!=="recommended") p.set("sort",state.sort);
    if (state.layout!=="browse") p.set("view",state.layout);
    if (state.page>1) p.set("page",String(state.page));
    return p.size ? prefix+p.toString() : "";
  }
  function drivetrain(car) {
    const value=String(car.drivetrain || (Array.isArray(car.vpicDetails) && car.vpicDetails.find(p=>Array.isArray(p) && /^drive\s*type$/i.test(p[0]))?.[1]) || "").trim();
    const token=value.toLowerCase().replace(/[\s-]+/g," ");
    if (!token || /^(?:unknown|n\/a|not (?:available|applicable|reported)|unspecified)$/.test(token)) return "";
    const groups=[
      [/^(?:awd|all wheel drive)(?:$|\s*\/)/,"AWD"], [/^(?:4wd|4x4|4 wheel drive|four wheel drive)(?:$|\s*\/)/,"4WD"],
      [/^(?:fwd|front wheel drive)(?:$|\s*\/)/,"FWD"], [/^(?:rwd|rear wheel drive)(?:$|\s*\/)/,"RWD"],
      [/^(?:4x2|2wd|two wheel drive)(?:$|\s*\/)/,"2WD"]
    ];
    return groups.find(([pattern])=>pattern.test(token))?.[1] || value;
  }
  return {read,write,drivetrain};
})();
if (typeof module!=="undefined" && module.exports) module.exports=InventorySearch;
