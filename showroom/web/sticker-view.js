(() => {
  const format = new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",maximumFractionDigits:2});
  function make(tag, value) {
    const element = document.createElement(tag);
    if(value != null) element.textContent = value;
    return element;
  }
  function manufacturerUrl(vin,provider="stellantis") {
    if (window.StickerSources) return StickerSources.url(provider,vin);
    return "https://www.chrysler.com/hostd/windowsticker/getWindowStickerPdf.do?vin="+encodeURIComponent(vin);
  }
  function pdfStore(vin,blob) {
    return new Promise((resolve,reject)=>{
      const open=indexedDB.open("showroom-sticker-files",1);
      open.onupgradeneeded=()=>open.result.createObjectStore("pdf");
      open.onerror=()=>reject(open.error);
      open.onsuccess=()=>{
        const db=open.result,tx=db.transaction("pdf",blob?"readwrite":"readonly"),store=tx.objectStore("pdf");
        const request=blob?store.put(blob,vin):store.get(vin);
        tx.oncomplete=()=>{db.close();resolve(request.result);};
        tx.onabort=()=>{db.close();reject(tx.error);};
      };
    });
  }
  function render(host, sticker) {
    host.replaceChildren();
    if (!sticker || !/^[A-HJ-NPR-Z0-9]{17}$/.test(sticker.vin)) return;
    host.append(make("h3","Factory window sticker"));
    if (Number.isFinite(sticker.msrp)) host.append(make("p","Original factory MSRP · "+format.format(sticker.msrp)));
    for (const [key,title] of [["packages","Factory packages"],["options","Factory options"]]) {
      const items=sticker[key];
      if (!items?.length) continue;
      host.append(make("h4", title));
      const list=make("ul");
      for (const item of items) {
        list.append(make("li", item.name+(Number.isFinite(item.price)?" · "+format.format(item.price):"")));
      }
      host.append(list);
    }
    if (sticker.equipment?.length) {
      const details=make("details"), list=make("ul");
      details.append(make("summary","Additional equipment on the sticker"));
      for (const item of sticker.equipment) list.append(make("li",item));
      details.append(list);host.append(details);
    }
    const link=make("a","Open original window sticker (PDF) ↗");
    link.href=sticker.vin==="1GCPACED3SZ124996" && sticker.provider==="gm" ? "assets/stickers/1GCPACED3SZ124996.pdf" : manufacturerUrl(sticker.vin,sticker.provider);
    if(sticker.localPdf) {
      pdfStore(sticker.vin).then(blob=>{
        if(!blob || !link.isConnected)return;
        link.addEventListener("click",event=>{
          event.preventDefault();
          const url=URL.createObjectURL(blob);
          window.open(url,"_blank","noopener,noreferrer");
          setTimeout(()=>URL.revokeObjectURL(url),60000);
        });
      }).catch(()=>{});
    }
    link.target="_blank";link.rel="noopener noreferrer";host.append(link);
  }
  window.FactorySticker={render, manufacturerUrl,savePdf:pdfStore};
})();
