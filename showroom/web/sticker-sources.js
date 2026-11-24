(() => {
  const groups = {stellantis:["CHRYSLER","DODGE","JEEP","RAM","FIAT","ALFA ROMEO"],ford:["FORD","LINCOLN"],gm:["CHEVROLET","GMC","BUICK","CADILLAC"]};
  const urls = {
    stellantis:"https://www.chrysler.com/hostd/windowsticker/getWindowStickerPdf.do?vin=",
    ford:"https://www.windowsticker.forddirect.com/windowsticker.pdf?vin=",
    gm:"https://cws.gm.com/vs-cws/vehshop/v2/vehicle/windowsticker?vin="
  };
  globalThis.StickerSources = {
    forMake(make){return Object.keys(groups).find(key=>groups[key].includes(String(make).trim().toUpperCase()));},
    url(provider,vin){return Object.hasOwn(urls,provider) && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? urls[provider]+vin : null;}
  };
})();
