const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const MAX_PDF = 8 * 1024 * 1024;
const pdfHeaders = {"Content-Type":"application/pdf","X-Content-Type-Options":"nosniff","Cache-Control":"private, max-age=3600"};

function assetResponse(path, method) {
  const item = Object.hasOwn(files, path) && files[path];
  if (!item) return new Response("File unavailable",{status:404});
  const [type, bytes, gzip] = item;
  const headers = {"Content-Type":type,"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-cache"};
  if (method === "HEAD") return new Response(null,{headers});
  const data = Uint8Array.from(atob(bytes), c=>c.charCodeAt(0));
  const body = gzip ? new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip")) : data;
  return new Response(body,{headers});
}
async function sticker(vin,provider) {
  if (!VIN.test(vin)) return new Response("A valid VIN is required",{status:400});
  const target = StickerSources.url(provider,vin);
  if (!target) return new Response("Unsupported manufacturer",{status:400});
  const backup = "/assets/stickers/"+vin+".pdf";
  if (Object.hasOwn(files,backup)) return assetResponse(backup,"GET");

  const signal = AbortSignal.timeout(10000);
  try {
    const upstream = await fetch(target,{headers:{Accept:"application/pdf"},signal,redirect:"error"});
    if (!upstream.ok) return new Response("Sticker unavailable",{status:upstream.status===404?404:502});
    if (!upstream.body || Number(upstream.headers.get("Content-Length"))>MAX_PDF) return new Response("Unsupported response",{status:502});
    const reader=upstream.body.getReader(),chunks=[];
    let length=0;
    while(true) {
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>MAX_PDF){await reader.cancel();return new Response("Document too large",{status:502});}
      chunks.push(value);
    }
    const pdf=new Blob(chunks);
    if (!(await pdf.slice(0,5).text()).startsWith("%PDF-"))return new Response("Sticker unavailable",{status:404});
    return new Response(pdf,{headers:pdfHeaders});
  } catch { return new Response("Factory service unavailable",{status:503}); }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(["/api/test-drives","/api/test-drives/desk","/api/test-drives/notes"].includes(url.pathname))return appointmentApi(request,env);
    if(url.pathname==="/api/dealer-profile")return dealershipProfile(request,env);
    if(!["GET","HEAD"].includes(request.method))return new Response("Method unavailable",{status:405});
    if(url.pathname==="/api/window-sticker")return sticker((url.searchParams.get("vin")||"").toUpperCase(),url.searchParams.get("provider")||"stellantis");
    const path=url.pathname==="/" ? "/index.html" : url.pathname==="/dealer" ? "/dealer.html" : url.pathname;
    return assetResponse(path,request.method);
  }
};
