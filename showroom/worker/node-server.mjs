import vm from "node:vm";
import {gzip} from "node:zlib";
import pg from "pg";
import {AsyncLocalStorage} from "node:async_hooks";
import {promisify} from "node:util";
import {scrypt,randomBytes,createHash,createPublicKey,verify} from "node:crypto";
import {bookingDatabase} from "./booking-database.mjs";
import {timingSafeEqual} from "node:crypto";
import {createServer} from "node:http";
import {Readable} from "node:stream";
import {readFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
const worker=await import(process.env.SHOWROOM_MODULE || "../dist/server/index.js");
const dataDir=process.env.SHOWROOM_DATA || "./showroom-data";
mkdirSync(dataDir,{recursive:true});
const path=join(dataDir,"profile.json");
function stored(){
  try{return JSON.parse(readFileSync(path,"utf8"));}catch(e){if(e.code==="ENOENT")return null;throw e;}
}
const pool=await bookingDatabase(),scope=new AsyncLocalStorage();
const dealerPools=new Map();
function dealerPool(name){
  if(!dealerPools.has(name)){
    const pool=new pg.Pool({host:"database",database:name,user:"showroom",password:process.env.POSTGRES_PASSWORD,max:3,idleTimeoutMillis:5000});
    pool.on("error",()=>console.error("Idle dealer database connection closed"));
    pool.on("remove",()=>{if(pool.totalCount===0 && dealerPools.get(name)===pool){dealerPools.delete(name);pool.end().catch(()=>{});}});
    dealerPools.set(name,pool);
  }
  return dealerPools.get(name);
}
await pool.query("ALTER TABLE public.client_sites ADD COLUMN IF NOT EXISTS database_name text UNIQUE");
await worker.createNumberRegistry(pool);
const db={async query(sql,args){
  const tenant=scope.getStore();if(!tenant)return pool.query(sql,args);
  const conn=await pool.connect();
  try{await conn.query("BEGIN");const route=(await conn.query("SELECT database_name FROM public.client_sites WHERE id=$1 FOR SHARE",[tenant.id])).rows[0];
    if(!route || (route.database_name && route.database_name!==tenant.schema))throw Error("Invalid dealership database route");
    let result;
    if(route.database_name)result=await dealerPool(route.database_name).query(sql,args);
    else{await conn.query("SET LOCAL search_path TO "+tenant.schema);result=await conn.query(sql,args);}
    await conn.query("COMMIT");return result;}
  catch(e){await conn.query("ROLLBACK");throw e;}finally{conn.release();}
}};
db.transaction=async function(action){
  const tenant=scope.getStore(), control=await pool.connect();
  let local;
  try{
    await control.query("BEGIN");
    if(tenant){
      const route=(await control.query("SELECT database_name FROM public.client_sites WHERE id=$1 FOR SHARE",[tenant.id])).rows[0];
      if(!route || (route.database_name && route.database_name!==tenant.schema))throw Error("Invalid dealership database route");
      if(route.database_name){
        local=await dealerPool(route.database_name).connect();
        await local.query("BEGIN");
      }else await control.query("SET LOCAL search_path TO "+tenant.schema);
    }
    const result=await action(local||control);
    const finish=result.status>=400?"ROLLBACK":"COMMIT";
    if(local)await local.query(finish);
    await control.query(finish);
    return result;
  }catch(error){
    if(local)await local.query("ROLLBACK");
    await control.query("ROLLBACK");
    throw error;
  }finally{local?.release();control.release();}
};
await db.query("CREATE TABLE IF NOT EXISTS homepage_banners (id integer PRIMARY KEY, revision integer NOT NULL, config jsonb NOT NULL)");
await db.query("CREATE TABLE IF NOT EXISTS bhph_offers(vehicle text PRIMARY KEY, revision integer NOT NULL, offer jsonb NOT NULL)");
await pool.query("CREATE TABLE IF NOT EXISTS public.vehicle_photo_assets(site text NOT NULL, digest text NOT NULL, jpeg bytea NOT NULL, PRIMARY KEY(site,digest))");
await pool.query("CREATE TABLE IF NOT EXISTS client_cars(vin text PRIMARY KEY,body jsonb NOT NULL, position bigserial);CREATE TABLE IF NOT EXISTS client_profile(id integer PRIMARY KEY,settings jsonb NOT NULL,etag text NOT NULL);CREATE TABLE IF NOT EXISTS shopper_leads(id uuid PRIMARY KEY,body jsonb NOT NULL)");
// Shared artwork is private until a dealership chooses a specific revision for its homepage.
await pool.query("CREATE TABLE IF NOT EXISTS public.template_hero_art (id text PRIMARY KEY, layout text NOT NULL, title text NOT NULL, desktop bytea NOT NULL, mobile bytea NOT NULL)");
const seed=await pool.connect();
try{
  await seed.query("BEGIN");
  const first=await seed.query("INSERT INTO showroom_migrations VALUES('persist-demo-catalog-v1') ON CONFLICT DO NOTHING RETURNING name");
  if(first.rowCount){
    const context={window:{}};
    for(const asset of ["cdjr-inventory.js","cdjr-covers.js"]){
      const response=await worker.default.fetch(new Request("http://localhost/assets/"+asset),{});
      if(!response.ok)throw Error("Missing demo inventory asset");
      vm.runInNewContext(await response.text(),context);
    }
    const rows=context.window.CdjrInventory;
    for(const car of rows){
      const cover=context.window.CdjrCovers?.[car.vin];
      if(cover){[car.image,car.imageType]=cover;car.galleryPath="assets/galleries/"+car.vin.slice(-2)+".json";}
    }
    if(!rows.length)throw Error("Demo inventory is empty");
    await seed.query("INSERT INTO client_cars(vin,body) SELECT item->>'vin',item FROM jsonb_array_elements($1) item ON CONFLICT DO NOTHING",[JSON.stringify(rows)]);
    const profile=stored();
    if(profile)await seed.query("INSERT INTO client_profile VALUES(1,$1,$2) ON CONFLICT DO NOTHING",[profile.settings,profile.etag]);
  }
  await seed.query("COMMIT");
}catch(error){await seed.query("ROLLBACK");throw error;}finally{seed.release();}
await pool.query("CREATE TABLE IF NOT EXISTS public.dealer_sales_rosters(site text PRIMARY KEY,organization text NOT NULL,members jsonb NOT NULL,synced_at timestamptz NOT NULL)");
const zipInventory=promisify(gzip);
const passwordHash=promisify(scrypt);
await pool.query(`CREATE TABLE IF NOT EXISTS public.dealer_users(site text NOT NULL,email text NOT NULL,salt text NOT NULL,hash text NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(site,email));
CREATE TABLE IF NOT EXISTS public.dealer_sessions(token text PRIMARY KEY,site text NOT NULL,email text NOT NULL,expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.dealer_login_attempts(site text NOT NULL,ip text NOT NULL,attempts integer NOT NULL,started timestamptz NOT NULL,PRIMARY KEY(site,ip))`);
const showroomOffersQuery=`SELECT b.vehicle,b.revision,b.offer,
  (p.settings->>'financingEnabled'='false' OR c.body->>'financingEnabled'='false') AS cash_only
  FROM bhph_offers b LEFT JOIN client_cars c ON c.vin=b.vehicle LEFT JOIN client_profile p ON p.id=1`;
function publishedOffer(row){
  if(row.cash_only || !row.offer.enabled)return {cash:row.offer.cash,revision:row.revision};
  return {...row.offer,revision:row.revision};
}
async function offerSnapshot(vin,choice){
  if(scope.getStore()?.bhph===false)return null;
  const row=(await db.query(showroomOffersQuery+" WHERE b.vehicle=$1",[vin])).rows[0];
  if(!row?.offer.enabled || row.cash_only || row.revision!==choice?.revision)return null;
  const schedule=row.offer.schedules.find(s=>s.frequency===choice.frequency && s.months===choice.months);
  return schedule?{cash:row.offer.cash,price:row.offer.price,down:row.offer.down,balance:row.offer.balance,...schedule}:null;
}
async function visitByConfirmation(id){
  return (await db.query("SELECT body FROM appointments WHERE confirmation=$1",[id])).rows[0]?.body;
}
async function visitByNote(vin,slot,token){
  if(typeof token!=="string" || token.length!==36)return null;
  return (await db.query("SELECT body FROM appointments WHERE body->>'vin'=$1 AND (body->>'slot'=$2 OR body->>'originalSlot'=$2) AND body->>'noteToken'=$3",[vin,slot,token])).rows[0]?.body;
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
    const row=(await db.query("SELECT settings,etag FROM client_profile WHERE id=1")).rows[0];
    return row?{etag:row.etag,json:async()=>row.settings}:null;
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
      const result=await worker.recordClientVisit(db,key,record);
      return result.rowCount?{}:null;
    }
    const etag=randomUUID();
    const r=options.onlyIf.etagDoesNotMatch==="*" ?
      await db.query("INSERT INTO client_profile VALUES(1,$1,$2) ON CONFLICT DO NOTHING",[body,etag]) :
      await db.query("UPDATE client_profile SET settings=$1,etag=$2 WHERE id=1 AND etag=$3",[body,etag,options.onlyIf.etagMatches]);
    return r.rowCount?{etag}:null;
  }
};
const elApi="https://api.elevenlabs.io/v1/convai/";
async function voiceProvider(path){
  const response=await fetch(elApi+path,{headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY},signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Object.assign(Error("Voice provider unavailable"),{status:response.status});
  return response.json();
}
await pool.query(`CREATE TABLE IF NOT EXISTS public.web_voice_calls(
  conversation text PRIMARY KEY,site uuid NOT NULL,agent text NOT NULL,issued timestamptz NOT NULL DEFAULT now(),
  started timestamptz,duration integer CHECK(duration>=0),state text NOT NULL DEFAULT 'pending',
  next_check timestamptz NOT NULL DEFAULT now()+interval '2 minutes');
  CREATE INDEX IF NOT EXISTS web_voice_due ON public.web_voice_calls(next_check) WHERE state='pending';
  CREATE TABLE IF NOT EXISTS public.web_voice_terms(site uuid NOT NULL,month date NOT NULL,minutes integer NOT NULL,cents integer NOT NULL,PRIMARY KEY(site,month))`);
let syncing=false;
async function reconcileWebVoice(){
  if(syncing)return;
  syncing=true;
  try{
    const {rows}=await pool.query("UPDATE public.web_voice_calls SET next_check=now()+interval '5 minutes' WHERE conversation IN (SELECT conversation FROM public.web_voice_calls WHERE state='pending' AND next_check<=now() ORDER BY next_check LIMIT 30 FOR UPDATE SKIP LOCKED) RETURNING *");
    for(const call of rows){
      try{
        const detail=await voiceProvider("conversations/"+encodeURIComponent(call.conversation));
        if(detail.agent_id!==call.agent || detail.conversation_id!==call.conversation)continue;
        const seconds=detail.metadata?.call_duration_secs,start=detail.metadata?.start_time_unix_secs;
        if(["done","failed"].includes(detail.status) && Number.isInteger(seconds) && seconds>=0 && Number.isInteger(start)){
          await pool.query("UPDATE public.web_voice_calls SET duration=$2,started=to_timestamp($3),state='verified' WHERE conversation=$1",[call.conversation,seconds,start]);
        }
      }catch(e){
        if(e.status===404 && Date.now()-new Date(call.issued).getTime()>86400000)
          await pool.query("UPDATE public.web_voice_calls SET state='unused' WHERE conversation=$1",[call.conversation]);
      }
    }
  }catch(e){console.error("Web voice reconciliation unavailable")}finally{syncing=false}
}
setInterval(reconcileWebVoice,60000).unref();
async function voiceReport(site,month){
 const {rows:[totals]}=await pool.query("SELECT count(*)::int AS calls, coalesce(sum(duration),0)::int AS seconds FROM public.web_voice_calls WHERE site=$1 AND state='verified' AND date_trunc('month',started AT TIME ZONE 'UTC')=$2::date",[site,month]);
 const {rows:[terms]}=await pool.query("SELECT minutes,cents FROM public.web_voice_terms WHERE site=$1 AND month<=$2::date ORDER BY month DESC LIMIT 1",[site,month]);
 return {...totals,terms,overageCents:terms?Math.round(Math.max(0,totals.seconds-terms.minutes*60)*terms.cents/60):null};
}

async function vinIdentities(vins,decode){
  if(!vins.length)return [];
  const source=decode?"SELECT vin,public.vehicle_specs(vin) AS specs FROM unnest($1::text[]) AS v(vin)":"SELECT vin,specs FROM public.vin_spec_cache WHERE vin=ANY($1::text[])";
  const sql="WITH catalog AS MATERIALIZED ("+source+") SELECT vin,specs->>'ModelYear' AS year,specs->>'Make' AS make,specs->>'Model' AS model FROM catalog WHERE specs->>'ErrorCode'='0'";
  try{return (await pool.query(sql,[vins])).rows;}
  catch(error){if(["42883","42P01","3F000"].includes(error.code))return [];throw error;}
}
const clerkIssuer="https://clerk.autodealership.si";
const clerkScript='<script crossorigin="anonymous" src="https://clerk.autodealership.si/npm/@clerk/ui@1/dist/ui.browser.js"></script><script crossorigin="anonymous" data-clerk-publishable-key="pk_live_Y2xlcmsuYXV0b2RlYWxlcnNoaXAuc2kk" src="'+clerkIssuer+'/npm/@clerk/clerk-js@6/dist/clerk.browser.js"></script>';
let clerkKeys;
async function dealerClaim(cookie, origin){
  const token=/(?:^|; *)__session=([^; ]+)/.exec(cookie||"")?.[1];
  if(!token || token.length>12000)return null;
  try{
    const parts=token.split(".");
    if(parts.length!==3)return null;
    const header=JSON.parse(Buffer.from(parts[0],"base64url"));
    if(header.alg!=="RS256")return null;
    if(!clerkKeys || clerkKeys.expires<Date.now()){
      const r=await fetch(clerkIssuer+"/.well-known/jwks.json",{signal:AbortSignal.timeout(4000)});
      if(!r.ok)return null;
      clerkKeys={keys:(await r.json()).keys,expires:Date.now()+300000};
    }
    const jwk=clerkKeys.keys.find(k=>k.kid===header.kid && k.kty==="RSA");
    if(!jwk || !verify("RSA-SHA256",Buffer.from(parts.slice(0,2).join(".")),createPublicKey({key:jwk,format:"jwk"}),Buffer.from(parts[2],"base64url")))return null;
    const c=JSON.parse(Buffer.from(parts[1],"base64url")), now=Date.now()/1000;
    if(c.iss!==clerkIssuer || c.azp!==origin || !c.sub || !c.sid || !Number.isFinite(c.exp) || c.exp<=now || c.nbf>now+5 || c.sts==="pending")return null;
    const role=c.o?.rol ? "org:"+c.o.rol : c.org_role;
    return {subject:c.sub,organization:c.o?.id||c.org_id,role:["org:admin","org:member"].includes(role)?role:null};
  }catch{return null}
}
function platformSignIn(slug){
  return '<p><a style="color:#95c9ff" href="https://autodealership.si/onboarding/clerk-login?site='+encodeURIComponent(slug)+'">Platform admin or engineer sign-in</a></p>';
}
function clerkDealerPage(org,slug){
  return `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dealer sign-in</title><style>body{background:#131721;color:white;font:16px system-ui;margin:8vh auto;padding:24px;max-width:460px}button{padding:10px}</style><a href="https://autodealership.si/" aria-label="AutoDealership.SI home"><img src="https://autodealership.si/brand/logo-dark.webp" alt="AutoDealership.SI" width="186" height="62" style="display:block;width:min(186px,39vw);height:auto"></a><h1>Dealer sign-in</h1><p id="message">Connecting to Clerk�</p>${platformSignIn(slug)}<div id="signin"></div><button hidden id="change">Sign in with another account</button> <button hidden id="retry" onclick="location.reload()">Try again</button><p><a style="color:#95c9ff" href="https://accounts.autodealership.si/sign-in?redirect_url=https%3A%2F%2F${encodeURIComponent(slug)}.autodealership.si%2Fdealer-login">Open secure sign-in in a full page</a></p>${clerkScript}<script>
  (async()=>{await Clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});if(!Clerk.session){message.textContent="Sign in with your invited work email.";Clerk.mountSignIn(signin,{appearance:{options:{logoImageUrl:"https://autodealership.si/brand/logo-white.webp"}},routing:"hash",forceRedirectUrl:location.href,signUpForceRedirectUrl:location.href});return}
  change.hidden=false;change.onclick=()=>Clerk.signOut({redirectUrl:location.pathname});
  await Clerk.session.getToken({skipCache:true});
  if((await fetch("api/dealer-auth/me",{cache:"no-store"}).then(r=>r.json())).signedIn){location.replace("dealer");return}
  await Clerk.setActive({organization:${JSON.stringify(org)}});
  await Clerk.session.getToken({skipCache:true});
  const me=await fetch("api/dealer-auth/me",{cache:"no-store"}).then(r=>r.json());
  if(me.signedIn){location.replace("dealer");return}throw Error()
  })().catch(()=>{retry.hidden=false;message.textContent="Could not open this dealership. Check that you accepted the invitation with this email, then try again.";});</script></html>`;
}
function loadTwilioRoutes(){
  try{return JSON.parse(readFileSync(join(dataDir,"sms-routes.json"),"utf8"));}
  catch(e){if(e.code==="ENOENT")return {};throw e;}
}
let checkingTextUsage=false;
const textUsageTimer=setInterval(async()=>{
  if(checkingTextUsage)return;
  checkingTextUsage=true;
  try{
    const routes=loadTwilioRoutes();
    for(const site of Object.keys(routes)){
      const account=worker.managedTwilioAccount(routes,site);
      if(!account || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(site))continue;
      const tenant=(await pool.query("SELECT id FROM public.client_sites WHERE id=$1",[site])).rows[0];
      if(!tenant)continue;
      tenant.schema="client_"+tenant.id.replaceAll("-","");
      try{await scope.run(tenant,()=>worker.reconcileSmsUsage(db,account));}catch{console.warn("Dealer SMS usage sync pending for",site);}
    }
  }catch{console.warn("Unable to start dealer SMS usage sync.");}
  finally{checkingTextUsage=false;}
},300000);
textUsageTimer.unref();
createServer(async(req,res)=>{
  try{
    const base=new URL((req.headers["x-forwarded-proto"]==="https"?"https":"http")+"://"+req.headers.host);
    const pathMatch=/^\/clients\/([a-z0-9-]+)(\/.*)?$/.exec(req.url.split("?")[0]);
    let tenant=null,prefix="";
    if(pathMatch || !["demo.autodealership.si","localhost","127.0.0.1","[::1]","apex-motorclub-showroom-demo.benji108479.chatgpt.site"].includes(base.hostname)){
      if(pathMatch && !["autodealership.si","localhost","127.0.0.1"].includes(base.hostname)){res.writeHead(404).end();return;}
      tenant=(await pool.query(pathMatch?"SELECT * FROM public.client_sites WHERE slug=$1":"SELECT * FROM public.client_sites WHERE slug||'.autodealership.si'=$1 OR verified_domain=$1",[pathMatch?pathMatch[1]:base.hostname])).rows[0];
      if(!tenant){res.writeHead(404).end();return;}
      tenant.schema="client_"+tenant.id.replaceAll("-","");
      if(!/^client_[a-f0-9]{32}$/.test(tenant.schema))throw Error();
      if(pathMatch){
        prefix="/clients/"+tenant.slug;
        if(!pathMatch[2]){res.writeHead(302,{Location:prefix+"/"}).end();return;}
        req.url=req.url.slice(prefix.length);
      }
    }
    return await scope.run(tenant,async()=>{
    const supplied=Buffer.from(req.headers.authorization||"");
    const expected=Buffer.from("Basic "+Buffer.from("dealer:"+process.env.DEALER_PASSWORD).toString("base64"));
    const signed=!!process.env.DEALER_PASSWORD && supplied.length===expected.length && timingSafeEqual(supplied,expected);
    const dealerHost=tenant && !prefix && base.hostname===tenant.slug+".autodealership.si";
    const tenantDesk=dealerHost && /(?:^|; *)__Host-client_desk=([a-zA-Z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie||"");
    const desk=tenantDesk || (tenant && prefix && /(?:^|; *)client_desk=([a-zA-Z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie||""));
    const grant=desk && (await pool.query("SELECT s.engineer,e.email FROM public.client_desk_sessions s JOIN public.client_sites t USING(slug) LEFT JOIN public.client_engineers e ON e.id=s.engineer WHERE s.token=$1 AND s.slug=$2 AND s.expires>now() AND (s.engineer IS NULL OR (e.active AND t.engineer=s.engineer))",[createHash("sha256").update(desk[1]).digest("hex"),tenant.slug])).rows[0];
    const site=tenant?.id||"demo";
    const currentToken=/(?:^|; )dealer_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||"")?.[1];
    const tokenHash=currentToken && createHash("sha256").update(currentToken).digest("hex");
    const clerkOrg=tenant?.clerk_org_id;
    const claims=dealerHost && await dealerClaim(req.headers.cookie,base.origin);
    const clerkRole=clerkOrg && claims?.organization===clerkOrg && claims.role;
    const platformStaff=claims && (await pool.query("SELECT 1 FROM public.staff_clerk_links l WHERE l.subject=$1 AND (l.principal IN ('owner','owner:sales@autodealership.si') OR EXISTS(SELECT 1 FROM public.client_engineers e JOIN public.client_sites t ON t.engineer=e.id WHERE t.id=$2 AND e.active AND e.id::text=l.principal))",[claims.subject,tenant.id])).rowCount>0;
    const delegated=!!grant || platformStaff;
    const account=!clerkOrg && tokenHash && (await pool.query("SELECT s.email FROM public.dealer_sessions s LEFT JOIN public.dealer_users u ON u.site=s.site AND u.email=s.email WHERE s.token=$1 AND s.site=$2 AND s.expires>now() AND (s.email='dealer' OR u.active)",[tokenHash,site])).rows[0];
    const privileged=tenant ? delegated || (!clerkOrg && createHash("sha256").update(supplied).digest("hex")===tenant.admin_hash) : signed || ["localhost","127.0.0.1","[::1]"].includes(base.hostname) && !req.headers.forwarded && !req.headers["x-forwarded-for"];
    const privateAdmin=privileged || !!account || !!clerkRole;
    const managesUsers=privileged || account?.email==="dealer";
    const headers=new Headers();
    for(const [k,v] of Object.entries(req.headers))if(typeof v==="string"&&!k.startsWith("oai-"))headers.set(k,v);
    let body;
    if(["PUT","POST"].includes(req.method)){
      const chunks=[];let count=0;
      for await(const chunk of req){
        count+=chunk.length;
        if(count>(req.url==="/api/banner-editor" && privateAdmin?8700000:req.url==="/api/dealer-profile" && privateAdmin?2000000:1000000)){res.writeHead(413).end();return;}chunks.push(chunk);
      }
      body=Buffer.concat(chunks);
    }
    const route=new URL(req.url,base);
    const smsAccount=()=>{
      if(!tenant)return null;
      return worker.managedTwilioAccount(loadTwilioRoutes(),tenant.id);
    };
    const smsRoute=()=>{const account=smsAccount();return account && /^\+[1-9]\d{7,14}$/.test(account.from||"")?account:null;};
    const smsOrigin=tenant?"https://"+tenant.slug+".autodealership.si":"";
    if(["/api/dealer-sms/incoming","/api/dealer-sms/status"].includes(route.pathname)){
      if(!tenant || prefix || base.hostname!==tenant.slug+".autodealership.si" || req.method!=="POST" || !req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded") || body.length>24000){res.writeHead(403).end();return;}
      const params=new URLSearchParams(body.toString("utf8")),account=smsAccount();
      const phone=params.get(route.pathname.endsWith("/incoming")?"To":"From");
      let sender=smsRoute();
      if(account && phone!==sender?.from && /^\+[1-9]\d{7,14}$/.test(phone||"") && params.get("AccountSid")===account.account){
        const found=await pool.query("SELECT 1 FROM public.dealer_twilio_numbers WHERE site=$1 AND account=$2 AND service=$3 AND phone=$4",[site,account.account,account.service,phone]);
        if(found.rowCount)sender={...account,from:phone,outbound:false};
      }
      const result=await worker.dealerSmsWebhook(db,{route:sender,origin:smsOrigin,path:route.pathname+route.search,params,signature:req.headers["x-twilio-signature"]});
      res.writeHead(result.status,{"Content-Type":"text/xml","Cache-Control":"no-store"}).end(result.status===200?"<Response/>":"");return;
    }
    const emailManager=!!tenant && (!!managesUsers || clerkRole==="org:admin");
    if(route.pathname==="/api/text-account"){
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(!emailManager)return reply(403,{error:"Sign in as the dealer owner or assigned platform staff."});
      const account=smsAccount();
      if(req.method==="GET"){
        const exporting=route.searchParams.get("format")==="csv";
        const result=await worker.dealerSmsUsage(db,route.searchParams.get("month")||new Date().toISOString().slice(0,7),exporting);
        if(result.status!==200)return reply(result.status,result.data);
        if(exporting){
          const fields=["created_at","sid","direction","stock","status","segments","cost","currency"];
          const cell=value=>{const s=value instanceof Date?value.toISOString():String(value??"");return '"'+(/^[\s]*[=+@-]/.test(s)?"'":"")+s.replace(/"/g,'""')+'"';};
          const lines=[fields.join(","),...result.data.lines.map(row=>fields.map(f=>cell(row[f])).join(","))];
          return res.writeHead(200,{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="sms-usage-'+result.data.month+'.csv"',"Cache-Control":"no-store"}).end(lines.join("\r\n")+"\r\n");
        }
        const numbers=account?(await pool.query("SELECT sid,phone FROM public.dealer_twilio_numbers WHERE site=$1 AND account=$2 AND service=$3 ORDER BY phone",[site,account.account,account.service])).rows:[];
        return reply(200,{...result.data,connected:!!account,numbers,primary:smsRoute()?.from||null,webhook:smsOrigin+"/api/dealer-sms/incoming"});
      }
      if(req.method!=="POST" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"Use the dealer dashboard."});
      let data;try{data=JSON.parse(body);}catch{return reply(400,{error:"Invalid request."});}
      if(!account)return reply(409,{error:"The platform administrator must connect this dealership’s Twilio subaccount and Messaging Service."});
      if(data?.action==="reconcile"){
        const report=await worker.reconcileSmsUsage(db,account);return reply(report.status,report.data);
      }
      try{
        if(data?.action==="list")return reply(200,{numbers:await worker.listTwilioNumbers(account)});
        if(data?.action!=="import")return reply(400,{error:"Unknown number action."});
        const line=await worker.verifyTwilioNumber(account,data.sid);if(!line)return reply(400,{error:"Choose an SMS-enabled number from this dealership’s sender pool."});
        const bound=await pool.query("INSERT INTO public.dealer_twilio_numbers(sid,phone,site,account,service) VALUES($1,$2,$3,$4,$5) ON CONFLICT(sid) DO UPDATE SET phone=excluded.phone WHERE dealer_twilio_numbers.site=excluded.site AND dealer_twilio_numbers.account=excluded.account AND dealer_twilio_numbers.service=excluded.service RETURNING phone",[line.sid,line.phone,site,account.account,account.service]);
        return bound.rowCount?reply(200,line):reply(409,{error:"This number already has an assignment. Contact your platform administrator."});
      }catch(err){return reply(err.code==="23505"?409:502,{error:"Could not verify this number with Twilio. Check its sender pool and try again."});}
    }
    if(route.pathname==="/api/dealer-email/setup"){
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(req.method!=="POST" || !emailManager || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"A dealership administrator must open email setup."});
      const ticket=randomBytes(32).toString("base64url");
      await pool.query("DELETE FROM public.dealer_email_tickets WHERE expires<=now()");
      await pool.query("INSERT INTO public.dealer_email_tickets(token,site,expires) VALUES($1,$2,now()+interval '90 seconds')",[createHash("sha256").update(ticket).digest("hex"),site]);
      return reply(200,{url:"https://autodealership.si/onboarding/email#"+ticket});
    }
    if(prefix && ["/dealer","/dealer.html","/dealer-login"].includes(route.pathname) && req.method==="GET"){
      res.writeHead(302,{Location:"/onboarding/clerk-login?site="+encodeURIComponent(tenant.slug),"Cache-Control":"no-store"}).end();return;
    }
    if(dealerHost && route.pathname==="/dealer-team" && req.method==="GET"){
      if(!clerkOrg || clerkRole!=="org:admin"){res.writeHead(302,{Location:"/dealer","Cache-Control":"no-store"}).end();return;}
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex"}).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dealership staff</title><link rel="stylesheet" href="/dealer.css"><main><a class="quiet" href="/dealer">Back to dashboard</a><h1>Dealership staff</h1><div id="team"></div><p id="team-status" role="status">Loading staff accounts...</p></main>${clerkScript}<script>(async()=>{await Clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});await Clerk.setActive({organization:${JSON.stringify(clerkOrg)}});Clerk.mountOrganizationProfile(document.querySelector("#team"),{routing:"hash"});document.querySelector("#team-status").textContent=""})().catch(()=>document.querySelector("#team-status").textContent="Could not load staff accounts. Return to the dashboard and try again.");</script>`);return;
    }
    if(dealerHost && route.pathname==="/dealer-connect" && req.method==="GET"){
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Referrer-Policy":"no-referrer","Cache-Control":"no-store","X-Robots-Tag":"noindex"}).end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open dealer workspace</title><link rel="stylesheet" href="/dealer.css"><main><h1>Dealer workspace</h1><p id="state" role="status">Opening your dealership...</p><a hidden id="again" href="/dealer-login">Continue to sign-in</a></main><script>
      const ticket=location.hash.slice(1);history.replaceState(null,"","/dealer-connect");
      (async()=>{const r=await fetch("/api/desk-connect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket})});if(!r.ok)throw Error();location.replace("/dealer");})().catch(()=>{document.querySelector("#state").textContent="This sign-in link has expired or was already used.";document.querySelector("#again").hidden=false;});
      </script>`);return;
    }
    if(dealerHost && route.pathname==="/api/desk-connect" && req.method==="POST"){
      let ticket;try{ticket=JSON.parse(body).ticket}catch{}
      if(req.headers.origin!==base.origin || !/^[a-zA-Z0-9_-]{43}$/.test(ticket||"")){res.writeHead(403).end();return;}
      const session=randomBytes(32).toString("base64url");
      const hash=value=>createHash("sha256").update(value).digest("hex");
      const created=await pool.query(`WITH used AS (DELETE FROM public.client_desk_sessions WHERE token=$1 AND slug=$2 AND expires>now() RETURNING slug,engineer)
        INSERT INTO public.client_desk_sessions(token,slug,engineer,expires)
        SELECT $3,u.slug,u.engineer,now()+interval '1 hour' FROM used u JOIN public.client_sites t USING(slug) LEFT JOIN public.client_engineers e ON e.id=u.engineer WHERE u.engineer IS NULL OR (t.engineer=u.engineer AND e.active)`,[hash("handoff:"+ticket),tenant.slug,hash(session)]);
      if(!created.rowCount){res.writeHead(403).end();return;}
      res.writeHead(204,{"Cache-Control":"no-store","Set-Cookie":"__Host-client_desk="+session+"; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600"}).end();return;
    }
    if(route.pathname==="/api/vehicle-photos" && req.method==="POST"){
      if(!privateAdmin || req.headers.origin!==base.origin){res.writeHead(403).end();return;}
      if(req.headers["content-type"]!=="image/jpeg" || body.length<4 || body.readUInt16BE(0)!==0xffd8 || body.readUInt16BE(body.length-2)!==0xffd9){res.writeHead(400).end();return;}
      const hash=createHash("sha256").update(body).digest("hex");
      await db.query("INSERT INTO public.vehicle_photo_assets(site,digest,jpeg) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[site,hash,body]);
      res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({url:"assets/vehicle-photos/"+hash+".jpg"}));return;
    }
    const photo=/^\/assets\/vehicle-photos\/([a-f0-9]{64})\.jpg$/.exec(route.pathname);
    if(photo && ["GET","HEAD"].includes(req.method)){
      const {rows}=await db.query("SELECT jpeg FROM public.vehicle_photo_assets WHERE site=$1 AND digest=$2",[site,photo[1]]);
      if(!rows.length){res.writeHead(404).end();return;}
      res.writeHead(200,{"Content-Type":"image/jpeg","X-Content-Type-Options":"nosniff","Cache-Control":"public,max-age=31536000,immutable"}).end(req.method==="HEAD"?undefined:rows[0].jpeg);return;
    }
    if(route.pathname==="/api/vin-decode" && req.method==="GET"){
      const send=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(!privateAdmin)return send(403,{error:"Dealer sign-in required."});
      const vin=route.searchParams.get("vin")||"";
      if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))return send(400,{error:"Invalid VIN."});
      try{
        const {rows}=await pool.query("SELECT variable,value,code FROM vpic.spvindecode($1) WHERE nullif(trim(value),'') IS NOT NULL",[vin]);
        const result=Object.fromEntries(rows.map(item=>[item.code,item.value]));
        const details=rows.filter(item=>!["ErrorCode","ErrorText","SuggestedVIN","PossibleValues","VehicleDescriptor"].includes(item.code) && !/^(not applicable|unknown|not available)$/i.test(item.value)).map(({variable,value})=>[variable,value]);
        return send(200,{Results:[result],details});
      }catch{return send(503,{error:"Local VIN catalog unavailable."})}
    }
    if(tenant && route.pathname.startsWith("/api/web-voice/")){
      const op=route.pathname.split("/").pop();
      const send=(code,obj)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(obj));
      if(req.method==="POST" && req.headers.origin!==base.origin)return send(403,{});
      if(op==="start" && req.method==="POST"){
        if(!tenant.voice || !tenant.agent_id)return send(409,{error:"Voice is unavailable."});
        const result=await voiceProvider("conversation/get-signed-url?include_conversation_id=true&agent_id="+encodeURIComponent(tenant.agent_id));
        const conversation=new URL(result.signed_url).searchParams.get("conversation_id");
        if(!conversation)return send(502,{error:"Voice connection unavailable."});
        await pool.query("INSERT INTO public.web_voice_calls(conversation,site,agent) VALUES($1,$2,$3)",[conversation,site,tenant.agent_id]);
        return send(200,{signedUrl:result.signed_url});
      }
      if(!privateAdmin)return send(403,{});
      const month=route.searchParams.get("month")||new Date().toISOString().slice(0,7);
      if(!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(month))return send(400,{});
      if(op==="settings" && req.method==="GET")return send(200,{agent:tenant.agent_id,editable:!!delegated,...await voiceReport(site,month+"-01")});
      if(op==="settings" && req.method==="POST" && delegated){
        let d;try{d=JSON.parse(body)}catch{return send(400,{})}
        if(!/^agent_[a-zA-Z0-9]+$/.test(d.agent) || d.agent.length>100)return send(400,{error:"Enter a valid agent ID."});
        const hasTerms=d.minutes!=null || d.cents!=null;
        if(hasTerms && ![d.minutes,d.cents].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000))return send(400,{error:"Enter both allowance and rate."});
        try{await voiceProvider("agents/"+d.agent)}catch{return send(422,{error:"The master account could not access that agent."})}
        const conn=await pool.connect();
        try{await conn.query("BEGIN");await conn.query("UPDATE public.client_sites SET agent_id=$1,voice=true,agent_state='connected' WHERE id=$2",[d.agent,site]);
          if(hasTerms)await conn.query("INSERT INTO public.web_voice_terms VALUES($1,date_trunc('month',now() AT TIME ZONE 'UTC')::date,$2,$3) ON CONFLICT(site,month) DO UPDATE SET minutes=excluded.minutes,cents=excluded.cents",[site,d.minutes,d.cents]);
          await conn.query("COMMIT");
        }catch(e){await conn.query("ROLLBACK");throw e}finally{conn.release()}
        return send(200,{saved:true});
      }
      return send(403,{});
    }
    if(clerkOrg && ["/dealer-login","/dealer-signin.html"].includes(route.pathname)){
      if(prefix){res.writeHead(302,{Location:"/onboarding/clerk-login?site="+encodeURIComponent(tenant.slug),"Cache-Control":"no-store"}).end();return}
      if(base.hostname!==tenant.slug+".autodealership.si"){res.writeHead(302,{Location:"https://"+tenant.slug+".autodealership.si/dealer-login"}).end();return}
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Frame-Options":"DENY"}).end(clerkDealerPage(clerkOrg,tenant.slug));return;
    }
    const feedPublic=route.pathname==="/feeds/google-vehicles.xml";
    if(feedPublic || route.pathname==="/api/vehicle-feed-status" || route.pathname==="/api/conversions.csv"){
      const headers={"Cache-Control":"private, no-store, max-age=0","X-Robots-Tag":"noindex","X-Content-Type-Options":"nosniff"};
      if(!["GET","HEAD"].includes(req.method)){res.writeHead(405,{...headers,Allow:"GET, HEAD"}).end();return;}
      if(!feedPublic && !privateAdmin){res.writeHead(403,headers).end();return;}
      if(route.pathname==="/api/conversions.csv"){
        const csv=await worker.dealerConversionExport(db);
        res.writeHead(200,{...headers,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="showroom-conversions-30-days.csv"'}).end(req.method==="HEAD"?undefined:csv);return;
      }
      const origin="https://"+(tenant?(tenant.verified_domain||tenant.slug+".autodealership.si"):"demo.autodealership.si");
      const result=await worker.readVehicleFeed(db,origin,!tenant||!!tenant.bhph,!feedPublic);
      if(result===null){res.writeHead(404,headers).end("Vehicle feed is not enabled.");return;}
      res.writeHead(200,{...headers,"Content-Type":feedPublic?"application/xml; charset=utf-8":"application/json"}).end(req.method==="HEAD"?undefined:feedPublic?result:JSON.stringify(result));return;
    }
    if(route.pathname==="/api/oem-brand-library"){
      const headers={"Content-Type":"application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex","Cross-Origin-Resource-Policy":"same-origin"};
      const send=(code,value)=>res.writeHead(code,headers).end(JSON.stringify(value));
      if(!privateAdmin)return send(403,{error:"Dealer sign-in required."});
      const canReview=!!managesUsers||clerkRole==="org:admin";
      let input;
      if(req.method==="POST"){
        if(!canReview || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return send(403,{error:"Use an administrator account in the dealer workspace."});
        if(body.length>700000)return send(413,{error:"Choose a PNG under 500 KB."});
        try{input=JSON.parse(body);}catch{return send(400,{error:"Invalid artwork data."});}
      }
      const actor=(clerkRole||platformStaff)?claims.subject:grant?(grant.engineer?"engineer:"+grant.engineer:"platform owner"):account?.email||"dealer administrator";
      const result=await worker.oemBrandLibrary({db,platform:pool,method:req.method,brand:route.searchParams.get("brand"),
        asset:route.searchParams.get("asset"),scope:route.searchParams.get("scope"),input,actor,canReview});
      if(result.image){
        res.writeHead(200,{...headers,"Content-Type":"image/png","Content-Security-Policy":"default-src 'none'; sandbox"}).end(result.image);return;
      }
      return send(result.status,result.data);
    }
    if(route.pathname==="/api/website-pages"){
      const send=(status,data)=>res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"private, no-store","X-Robots-Tag":"noindex"}).end(JSON.stringify(data));
      if(!privateAdmin)return send(403,{error:"Dealer sign-in required."});
      let input;
      if(req.method==="POST"){
        if(req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return send(403,{error:"Use this dealership dashboard."});
        if(body.length>80000)return send(413,{error:"Page content is too large."});
        try{input=JSON.parse(body);}catch{return send(400,{error:"Invalid page data."});}
      }
      const actor=(clerkRole||platformStaff)?claims.subject:grant?(grant.email||"Platform owner"):account?.email||"Dealer administrator";
      if(req.method==="GET" && route.searchParams.get("view")==="review-queue"){
        const result=await worker.pageReviewQueue(db);return send(result.status,result.data);
      }
      const result=await worker.pageWorkflow({db,key:route.searchParams.get("key"),method:req.method,input,tenant,actor,manager:!!managesUsers||clerkRole==="org:admin",exportHistory:route.searchParams.get("export")==="review-history",
        fingerprint:value=>createHash("sha256").update(value).digest("hex"),uuid:randomUUID});
      return send(result.status,result.data);
    }
    if(route.pathname==="/api/website-offers"){
      const headers={"Content-Type":"application/json","Cache-Control":"private, no-store","X-Robots-Tag":"noindex"};
      if(req.method!=="GET"){res.writeHead(405,{...headers,Allow:"GET"}).end();return;}
      const offers=(await worker.websiteOffers(db,!!tenant)).map(({id,...publicOffer})=>publicOffer);
      res.writeHead(200,headers).end(JSON.stringify(offers));return;
    }
    if(route.pathname==="/api/oem-programs"){
      const headers={"Content-Type":"application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
      const send=(code,data)=>res.writeHead(code,headers).end(JSON.stringify(data));
      if(!privateAdmin)return send(403,{error:"Dealer sign-in required."});
      let input;
      if(req.method==="POST"){
        if(req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return send(403,{error:"Use the dealer workspace."});
        if(body.length>16000)return send(413,{error:"Program is too large."});
        try{input=JSON.parse(body);}catch{return send(400,{error:"Invalid program data."});}
      }
      const actor=(clerkRole||platformStaff)?claims.subject:grant?(grant.engineer?"engineer:"+grant.engineer:"platform owner"):account?.email||"dealer administrator";
      const exportId=route.searchParams.get("export");
      const result=await worker.oemProgramsApi({db,method:req.method,input,actor,canReview:!!managesUsers||clerkRole==="org:admin",exportId,tenant:!!tenant});
      if(req.method==="GET" && exportId && result.status===200)headers["Content-Disposition"]='attachment; filename="oem-program-'+exportId+'.json"';
      return send(result.status,result.data);
    }
    if(route.pathname==="/api/test-drives/desk"){
      const send=(status,data)=>res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"private, no-store"}).end(JSON.stringify(data));
      if(!privateAdmin)return send(403,{error:"Dealer sign-in required."});
      let input;
      if(req.method==="PUT"){
        if(req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return send(403,{error:"Use this dealership dashboard."});
        try{input=JSON.parse(body);}catch{return send(400,{error:"Invalid visit update."});}
      }
      const actor=(clerkRole||platformStaff)?claims.subject:grant?(grant.engineer?"engineer:"+grant.engineer:"platform owner"):account?.email||"dealer administrator";
      const result=await worker.visitDesk(db,req.method,input,actor);
      return send(result.status,result.data);
    }
    if(route.pathname==="/api/dealer-marketing"){
      const send=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(!privateAdmin)return send(403,{error:"Dealer sign-in required."});
      let input;
      if(req.method==="POST"){
        if(req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return send(403,{error:"Use the dealer workspace."});
        if(body.length>32000)return send(413,{error:"Campaign is too large."});
        try{input=JSON.parse(body);}catch{return send(400,{error:"Invalid campaign data."});}
      }
      const actor=(clerkRole || platformStaff)?claims.subject:grant?(grant.engineer?"engineer:"+grant.engineer:"platform owner"):account?.email||"dealer administrator";
      const result=await worker.dealershipMarketing({db,method:req.method,input,historyId:route.searchParams.get("history"),canReview:!!managesUsers || clerkRole==="org:admin",actor});
      return send(result.status,result.data);
    }
    if(route.pathname.startsWith("/api/dealer-auth/")){
      const op=route.pathname.split("/").pop();
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(req.method==="GET" && op==="me")return reply(200,{signedIn:!!privateAdmin,managesEmail:emailManager,managesUsers:clerkOrg?clerkRole==="org:admin":!!managesUsers,clerk:!!(clerkRole||platformStaff),teamUrl:clerkRole==="org:admin"?"/dealer-team":null});
      if(clerkOrg && op!=="logout")return reply(403,{error:"Use your Clerk dealership account."});
      if(req.method==="GET" && op==="users" && managesUsers)return reply(200,(await pool.query("SELECT email,active FROM public.dealer_users WHERE site=$1 ORDER BY email",[site])).rows);
      if(req.method!=="POST" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"Sign in required."});
      let d;try{d=JSON.parse(body);}catch{return reply(400,{error:"Invalid request."});}
      const email=String(d.email||"").trim().toLowerCase(),pw=String(d.password||"");
      const cookie=(token,seconds)=>"dealer_session="+token+"; Path="+(prefix||"")+"/; HttpOnly; Secure; SameSite=Strict; Max-Age="+seconds;
      if(op==="signin"){
        const ip=req.headers["x-forwarded-for"]||req.socket.remoteAddress;
        const attempts=await pool.query("INSERT INTO public.dealer_login_attempts VALUES($1,$2,1,now()) ON CONFLICT(site,ip) DO UPDATE SET attempts=CASE WHEN dealer_login_attempts.started<now()-interval '10 minutes' THEN 1 ELSE dealer_login_attempts.attempts+1 END,started=CASE WHEN dealer_login_attempts.started<now()-interval '10 minutes' THEN now() ELSE dealer_login_attempts.started END RETURNING attempts",[site,ip]);
        if(attempts.rows[0].attempts>20)return reply(429,{error:"Too many attempts. Try again in ten minutes."});
        if(!pw || pw.length>256 || email.length>254)return reply(403,{error:"Check your login details."});
        let valid=false;
        if(email==="dealer"){
          const basic="Basic "+Buffer.from("dealer:"+pw).toString("base64");
          const hash=tenant?.admin_hash || createHash("sha256").update(expected).digest("hex");
          valid=timingSafeEqual(createHash("sha256").update(basic).digest(),Buffer.from(hash,"hex"));
        }else{
          const u=(await pool.query("SELECT salt,hash FROM public.dealer_users WHERE site=$1 AND email=$2 AND active",[site,email])).rows[0];
          const hash=await passwordHash(pw,u?.salt||"unknown-dealer-user",32);
          valid=u && timingSafeEqual(hash,Buffer.from(u.hash,"hex"));
        }
        if(!valid)return reply(403,{error:"Check your login details."});
        const token=randomBytes(32).toString("hex");
        await pool.query("INSERT INTO public.dealer_sessions VALUES($1,$2,$3,now()+interval '12 hours')",[createHash("sha256").update(token).digest("hex"),site,email]);
        res.setHeader("Set-Cookie",cookie(token,43200));return reply(200,{});
      }
      if(op==="logout"){
        if(tokenHash)await pool.query("DELETE FROM public.dealer_sessions WHERE token=$1",[tokenHash]);
        if(desk)await pool.query("DELETE FROM public.client_desk_sessions WHERE token=$1",[createHash("sha256").update(desk[1]).digest("hex")]);
        res.setHeader("Set-Cookie",tenantDesk?[cookie("",0),"__Host-client_desk=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0"]:cookie("",0));return reply(200,{});
      }
      if(!managesUsers)return reply(403,{error:"Dealer administrator access required."});
      if(op==="users"){
        if(!/^[^ @]+@[^ @]+\.[^ @]+$/.test(email)||email.length>254||pw.length<14||pw.length>128)return reply(400,{error:"Enter a staff email and a password of 14 to 128 characters."});
        const salt=randomBytes(16).toString("hex"),hash=await passwordHash(pw,salt,32);
        const r=await pool.query("INSERT INTO public.dealer_users(site,email,salt,hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING email",[site,email,salt,hash.toString("hex")]);
        return r.rowCount?reply(201,{}):reply(409,{error:"This user already exists."});
      }
      if(op==="disable"){await pool.query("UPDATE public.dealer_users SET active=false WHERE site=$1 AND email=$2",[site,email]);return reply(200,{});}
      return reply(404,{});
    }
    if(["/dealer","/dealer.html"].includes(route.pathname) && !privateAdmin){res.writeHead(302,{Location:prefix?"/onboarding/clerk-login?site="+encodeURIComponent(tenant.slug):"/dealer-login","Cache-Control":"no-store"}).end();return;}
    if(route.pathname==="/api/bhph"){
      if(tenant && !tenant.bhph){res.writeHead(req.method==="GET"?200:403,{"Content-Type":"application/json"}).end("{}");return;}
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      const vehicle=route.searchParams.get("vehicle");
      if(req.method==="GET" && !vehicle){
        const {rows}=await db.query(showroomOffersQuery);
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
      const result=data.revision===0?await db.query("INSERT INTO bhph_offers(vehicle,revision,offer) VALUES($1,1,$2) ON CONFLICT DO NOTHING RETURNING revision",[vehicle,offer]):
        await db.query("UPDATE bhph_offers SET offer=$2,revision=revision+1 WHERE vehicle=$1 AND revision=$3 RETURNING revision",[vehicle,offer,data.revision]);
      return result.rowCount?reply(200,result.rows[0]):reply(409,{error:"Pricing changed in another session. Reopen the editor."});
    }
    if(route.pathname==="/api/purchase-feedback"){
      const send=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"private, no-store","X-Robots-Tag":"noindex"}).end(JSON.stringify(data));
      if(req.method!=="POST" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return send(403,{error:"Open the feedback page."});
      if(body.length>6000)return send(413,{error:"Feedback too long."});
      let data;try{data=JSON.parse(body);}catch{return send(400,{error:"Invalid feedback request."});}
      const result=await worker.customerFeedback(db,data);return send(result.status,result.data);
    }
    if(route.pathname==="/api/reputation" || route.pathname==="/api/clients" || route.pathname==="/api/inquiries" || route.pathname==="/api/inquiries/team" || route.pathname==="/api/inquiries/history" || route.pathname==="/api/inquiries/texts" || route.pathname==="/api/conversations" || route.pathname==="/api/conversations/email"){
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      const currentActor=()=>{
        if(clerkRole || platformStaff)return {id:"clerk:"+claims.subject,label:platformStaff?"Platform staff":"Dealership staff"};
        if(grant)return grant.engineer?{id:"engineer:"+grant.engineer,label:grant.email||"Assigned engineer"}:{id:"platform:owner",label:"Platform owner"};
        if(account?.email && account.email!=="dealer")return {id:"account:"+account.email,label:account.email};
        return {id:"dealer",label:"Dealer administrator"};
      };
      const team=()=>worker.followupTeam(pool,{site,organization:clerkOrg,actor:currentActor(),manager:!!managesUsers||clerkRole==="org:admin"});
      const smsActor=()=>({...currentActor(),manager:!!managesUsers || clerkRole==="org:admin"});
      if(route.pathname==="/api/clients" || route.pathname==="/api/reputation"){
        if(!privateAdmin)return reply(403,{error:"Dealer sign-in required."});
        let input=Object.fromEntries(route.searchParams);
        if(req.method!=="GET"){
          if(!["POST","PUT"].includes(req.method))return reply(405,{error:"Unsupported client action."});
          if(req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"Open the dealer dashboard."});
          if(body.length>12000)return reply(413,{error:"Client request is too large."});
          try{input=JSON.parse(body);}catch{return reply(400,{error:"Invalid client request."});}
        }
        const handler=route.pathname==="/api/reputation"?worker.reputationDesk:worker.salesClients;
        let sender=null;
        if(tenant && (route.pathname==="/api/reputation" || input?.stage==="signed" && input?.reviewPermission===true) &&
          (await pool.query("SELECT to_regclass('public.dealer_email_grants') AS t")).rows[0].t){
          const grant=(await pool.query("SELECT domain,domain_id FROM public.dealer_email_grants WHERE site=$1 AND verified AND NOT reconnect AND domain_id IS NOT NULL",[site])).rows[0];
          if(grant)sender={...grant,origin:"https://"+tenant.slug+".autodealership.si"};
        }
        const result=await handler(db,req.method,input,await team(),sender);
        return reply(result.status,result.data);
      }
      if(route.pathname.startsWith("/api/conversations")){
        if(!privateAdmin)return reply(403,{error:"Dealer sign-in required."});
        const mailbox=async()=>tenant && (await pool.query("SELECT to_regclass('public.dealer_mailboxes') AS t")).rows[0].t &&
          (await pool.query("SELECT g.domain FROM public.dealer_mailboxes m JOIN public.dealer_email_grants g ON g.site=m.site AND g.domain=m.domain AND g.domain_id=m.domain_id WHERE m.site=$1 AND g.verified AND NOT g.reconnect",[site])).rows[0]?.domain||null;
        if(req.method==="GET" && route.pathname==="/api/conversations"){
          const offset=Number(route.searchParams.get("offset")||0);
          if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)return reply(400,{error:"Invalid page."});
          const result=await worker.readSalesConversations(db,{team:await team(),id:route.searchParams.get("id"),queue:route.searchParams.get("queue"),search:route.searchParams.get("search"),offset});
          if(result.status===200 && result.data.opportunity)result.data.mailbox=await mailbox();
          return reply(result.status,result.data);
        }
        if(req.headers.origin!==base.origin||!req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"Open the dealer dashboard."});
        let data;try{data=JSON.parse(body);}catch{return reply(400,{error:"Invalid conversation request."});}
        const result=req.method==="PUT" && route.pathname==="/api/conversations"?await worker.changeSalesOpportunity(db,data,await team()):
          req.method==="POST" && route.pathname==="/api/conversations/email"?await worker.queueConversationMail(db,data,smsActor(),await mailbox()):{status:405,data:{}};
        return reply(result.status,result.data);
      }
      if(route.pathname==="/api/inquiries/texts"){
        if(!privateAdmin)return reply(403,{error:"Dealer sign-in required."});
        if(req.method==="GET"){
          const result=await worker.dealerSmsThread(db,{id:route.searchParams.get("id"),message:route.searchParams.get("message"),actor:smsActor(),route:smsRoute()});
          return reply(result.status,result.data);
        }
        if(req.method!=="POST" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{error:"Open the conversation in the dealer dashboard."});
        let payload;try{payload=JSON.parse(body);}catch{return reply(400,{error:"Invalid draft reference."});}
        const result=await worker.sendInquirySms(db,{id:payload?.id,revision:payload?.revision,actor:smsActor(),route:smsRoute(),origin:smsOrigin});
        return reply(result.status,result.data);
      }
      if(route.pathname!=="/api/inquiries"){
        if(!privateAdmin)return reply(403,{error:"Dealer sign-in required."});
        if(req.method!=="GET")return reply(405,{error:"Use GET."});
        if(route.pathname.endsWith("/team"))return reply(200,await team());
        const id=route.searchParams.get("id");
        if(!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id||""))return reply(400,{error:"Invalid inquiry."});
        const row=(await db.query("SELECT body#>'{followUp,history}' AS history FROM shopper_leads WHERE id=$1",[id])).rows[0];
        return row?reply(200,row.history||[]):reply(404,{error:"Inquiry unavailable."});
      }
      if(req.method==="GET")return privateAdmin?reply(200,(await db.query("SELECT body #- '{followUp,history}' AS body FROM shopper_leads ORDER BY body->>'createdAt' DESC")).rows.map(r=>r.body)):reply(403,{});
      if(req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json"))return reply(403,{});
      let input;try{input=JSON.parse(body)}catch{return reply(400,{})}
      if(req.method==="PUT"){
        if(!privateAdmin)return reply(403,{});
        if(input?.action==="save-text-draft"){
          if(!/^[0-9a-f-]{36}$/i.test(input.id) || typeof input.text!=="string" || !input.text.trim() || input.text.length>1000 || typeof input.revision!=="string")return reply(400,{error:"Check the draft and reopen the inquiry."});
          const saved=await worker.saveOpportunityDraft(db,input,smsActor());
          return reply(saved.status,saved.data);
        }
        if(input?.action && input.action!=="save-follow-up")return reply(400,{error:"Unknown inquiry action."});
        const result=await worker.updateInquiry(db,input,await team(),!input?.action);
        return reply(result.status,result.data);
      }
      if(req.method!=="POST")return reply(405,{});
      const voiceInquiry=input?.source==="Voice concierge";
      if(voiceInquiry){
        const {name,phone,message,requestId}=input;
        if(typeof name!=="string" || !name.trim() || name.length>100 ||
           typeof phone!=="string" || !/^\+?[0-9(). -]{7,40}$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g,"")) ||
           typeof message!=="string" || !message.trim() || message.length>2000 ||
           !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)){
          return reply(400,{error:"A name, callback number and vehicle question are required."});
        }
      }
      if(!input?.name?.trim()||!(input.email||input.phone)||body.length>8000)return reply(400,{error:"Enter your name and contact details."});
      const car=(await db.query("SELECT body FROM client_cars WHERE vin=$1 AND NOT EXISTS (SELECT 1 FROM inventory_status WHERE vin=$1)",[input.carId])).rows[0]?.body;
      if(!car)return reply(404,{error:"Vehicle unavailable"});
      const lead={id:voiceInquiry?input.requestId:randomUUID(),createdAt:new Date().toISOString(),status:"New",carId:car.id,
        car:Object.fromEntries(["id","vin","year","make","model","stock","image"].map(k=>[k,car[k]]))};
      for(const k of ["name","email","phone","message","source"])lead[k]=String(input[k]||"").slice(0,2000);
      try{const preference=worker.InquiryContact.request(input,lead.createdAt);if(preference)lead.textReplyRequest=preference;}
      catch(err){return reply(400,{error:err.message});}
      const saved=await worker.recordShopperInquiry(db,lead);
      if(!saved.rowCount){
        const prior=(await db.query("SELECT body FROM shopper_leads WHERE id=$1",[lead.id])).rows[0]?.body;
        if(!voiceInquiry || !prior || !["source","name","phone","message","carId"].every(key=>prior[key]===lead[key]))return reply(409,{error:"Inquiry reference already in use."});
        return reply(200,{id:lead.id});
      }
      return reply(201,{id:lead.id});
    }
    if(route.pathname==="/api/dealer-inventory"){
      const headers={"Content-Type":"application/json","Cache-Control":"private, no-store","X-Robots-Tag":"noindex","Cross-Origin-Resource-Policy":"same-origin"};
      if(!privateAdmin){res.writeHead(403,headers).end(JSON.stringify({error:"Dealer sign-in required."}));return;}
      if(req.method!=="GET"){res.writeHead(405,{...headers,Allow:"GET"}).end();return;}
      const result=await worker.inventoryDesk(db,!!tenant);
      const json=JSON.stringify(result.data);
      if(json.length>65536 && /\bgzip\b/.test(req.headers["accept-encoding"]||"")){res.writeHead(200,{...headers,"Content-Encoding":"gzip",Vary:"Accept-Encoding"}).end(await zipInventory(json));return;}
      res.writeHead(200,headers).end(json);return;
    }
    if(route.pathname==="/api/inventory-review" && req.method==="GET"){
      if(!privateAdmin){res.writeHead(403).end();return;}
      const vins=[...new Set(route.searchParams.getAll("vin"))];
      if(vins.length>32 || vins.some(v=>!/^[A-HJ-NPR-Z0-9]{17}$/.test(v))){res.writeHead(400).end();return;}
      const cars=(await db.query("SELECT vin FROM client_cars WHERE vin=ANY($1::text[])",[vins])).rows.map(c=>c.vin);
      const rows=await vinIdentities(cars,route.searchParams.get("decode")==="1" && cars.length<=12);
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(rows));return;
    }
    if(route.pathname==="/api/client-inventory" && req.method==="PUT"){
      if(!privateAdmin || req.headers.origin!==base.origin){res.writeHead(403).end();return;}
      let car;try{car=JSON.parse(body);}catch{}
      if(car && ["financeEstimateEnabled","leaseEstimateEnabled"].some(k=>Object.hasOwn(car,k) && typeof car[k]!=="boolean")){
        res.writeHead(422,{"Content-Type":"application/json"}).end(JSON.stringify({error:"Invalid vehicle estimate settings."}));return;
      }
      const field=!car || !/^[A-HJ-NPR-Z0-9]{17}$/.test(car.vin)?"Enter a valid 17-character VIN (letters I, O and Q are excluded).":!car.stock?"Enter the stock number.":!car.make?"Enter the make.":!car.model?"Enter the model.":null;
      if(field){res.writeHead(400,{"Content-Type":"application/json"}).end(JSON.stringify({error:field}));return;}
      const identity=(await vinIdentities([car.vin],true))[0];
      const entered=[car.year,car.make,car.model].map(v=>String(v??"").trim());
      const norm=v=>v.toLowerCase().replace(/[^a-z0-9]/g,"");
      const mismatch=identity && ["year","make","model"].some((k,i)=>identity[k] && norm(identity[k])!==norm(entered[i]));
      const decision=mismatch?JSON.stringify([car.vin,...entered,identity.year,identity.make,identity.model]):null;
      if(mismatch && car.vinReviewDecision!==decision){
        res.writeHead(422,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify({error:"Review the VIN and listing details before publishing.",identity}));return;
      }
      car.vinReviewDecision=decision;
      car.id=car.vin;
      const result=await worker.saveInventoryRecord(db,car);
      res.writeHead(result.status,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(result.data));return;
    }
    if((route.pathname==="/assets/cdjr-inventory.js" || route.pathname==="/api/showroom-inventory") && req.method==="GET"){
      const deskBootstrap=route.pathname==="/assets/cdjr-inventory.js" && route.searchParams.get("workspace")==="1";
      const cars=deskBootstrap?[]:(await db.query("SELECT c.body FROM client_cars c WHERE NOT EXISTS(SELECT 1 FROM inventory_status s WHERE s.vin=c.vin) ORDER BY "+(tenant?"c.vin":"c.position"))).rows.map(r=>r.body);
      const json=route.pathname==="/api/showroom-inventory";
      const siteMeta=tenant?{slug:tenant.slug,name:tenant.name,agent:tenant.agent_id,bhph:tenant.bhph}:null;
      const payload=json?JSON.stringify(cars):"window.postgresInventory=true;window.clientSite="+JSON.stringify(siteMeta)+";window.CdjrInventory="+JSON.stringify(cars)+";";
      const compress=payload.length>65536 && /\bgzip\b/.test(req.headers["accept-encoding"]||"");
      res.writeHead(200,{"Content-Type":json?"application/json":"application/javascript","Cache-Control":"no-store","Vary":"Accept-Encoding",...(compress?{"Content-Encoding":"gzip"}:{})});
      if(compress)res.end(await zipInventory(payload));else res.end(payload);
      return;
    }
    if(route.pathname==="/assets/cdjr-covers.js"){res.writeHead(200,{"Content-Type":"application/javascript"}).end("window.CdjrCovers={};");return;}
    const artRoute=/^\/api\/template-art\/([a-f0-9]{64})\/(desktop|mobile)\.jpg$/.exec(route.pathname);
    if(artRoute){
      const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex"};
      if(!["GET","HEAD"].includes(req.method)){res.writeHead(405,{...headers,Allow:"GET, HEAD"}).end();return;}
      const [,id,size]=artRoute;
      if(!privateAdmin){
        const selected=await db.query("SELECT 1 FROM homepage_banners WHERE id=1 AND config->>'heroMode'='artwork' AND config->>'heroArtwork'=$1",[id]);
        if(!selected.rowCount){res.writeHead(404,headers).end();return;}
      }
      const {rows}=await pool.query("SELECT "+(size==="mobile"?"mobile":"desktop")+" AS image FROM public.template_hero_art WHERE id=$1",[id]);
      if(!rows.length){res.writeHead(404,headers).end();return;}
      res.writeHead(200,{...headers,"Content-Type":"image/jpeg","Content-Length":rows[0].image.length}).end(req.method==="HEAD"?undefined:rows[0].image);return;
    }
    if(["/api/banners","/api/banner-editor"].includes(route.pathname)){
      const editor=route.pathname.endsWith("editor");
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(editor && !privateAdmin)return reply(403,{error:"Use Dealer sign in to manage banners."});
      if(req.method==="GET"){
        const row=(await db.query("SELECT revision,config FROM homepage_banners WHERE id=1")).rows[0];
        const config=row?.config??{enabled:false,slides:[]};
        const settings=(await db.query("SELECT settings->'profile'->>'siteTemplate' AS template,settings->'profile'->>'driveTimezone' AS timezone FROM client_profile WHERE id=1")).rows[0]||{};
        const franchise=settings.template==="franchise",timezone=settings.timezone||"America/Chicago";
        const checked=await worker.governedSlides(db,config.slides||[],franchise,timezone,!!tenant);
        if(editor){
          const art=(await pool.query("SELECT id,layout,title FROM public.template_hero_art ORDER BY layout,title,id")).rows;
          return reply(200,{...config,art,revision:row?.revision??0,franchise,timezone,states:checked.map(row=>row.status)});
        }
        const slides=config.enabled?checked.filter(row=>["Standard banner","Approved"].includes(row.status)).map(({slide,disclosure,expiresAt})=>({image:slide.image,alt:slide.alt,link:slide.link,disclosure,expiresAt})):[];
        const publicConfig={heroArtwork:config.heroMode==="artwork"?config.heroArtwork:null,heroImage:config.heroMode==="dealership"?config.heroImage:null,slides,governed:franchise||checked.some(row=>row.slide.program)};
        const json=JSON.stringify(publicConfig),tag='"'+createHash("sha256").update(json).digest("hex")+'"';
        if(req.headers["if-none-match"]===tag){res.writeHead(304,{"Cache-Control":"private, no-cache",ETag:tag}).end();return;}
        res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"private, no-cache",ETag:tag}).end(json);return;
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
        const program=worker.oemBinding(slide);
        if(slide.program && !program)return reply(400,{error:"Choose a valid program revision."});
        slides.push({image:slide.image,alt:slide.alt.trim(),link:slide.link,...(program?{program}:{})});
      }
      const heroMode=data.heroMode??"vehicle",heroImage=data.heroImage??"";
      if(!["vehicle","dealership","artwork"].includes(heroMode) || typeof heroImage!=="string" || heroImage.length>2400000 || (heroImage && !/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+=*$/.test(heroImage)) || (heroMode==="dealership" && !heroImage))return reply(400,{error:"Upload a dealership photo before enabling the dealership hero."});
      const heroArtwork=heroMode==="artwork"?data.heroArtwork:null;
      if(heroMode==="artwork" && (!/^[a-f0-9]{64}$/.test(heroArtwork||"") || !(await pool.query("SELECT 1 FROM public.template_hero_art WHERE id=$1",[heroArtwork])).rowCount))return reply(400,{error:"Choose an available template image."});
      const config=JSON.stringify({enabled:data.enabled,slides,heroMode,heroImage,heroArtwork});
      const saved=data.revision===0?await db.query("INSERT INTO homepage_banners VALUES(1,1,$1) ON CONFLICT DO NOTHING RETURNING revision",[config]):
        await db.query("UPDATE homepage_banners SET config=$1,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING revision",[config,data.revision]);
      return saved.rowCount?reply(200,saved.rows[0]):reply(409,{error:"Another editor saved changes. Reload the dashboard before editing again."});
    }
    if(route.pathname==="/dealer-login")req.url="/dealer-signin.html";
    if(route.pathname==="/api/inventory-status"){
      res.setHeader("Cache-Control","no-store");res.setHeader("Content-Type","application/json");
      if(req.method==="GET"){const result=await db.query("SELECT vin,status FROM inventory_status");res.end(JSON.stringify(Object.fromEntries(result.rows.map(r=>[r.vin,r.status]))));return;}
      if(!privateAdmin || req.method!=="PUT" || req.headers.origin!==base.origin || !req.headers["content-type"]?.startsWith("application/json")){res.writeHead(403).end();return;}
      let data;try{data=JSON.parse(body);}catch{}
      if(!/^([A-HJ-NPR-Z0-9]{17}|[a-zA-Z0-9_-]{1,100})$/.test(data?.vin||"")||!["sold","deleted","available"].includes(data.status)){res.writeHead(400).end();return;}
      const result=await worker.changeInventoryStatus(db,data.vin,data.status);
      res.writeHead(result.status,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(result.data));return;
    }
    const publicDealer=tenant && !prefix && ["GET","HEAD"].includes(req.method);
    const demoBrowse=base.hostname==="demo.autodealership.si" && ["GET","HEAD"].includes(req.method);
    const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const origin=publicDealer?"https://"+(tenant.verified_domain || tenant.slug+".autodealership.si"):demoBrowse?"https://demo.autodealership.si":"";
    const available=" FROM client_cars c WHERE NOT EXISTS (SELECT 1 FROM inventory_status s WHERE s.vin=c.vin)";
    let publicLocation,publicName,seo,page,vehicleFacts,storefront="classic",showCash=true,showAlternatives=true,unavailableTitle="",relatedHtml="",sitePages=[],pageTools="",assetUrl=req.url;
    if(publicDealer || demoBrowse){
      let displayName=tenant?.name||"Capital City CDJR";
      if(demoBrowse)res.setHeader("X-Robots-Tag","noindex");
      const registry=worker.DealerSitePages;
      const legacy=route.pathname==="/page.html";
      const path=route.pathname.endsWith("/")?route.pathname:route.pathname+"/";
      const template=legacy?registry.catalog.find(item=>item.key===(route.searchParams.get("page")||"about")):registry.catalog.find(item=>item.path===path);
      if(template || legacy || ["/","/index.html","/vehicle.html","/sitemap.xml"].includes(route.pathname)){
        const settings=(await db.query("SELECT settings->>'dealerName' AS name, settings->'pages' AS pages, (settings->'profile') - '{logo,logoLightBackground}'::text[] AS profile,settings->'options' AS options, settings->'financingEnabled' AS finance, settings->'options'->'aprFinancingEnabled' AS apr FROM client_profile WHERE id=1")).rows[0]||{};
        displayName=settings.name||displayName;
        publicName=displayName;
        publicLocation=worker.DealerLocation.facts(settings.profile||{});
        storefront=registry.templateKey(settings.profile?.siteTemplate);
        showCash=settings.options?.cash!==false && settings.options?.pricing!==false;
        showAlternatives=settings.options?.relatedVehicles!==false;
        sitePages=registry.list(settings,!!tenant,settings.finance!=="false" && settings.apr!==false).filter(item=>item.enabled);
      }
      if(template || legacy){
        page=sitePages.find(item=>item.key===template?.key);
        if(!page){res.writeHead(404,{"Content-Type":"text/plain","X-Robots-Tag":"noindex","Cache-Control":"no-store"}).end("Page unavailable");return;}
        if(legacy || page.path!==route.pathname){
          const params=new URLSearchParams(route.search);params.delete("page");
          res.writeHead(301,{Location:page.path+(params.size?"?"+params:""),"Cache-Control":"no-cache"}).end();return;
        }
        assetUrl="/page.html";
        seo={title:page.title+" | "+displayName,description:(page.body||page.blocks?.[0]?.text||page.title).slice(0,240),path:page.path};
        const filter=registry.inventoryFilters[page.key];
        if(filter){
          assetUrl="/index.html";
          const rows=await db.query("SELECT vin,body->>'stock' AS stock,body->>'year' AS year,body->>'make' AS make,body->>'model' AS model,body->>'trim' AS trim,body->>'condition' AS condition,COALESCE(((SELECT (offer->>'cash')::numeric/100 FROM bhph_offers WHERE vehicle=c.vin))::text,body->>'price') AS price,body->>'status' AS status,body->>'fuel' AS fuel"+available+" ORDER BY "+(tenant?"vin":"position"));
          const words=(route.searchParams.get("search")||"").trim().toLowerCase().split(/\s+/).filter(Boolean);
          const matches=rows.rows.filter(car=>filter(car) && words.every(w=>[car.year,car.make,car.model,car.trim,car.vin,car.stock].join(" ").toLowerCase().includes(w)));
          const number=Number(route.searchParams.get("p")||1),last=Math.max(1,Math.ceil(matches.length/24));
          if(!Number.isSafeInteger(number)||number<1||number>last){res.writeHead(404,{"X-Robots-Tag":"noindex"}).end("Page unavailable");return;}
          if(number>1)seo.path+="?p="+number;
          if(words.length)res.setHeader("X-Robots-Tag","noindex,follow");
          const next=new URLSearchParams(route.search);next.set("p",String(number+1));
          pageTools='<p>'+matches.length+' vehicles</p><ul>'+matches.slice((number-1)*24,number*24).map(car=>'<li><a href="/vehicle.html?stock='+encodeURIComponent(car.vin)+'">'+esc([car.year,car.make,car.model,car.trim].filter(Boolean).join(" "))+'</a></li>').join("")+'</ul>'+(number<last?'<a href="'+esc(page.path+"?"+next)+'">Next page</a>':"");
        }
      }
      if(route.pathname==="/robots.txt"){
        res.writeHead(200,{"Content-Type":"text/plain"}).end("User-agent: *\nDisallow: /dealer\nDisallow: /api/\nSitemap: "+origin+"/sitemap.xml\n");return;
      }
      if(route.pathname==="/sitemap.xml"){
        const cars=await db.query("SELECT vin"+available+" ORDER BY vin");
        const urls=["/",...sitePages.map(page=>page.path),...cars.rows.map(c=>"/vehicle.html?stock="+encodeURIComponent(c.vin))];
        res.writeHead(200,{"Content-Type":"application/xml"}).end('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+urls.map(p=>"<url><loc>"+esc(origin+p)+"</loc></url>").join("")+"</urlset>");return;
      }
      if(["/","/index.html"].includes(route.pathname)){
        seo={title:displayName+" | Vehicle Inventory",description:"Browse available vehicles at "+displayName+", explore vehicle details and schedule a test drive.",path:"/"};
      }else if(route.pathname==="/vehicle.html"){
        const vin=route.searchParams.get("stock")||"";
        const car=(await db.query("SELECT body->>'year' AS year, body->>'make' AS make, body->>'model' AS model, body->>'trim' AS trim, body->>'stock' AS stock, body->>'body' AS body, body->>'fuel' AS fuel, body->>'transmission' AS transmission,body->>'color' AS color,body->>'miles' AS miles,body->>'image' AS image,body->>'imageType' AS image_type,COALESCE((SELECT (offer->>'cash')::numeric/100 FROM bhph_offers WHERE vehicle=c.vin AND $2),CASE WHEN body->>'price' ~ '^[0-9]+([.][0-9]+)?$' THEN (body->>'price')::numeric END)::text AS price"+available+" AND c.vin=$1",[vin,!tenant||!!tenant.bhph])).rows[0];
        let reference=car;
        if(car){
          const label=[car.year,car.make,car.model,car.trim].filter(Boolean).join(" ")||vin;
          vehicleFacts={label,vin,car};
          seo={title:label+" | "+displayName,description:"View the "+label+" at "+displayName+". VIN "+vin+". Explore its features and request a test drive.",path:"/vehicle.html?stock="+encodeURIComponent(vin)};
        }else{
          reference=(await db.query("SELECT c.body->>'make' AS make,c.body->>'model' AS model,c.body->>'body' AS body FROM inventory_status s JOIN client_cars c USING(vin) WHERE s.vin=$1 AND s.status='sold'",[vin])).rows[0];
          unavailableTitle=reference?"This vehicle has sold":"Vehicle unavailable";
          res.setHeader("X-Robots-Tag","noindex, follow");
          if(req.method==="HEAD"){res.writeHead(404,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}).end();return;}
          assetUrl="/page.html";
          seo={title:unavailableTitle+" | "+displayName,description:"Browse current inventory at "+displayName+"."};
        }
        if(showAlternatives && req.method==="GET"){
          const cars=await worker.vehicleAlternatives(db,{vin,car:reference,showCash,useDealerCash:!tenant||!!tenant.bhph});
          relatedHtml=worker.alternativesMarkup(cars,{esc,origin,inventoryPath:sitePages.find(p=>p.key==="all-inventory")?.path||"/#inventory",unavailable:!!unavailableTitle});
        }
      }
    }
    if(!seo)res.setHeader("X-Robots-Tag","noindex");
    const response=await worker.default.fetch(new Request(new URL(assetUrl,base),{method:req.method,headers,body}),{BUCKET:bucket,privateAdmin,canReviewPages:!!managesUsers||clerkRole==="org:admin",offerSnapshot,visitByConfirmation,visitByNote,clientHasVin:async vin=>(await db.query("SELECT 1 FROM client_cars WHERE vin=$1",[vin])).rowCount>0});
    if((tenant || (demoBrowse && seo)) && /html|javascript/.test(response.headers.get("content-type")||"") && req.method==="GET"){
      let content=await response.text();
      if(!clerkOrg && ["/dealer-login","/dealer-signin.html"].includes(route.pathname))content=content.replace("</main>",platformSignIn(tenant.slug)+"</main>");
      if((clerkRole || platformStaff || tenantDesk) && response.headers.get("content-type").includes("html") && ["/dealer","/dealer.html"].includes(route.pathname))content=content.replace("</head>",clerkScript+'<script>window.dealerClerkReady=Clerk.load({ui:{ClerkUI:window.__internal_ClerkUICtor}});window.dealerClerkReady.catch(()=>{});</script></head>');
      if(prefix)content=content.replace(/(["'`])\/(?!\/)(?=(?:api\/|dealer-login|bhph\.|banner|inventory|index\.html))/g,"$1"+prefix+"/");
      if(tenant && response.headers.get("content-type").includes("html"))content=content.replaceAll("Capital City CDJR",tenant.name.replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x])));
      if(unavailableTitle){
        const inventory=sitePages.find(p=>p.key==="all-inventory")?.path||"/#inventory";
        const sales=publicLocation?.teams.find(team=>team.key==="sales" && team.phone);
        const recovery='<main id="vehicle-page" data-unavailable-listing><section class="listing-return"><h1>'+esc(unavailableTitle)+'</h1><p>Explore the current inventory at '+esc(publicName)+'.</p><a class="return-inventory" href="'+esc(inventory)+'">Browse inventory</a>'+
          (sales?'<a class="return-sales" href="'+esc(sales.phone)+'">Call sales</a>':'')+'</section>'+relatedHtml+'</main>';
        content=content.replace(/<main class="info-page"[\s\S]*?<\/main>/,()=>recovery)
          .replace('<script src="page.js"></script>','<script src="bhph.js"></script>')
          .replace("</head>",'<link rel="stylesheet" href="vehicle.css"><link rel="stylesheet" href="vehicle-alternatives.css"></head>')
          .replace(/<b id="brandname">[^<]*<\/b>/,()=>'<b id="brandname">'+esc(publicName)+'</b>');
      }
      let publishedOfferHtml="";
      if(vehicleFacts || page?.group==="Specials"){
        const offers=await worker.websiteOffers(db,!!tenant);
        const kind=vehicleFacts?"vehicle":"page",key=vehicleFacts?.vin||page.key;
        const slot='<div id="website-offers"></div>';
        publishedOfferHtml=worker.WebsiteOffers.markup(offers,kind,key);
        content=content.replace(slot,()=>'<div id="website-offers">'+publishedOfferHtml+'</div>');
      }
      if(vehicleFacts){
        const {label,vin,car}=vehicleFacts;
        const facts=[["VIN",vin],["Stock number",car.stock],["Body style",car.body],["Fuel",car.fuel],["Transmission",car.transmission],["Exterior color",car.color],["Mileage",car.miles!=null?car.miles+" mi":null],["Cash price",showCash && Number(car.price)>0?Number(car.price).toLocaleString("en-US",{style:"currency",currency:"USD"}):null]].filter(([,value])=>value);
        const inventory=sitePages.find(p=>p.key==="all-inventory");
        const crumbs=[{name:publicName||"Showroom",path:"/"},...(inventory?[{name:inventory.title,path:inventory.path}]:[]),{name:label,path:seo.path}];
        const trail='<nav id="vehicle-trail" aria-label="Breadcrumb">'+crumbs.map((c,i)=>i===crumbs.length-1?'<span aria-current="page">'+esc(c.name)+'</span>':'<a '+(i===crumbs.length-2?'id="back" ':'')+'href="'+esc(c.path)+'">'+esc(c.name)+'</a>').join("")+'</nav>';
        const trailData={"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:crumbs.map((c,i)=>({"@type":"ListItem",position:i+1,name:c.name,item:origin+c.path}))};
        content=content.replace(/<nav id="vehicle-trail"[^>]*>[\s\S]*?<\/nav>/,()=>trail);
        content=content.replace('<div id="related-vehicle-slot"></div>',()=>relatedHtml);
        const photo=worker.publicVehiclePhoto(car.image,origin);
        const initial=photo?'<img class="initial-photo" src="'+esc(photo)+'" alt="'+esc(label)+'" fetchpriority="high">'+(car.image_type==="stock"?'<small>Representative manufacturer photo</small>':''):'';
        const summary='<section class="page-section" id="vehicle-facts"><h1>'+esc(label)+'</h1>'+initial+publishedOfferHtml+'<dl class="overview-grid">'+facts.map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(value)+'</dd></div>').join("")+'</dl></section>';
        const data={"@context":"https://schema.org","@type":"Vehicle",name:label,url:origin+seo.path,vehicleIdentificationNumber:vin};
        for(const [key,value] of Object.entries({model:car.model,vehicleModelDate:car.year,sku:car.stock,bodyType:car.body,fuelType:car.fuel,vehicleTransmission:car.transmission})){
          if(value)data[key]=value;
        }
        if(showCash && Number(car.price)>0)data.offers={"@type":"Offer",price:Number(car.price).toFixed(2),priceCurrency:"USD",url:origin+seo.path};
        if(photo && car.image_type!=="stock")data.image=photo;
        if(car.make)data.brand={"@type":"Brand",name:car.make};
        content=content.replace('<div id="listing" hidden>',()=>summary+'<div id="listing" hidden>').replace("</head>",()=>'<script type="application/ld+json">'+JSON.stringify(data).replaceAll("<","\\u003c")+'</script><script type="application/ld+json">'+JSON.stringify(trailData).replaceAll("<","\\u003c")+'</script></head>');
      }
      if(seo?.path==="/" && req.method==="GET"){
        const cars=(await db.query("SELECT vin,body->>'year' AS year,body->>'make' AS make,body->>'model' AS model,body->>'stock' AS stock,body->>'image' AS image"+available+" ORDER BY vin LIMIT 24")).rows;
        const cards=cars.map(car=>{
          const title=[car.year,car.make,car.model].filter(Boolean).join(" ");
          const photo=/^(https:\/\/|assets\/)/i.test(car.image||"")?'<img loading="lazy" src="'+esc(car.image)+'" alt="">':"";
          return '<article class="card"><a class="carlink" href="vehicle.html?stock='+encodeURIComponent(car.vin)+'">'+photo+'<div class="cardinfo"><h4>'+esc(title)+'</h4><div class="card-identifiers">Stock # '+esc(car.stock||"Unavailable")+' &middot; VIN '+esc(car.vin)+'</div></div></a></article>';
        }).join("");
        content=content.replace('<div class="cards" id="cards"></div>',()=>'<div class="cards" id="cards">'+(cards||'<p>No vehicles currently listed.</p>')+'</div>');
      }
      if(page && assetUrl==="/index.html"){
        content=content.replace("<head>",'<head><base href="/">').replace("<body>",()=>'<body data-inventory-page="'+esc(page.key)+'">')
          .replace('href="#dealer-contact"',()=> 'href="'+esc(page.path)+'#dealer-contact"')
          .replace('href="#top"','href="/"').replace('<h2>Explore inventory<span>.</span></h2>',()=>'<h1 class="inventory-page-title">'+esc(page.title)+'</h1><p class="inventory-page-intro">'+esc(page.body)+'</p>'+(page.url?'<a href="'+esc(page.url)+'">More from the dealership</a>':""))
          .replace('<div class="cards" id="cards"></div>',()=>'<div class="cards" id="cards">'+pageTools+'</div>');
        if(page.blocks?.length)content=content.replace("</main>",()=>'<div class="page-blocks inventory-page-blocks">'+worker.DealerSitePages.blockMarkup(page.blocks)+'</div></main>');
      }else if(page){
        content=content.replace("<head>",'<head><base href="/">').replace('href="#dealer-contact"',()=> 'href="'+esc(page.path)+'#dealer-contact"')
          .replace('<h1 id="heading"></h1>',()=>'<h1 id="heading">'+esc(page.title)+'</h1>')
          .replace('<p id="intro"></p>',()=>'<p id="intro">'+esc(page.body)+'</p>')
          .replace('<div id="page-blocks" class="page-blocks"></div>',()=>'<div id="page-blocks" class="page-blocks">'+worker.DealerSitePages.blockMarkup(page.blocks)+'</div>')
          .replace('<div id="tools"></div>',()=>'<div id="tools">'+pageTools+'</div>');
      }
      if(seo && publicLocation){
        const dedicated=["contact","directions"].includes(page?.key);
        const card=worker.DealerLocation.card(publicLocation,dedicated);
        const sales=publicLocation.teams.find(team=>team.key==="sales" && team.phone);
        if(sales)content=content.replace("</header>",()=>'<a class="header-sales-phone" aria-label="'+esc("Call sales at "+sales.number)+'" href="'+esc(sales.phone)+'">'+esc(sales.number)+'</a></header>');
        const fullFooter=card && !dedicated ? '<h2>Contact '+esc(publicName)+'</h2>'+card : "";
        content=content.replace(/<footer id="dealer-contact"[^>]* hidden><\/footer>/,()=>'<footer id="dealer-contact" data-server-location aria-label="Dealership contact information"'+(fullFooter?"":" hidden")+'>'+fullFooter+'</footer>');
        if(dedicated)content=content.replace('<div id="page-location"></div>',()=>'<div id="page-location">'+card+'</div>');
        if(card){
          const target=(page?.path||"")+(dedicated?"#page-location":"#dealer-contact");
          content=content.replace(/data-contact-nav href="[^"]*" hidden/,()=>'data-contact-nav href="'+esc(target)+'"');
        }
        if(seo.path==="/" || dedicated){
          const data=worker.DealerLocation.schema(publicLocation,publicName,origin);
          if(data)content=content.replace("</head>",()=>'<script type="application/ld+json">'+JSON.stringify(data).replaceAll("<","\\u003c")+'</script></head>');
        }
      }
      if(seo && storefront!=="classic"){
        content=content.replace(/<body(?=[\s>])/i,()=>'<body data-store-template="'+storefront+'"');
        if(seo.path==="/"){
          const template=worker.DealerSitePages.templates[storefront];
          const links=template.links.map(key=>sitePages.find(p=>p.key===key)).filter(Boolean).map(p=>'<a href="'+esc(p.path)+'"><strong>'+esc(p.title)+'</strong></a>').join("");
          if(links)content=content.replace('class="dealer-template" hidden','class="dealer-template"').replace('<h2 id="template-title"></h2>',()=>'<h2 id="template-title">'+esc(storefront==="bhph"?"Browse available vehicles":template.heading)+'</h2>').replace('<nav class="template-links" aria-label="Shop this dealership"></nav>',()=>'<nav class="template-links" aria-label="Shop this dealership">'+links+'</nav>');
        }
      }
      if(seo && sitePages.length){
        const groups=[...new Set(sitePages.map(p=>p.group))];
        const links=groups.map(g=>'<section><h3>'+esc(g)+'</h3><ul>'+sitePages.filter(p=>p.group===g).map(p=>'<li><a href="'+esc(p.path)+'">'+esc(p.title)+'</a></li>').join("")+'</ul></section>').join("");
        content=content.replace('<footer aria-label="Dealer access"',()=>'<footer id="dealer-page-links"><nav aria-label="Dealership pages"><div class="dealer-page-groups">'+links+'</div></nav></footer><footer aria-label="Dealer access"');
      }
      if(seo)content=content.replace(/<title>.*?<[/]title>/i,()=>"<title>"+esc(seo.title)+"</title>").replace("</head>",()=>'<meta name="description" content="'+esc(seo.description)+'">'+(seo.path?'<link rel="canonical" href="'+esc(origin+seo.path)+'">':'')+'</head>');
      res.writeHead(unavailableTitle?404:response.status,{"Content-Type":response.headers.get("content-type"),"Cache-Control":"no-store"}).end(content);return;
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(req.method==="HEAD"||!response.body)res.end();
    else Readable.fromWeb(response.body).on("error",()=>res.destroy()).pipe(res);
    });
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
}).listen(Number(process.env.PORT||8184),process.env.BIND_ADDRESS||"127.0.0.1");
