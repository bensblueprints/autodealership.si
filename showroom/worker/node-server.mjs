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
        if(count>1000000){res.writeHead(413).end();return;}chunks.push(chunk);
      }
      body=Buffer.concat(chunks);
    }
    const route=new URL(req.url,base);
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
    const response=await worker.default.fetch(new Request(new URL(req.url,base),{method:req.method,headers,body}),{BUCKET:bucket,privateAdmin});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(req.method==="HEAD"||!response.body)res.end();
    else Readable.fromWeb(response.body).on("error",()=>res.destroy()).pipe(res);
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
}).listen(Number(process.env.PORT||8184),process.env.BIND_ADDRESS||"127.0.0.1");
