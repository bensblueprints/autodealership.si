import {DatabaseSync} from "node:sqlite";
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
const db=new DatabaseSync(join(dataDir,"appointments.sqlite"));
db.exec("CREATE TABLE IF NOT EXISTS bookings(key TEXT PRIMARY KEY, body TEXT NOT NULL)");
const bucket={
  async list({prefix}){return {objects:db.prepare("SELECT key FROM bookings WHERE key LIKE ?").all(prefix+"%"),truncated:false};},
  async get(key){if(key.startsWith("appointments/") || key.startsWith("drive-notes/")){const row=db.prepare("SELECT body FROM bookings WHERE key=?").get(key);return row?{json:async()=>JSON.parse(row.body)}:null;}const value=stored();return value?{etag:value.etag,json:async()=>value.settings}:null;},
  async put(key,body,options){
    if(key.startsWith("drive-notes/")){
      db.prepare("INSERT INTO bookings(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body").run(key,body);
      return {};
    }
    if(key.startsWith("appointments/"))return db.prepare("INSERT OR IGNORE INTO bookings(key,body) VALUES(?,?)").run(key,body).changes?{}:null;
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
    const privateAdmin=["localhost","127.0.0.1","[::1]"].includes(base.hostname) && !req.headers.forwarded && !req.headers["x-forwarded-for"];
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
    const response=await worker.default.fetch(new Request(new URL(req.url,base),{method:req.method,headers,body}),{BUCKET:bucket,privateAdmin});
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(req.method==="HEAD"||!response.body)res.end();
    else Readable.fromWeb(response.body).on("error",()=>res.destroy()).pipe(res);
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
}).listen(Number(process.env.PORT||8184),process.env.BIND_ADDRESS||"127.0.0.1");
