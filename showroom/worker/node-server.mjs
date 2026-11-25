import {bookingDatabase} from "./booking-database.mjs";
import {timingSafeEqual} from "node:crypto";
import {createServer} from "node:http";
import {Readable} from "node:stream";
import {readFileSync,writeFileSync,renameSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
const worker=await import(process.env.SHOWROOM_MODULE || "../dist/server/index.js");
const dataDir=process.env.SHOWROOM_DATA || "./showroom-data";
mkdirSync(dataDir,{recursive:true});
const path=join(dataDir,"profile.json");
function stored(){
  try{return JSON.parse(readFileSync(path,"utf8"));}catch(e){if(e.code==="ENOENT")return null;throw e;}
}
const db=await bookingDatabase();
await db.query("CREATE TABLE IF NOT EXISTS homepage_banners (id integer PRIMARY KEY, revision integer NOT NULL, config jsonb NOT NULL)");
await db.query("CREATE TABLE IF NOT EXISTS bhph_offers(vehicle text PRIMARY KEY, revision integer NOT NULL, offer jsonb NOT NULL)");
function publishedOffer(row){
  if(!row.offer.enabled)return {cash:row.offer.cash,revision:row.revision};
  return {...row.offer,revision:row.revision};
}
async function offerSnapshot(vin,choice){
  const row=(await db.query("SELECT revision,offer FROM bhph_offers WHERE vehicle=$1",[vin])).rows[0];
  if(!row?.offer.enabled || row.revision!==choice?.revision)return null;
  const schedule=row.offer.schedules.find(s=>s.frequency===choice.frequency && s.months===choice.months);
  return schedule?{cash:row.offer.cash,price:row.offer.price,down:row.offer.down,balance:row.offer.balance,...schedule}:null;
}
const bucket={
  async list({prefix}){return {objects:(await db.query("SELECT key FROM appointments WHERE starts_with(key,$1)",[prefix])).rows,truncated:false};},
  async get(key){
    if(key.startsWith("appointments/")){
      const row=(await db.query("SELECT body FROM appointments WHERE key=$1",[key])).rows[0];
      return row?{json:async()=>row.body}:null;
    }
    if(key.startsWith("drive-notes/")){
      const [,id,field]=key.split("/");
      const row=(await db.query("SELECT notes->>$2 AS answer FROM appointments WHERE confirmation=$1",[id,field])).rows[0];
      return row?.answer?{json:async()=>row.answer}:null;
    }
    const value=stored();return value?{etag:value.etag,json:async()=>value.settings}:null;
  },
  async put(key,body,options){
    if(key.startsWith("drive-notes/")){
      const [,id,field]=key.split("/");
      const result=await db.query("UPDATE appointments SET notes=notes || jsonb_build_object($2::text,$3::jsonb) WHERE confirmation=$1",[id,field,body]);
      if(!result.rowCount)throw Error("Missing appointment");
      return {};
    }
    if(key.startsWith("appointments/")){
      const record=JSON.parse(body);
      const result=await db.query("INSERT INTO appointments(key,confirmation,body) SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM inventory_status WHERE vin=$4) ON CONFLICT DO NOTHING",[key,record.confirmation,body,record.vin]);
      return result.rowCount?{}:null;
    }
    const prior=stored(),condition=options.onlyIf;
    if(condition.etagMatches && condition.etagMatches!==prior?.etag)return null;
    if(condition.etagDoesNotMatch==="*" && prior)return null;
    const etag=randomUUID();
    writeFileSync(path+".next",JSON.stringify({etag,settings:JSON.parse(body)}),{mode:0o600});
    renameSync(path+".next",path);
    return {etag};
  }
};
createServer(async(req,res)=>{
  try{
    const base=new URL((req.headers["x-forwarded-proto"]==="https"?"https":"http")+"://"+req.headers.host);
    const supplied=Buffer.from(req.headers.authorization||"");
    const expected=Buffer.from("Basic "+Buffer.from("dealer:"+process.env.DEALER_PASSWORD).toString("base64"));
    const signed=!!process.env.DEALER_PASSWORD && supplied.length===expected.length && timingSafeEqual(supplied,expected);
    const privateAdmin=signed || ["localhost","127.0.0.1","[::1]"].includes(base.hostname) && !req.headers.forwarded && !req.headers["x-forwarded-for"];
    const headers=new Headers();
    for(const [k,v] of Object.entries(req.headers))if(typeof v==="string"&&!k.startsWith("oai-"))headers.set(k,v);
    let body;
    if(["PUT","POST"].includes(req.method)){
      const chunks=[];let count=0;
      for await(const chunk of req){
        count+=chunk.length;
        if(count>(req.url==="/api/banner-editor" && privateAdmin?6500000:1000000)){res.writeHead(413).end();return;}chunks.push(chunk);
      }
      body=Buffer.concat(chunks);
    }
    const route=new URL(req.url,base);
    if(route.pathname==="/api/bhph"){
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      const vehicle=route.searchParams.get("vehicle");
      if(req.method==="GET" && !vehicle){
        const {rows}=await db.query("SELECT vehicle,revision,offer FROM bhph_offers");
        return reply(200,Object.fromEntries(rows.map(row=>[row.vehicle,publishedOffer(row)])));
      }
      if(!privateAdmin)return reply(403,{error:"Use Dealer sign in first."});
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(vehicle||""))return reply(400,{error:"Missing vehicle identifier."});
      if(req.method==="GET"){
        const row=(await db.query("SELECT revision,offer FROM bhph_offers WHERE vehicle=$1",[vehicle])).rows[0];
        return reply(200,row||{revision:0,offer:null});
      }
      if(req.method!=="PUT" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"Use the dealer dashboard."});
      let data;try{data=JSON.parse(body);}catch{}
      const cents=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000000000;
      if(!data || !Number.isInteger(data.revision)||typeof data.enabled!=="boolean"||!cents(data.cash)||!cents(data.price)||!cents(data.down)||data.down>data.price ||
        (data.override!==null && !cents(data.override)) || !Array.isArray(data.choices)||!data.choices.length||data.choices.length>12)
        return reply(400,{error:"Check prices, cash down, remaining balance and payment options."});
      const balance=data.override??(data.price-data.down),schedules=[],seen=new Set();
      for(const choice of data.choices){
        if(!choice || !["Weekly","Biweekly","Monthly"].includes(choice.frequency)||![12,18,24,36].includes(choice.months)||seen.has(choice.frequency+choice.months))
          return reply(400,{error:"Invalid payment option."});
        seen.add(choice.frequency+choice.months);
        const count=choice.months*({Weekly:52,Biweekly:26,Monthly:12}[choice.frequency])/12;
        let payment=Math.round(balance/count);
        if(payment*(count-1)>balance)payment=Math.floor(balance/count);
        if(!payment)return reply(400,{error:"The balance is too small for the selected schedule."});
        schedules.push({...{frequency:choice.frequency,months:choice.months},count,payment,final:balance-payment*(count-1)});
      }
      const offer=JSON.stringify({enabled:data.enabled,cash:data.cash,price:data.price,down:data.down,override:data.override,balance,schedules});
      const result=data.revision===0?await db.query("INSERT INTO bhph_offers VALUES($1,1,$2) ON CONFLICT DO NOTHING RETURNING revision",[vehicle,offer]):
        await db.query("UPDATE bhph_offers SET offer=$2,revision=revision+1 WHERE vehicle=$1 AND revision=$3 RETURNING revision",[vehicle,offer,data.revision]);
      return result.rowCount?reply(200,result.rows[0]):reply(409,{error:"Pricing changed in another session. Reopen the editor."});
    }
    if(["/api/banners","/api/banner-editor"].includes(route.pathname)){
      const editor=route.pathname.endsWith("editor");
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(editor && !privateAdmin)return reply(403,{error:"Use Dealer sign in to manage banners."});
      if(req.method==="GET"){
        const row=(await db.query("SELECT revision,config FROM homepage_banners WHERE id=1")).rows[0];
        const config=row?.config??{enabled:false,slides:[]};
        return reply(200,editor?{...config,revision:row?.revision??0}:{slides:config.enabled?config.slides:[]});
      }
      if(!editor || req.method!=="PUT" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"Dealer access required."});
      let data;try{data=JSON.parse(body);}catch{return reply(400,{error:"Invalid slideshow."});}
      if(!data || typeof data.enabled!=="boolean" || !Number.isInteger(data.revision) || !Array.isArray(data.slides) || data.slides.length>6 || (data.enabled && !data.slides.length))
        return reply(400,{error:"Choose up to six banners. Add a banner before enabling the slideshow."});
      const slides=[];
      for(const slide of data.slides){
        if(!slide || typeof slide.image!=="string" || slide.image.length>1000000 || !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+=*$/.test(slide.image) ||
          typeof slide.alt!=="string" || !slide.alt.trim() || slide.alt.length>300 || typeof slide.link!=="string" || slide.link.length>2048)
          return reply(400,{error:"Each slide needs a banner image and a short description."});
        if(slide.link){
          try{const url=new URL(slide.link,base);if(url.username||url.password||!(url.protocol==="https:" || (url.origin===base.origin && slide.link.startsWith("/"))))throw Error();}
          catch{return reply(400,{error:"Enter a valid HTTPS link or a showroom path."});}
        }
        slides.push({image:slide.image,alt:slide.alt.trim(),link:slide.link});
      }
      const config=JSON.stringify({enabled:data.enabled,slides});
      const saved=data.revision===0?await db.query("INSERT INTO homepage_banners VALUES(1,1,$1) ON CONFLICT DO NOTHING RETURNING revision",[config]):
        await db.query("UPDATE homepage_banners SET config=$1,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING revision",[config,data.revision]);
      return saved.rowCount?reply(200,saved.rows[0]):reply(409,{error:"Another editor saved changes. Reload the dashboard before editing again."});
    }
    if(route.pathname==="/dealer-login"){
      if(!privateAdmin){res.writeHead(401,{"WWW-Authenticate":'Basic realm="Dealer dashboard"',"Cache-Control":"no-store"}).end();return;}
      res.writeHead(302,{Location:"/dealer","Cache-Control":"no-store"}).end();return;
    }
    if(route.pathname==="/api/inventory-status"){
      res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json");
      if(req.method==="GET"){const result=await db.query("SELECT vin,status FROM inventory_status");res.end(JSON.stringify(Object.fromEntries(result.rows.map(r=>[r.vin,r.status]))));return;}
      if(!privateAdmin || req.method!=="PUT" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json")){res.writeHead(403).end();return;}
      let data;try{data=JSON.parse(body);}catch{}
      if(!/^([A-HJ-NPR-Z0-9]{17}|[a-zA-Z0-9_-]{1,100})$/.test(data?.vin||"")||!["sold","deleted","available"].includes(data.status)){res.writeHead(400).end();return;}
      if(data.status==="available")await db.query("DELETE FROM inventory_status WHERE vin=$1 AND status='sold'",[data.vin]);
      else await db.query("INSERT INTO inventory_status VALUES ($1,$2) ON CONFLICT(vin) DO UPDATE SET status=excluded.status WHERE inventory_status.status<>'deleted'",[data.vin,data.status]);
      res.end("{}");return;
    }
    const response=await worker.default.fetch(new Request(new URL(req.url,base),{method:req.method,headers,body}),{BUCKET:bucket,privateAdmin,offerSnapshot});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(req.method==="HEAD"||!response.body)res.end();
    else Readable.fromWeb(response.body).on("error",()=>res.destroy()).pipe(res);
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
}).listen(Number(process.env.PORT||8184),process.env.BIND_ADDRESS||"127.0.0.1");
