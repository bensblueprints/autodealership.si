import {AsyncLocalStorage} from "node:async_hooks";
import {promisify} from "node:util";
import {scrypt,randomBytes,createHash,createPublicKey,verify} from "node:crypto";
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
const pool=await bookingDatabase(),scope=new AsyncLocalStorage();
const db={async query(sql,args){
  const tenant=scope.getStore();if(!tenant)return pool.query(sql,args);
  const conn=await pool.connect();
  try{await conn.query("BEGIN");await conn.query("SET LOCAL search_path TO "+tenant.schema);const result=await conn.query(sql,args);await conn.query("COMMIT");return result;}
  catch(e){await conn.query("ROLLBACK");throw e;}finally{conn.release();}
}};
await db.query("CREATE TABLE IF NOT EXISTS homepage_banners (id integer PRIMARY KEY, revision integer NOT NULL, config jsonb NOT NULL)");
await db.query("CREATE TABLE IF NOT EXISTS bhph_offers(vehicle text PRIMARY KEY, revision integer NOT NULL, offer jsonb NOT NULL)");
const passwordHash=promisify(scrypt);
await pool.query(`CREATE TABLE IF NOT EXISTS public.dealer_users(site text NOT NULL,email text NOT NULL,salt text NOT NULL,hash text NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(site,email));
CREATE TABLE IF NOT EXISTS public.dealer_sessions(token text PRIMARY KEY,site text NOT NULL,email text NOT NULL,expires timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.dealer_login_attempts(site text NOT NULL,ip text NOT NULL,attempts integer NOT NULL,started timestamptz NOT NULL,PRIMARY KEY(site,ip))`);
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
    if(scope.getStore()){
      const row=(await db.query("SELECT settings,etag FROM client_profile WHERE id=1")).rows[0];
      return {etag:row.etag,json:async()=>row.settings};
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
    if(scope.getStore()){
      const etag=randomUUID(),r=await db.query("UPDATE client_profile SET settings=$1,etag=$2 WHERE id=1 AND etag=$3",[body,etag,options.onlyIf.etagMatches]);
      return r.rowCount?{etag}:null;
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

const clerkIssuer="https://clerk.autodealership.si";
const clerkScript='<script crossorigin="anonymous" data-clerk-publishable-key="pk_live_Y2xlcmsuYXV0b2RlYWxlcnNoaXAuc2kk" src="'+clerkIssuer+'/npm/@clerk/clerk-js@5/dist/clerk.browser.js"></script>';
let clerkKeys;
async function dealerClaim(cookie, origin, org){
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
    if((c.o?.id||c.org_id)!==org)return null;
    const role=c.o?.rol ? "org:"+c.o.rol : c.org_role;
    return ["org:admin","org:member"].includes(role)?role:null;
  }catch{return null}
}
function platformSignIn(slug){
  return '<p><a style="color:#95c9ff" href="https://autodealership.si/onboarding/clerk-login?site='+encodeURIComponent(slug)+'">Platform admin or engineer sign-in</a></p>';
}
function clerkDealerPage(org,slug){
  return `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dealer sign-in</title><style>body{background:#131721;color:white;font:16px system-ui;margin:8vh auto;padding:24px;max-width:460px}button{padding:10px}</style><h1>Dealer sign-in</h1><p id="message">Connecting to Clerk…</p>${platformSignIn(slug)}<div id="signin"></div><button hidden id="change">Switch account</button>${clerkScript}<script>
  (async()=>{await Clerk.load();if(!Clerk.session){message.textContent="Sign in with your invited work email.";Clerk.mountSignIn(signin,{routing:"hash",forceRedirectUrl:location.href,signUpForceRedirectUrl:location.href});return}
  change.hidden=false;change.onclick=()=>Clerk.signOut({redirectUrl:location.pathname});
  await Clerk.setActive({organization:${JSON.stringify(org)}});
  await Clerk.session.getToken({skipCache:true});
  const me=await fetch("api/dealer-auth/me",{cache:"no-store"}).then(r=>r.json());
  if(me.signedIn){location.replace("dealer");return}throw Error()
  })().catch(()=>{message.textContent="Could not open this dealership. Check that you accepted the invitation with this email, then try again.";});</script></html>`;
}
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
    const desk=tenant && prefix && /(?:^|; )client_desk=([a-zA-Z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie||"");
    const delegated=desk && (await pool.query("SELECT 1 FROM public.client_desk_sessions s JOIN public.client_sites t USING(slug) LEFT JOIN public.client_engineers e ON e.id=s.engineer WHERE s.token=$1 AND s.slug=$2 AND s.expires>now() AND (s.engineer IS NULL OR (e.active AND t.engineer=s.engineer))",[createHash("sha256").update(desk[1]).digest("hex"),tenant.slug])).rowCount>0;
    const site=tenant?.id||"demo";
    const currentToken=/(?:^|; )dealer_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||"")?.[1];
    const tokenHash=currentToken && createHash("sha256").update(currentToken).digest("hex");
    const clerkOrg=tenant?.clerk_org_id;
    const clerkRole=clerkOrg && !prefix && base.hostname===tenant.slug+".autodealership.si" && await dealerClaim(req.headers.cookie,base.origin,clerkOrg);
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
        if(count>(req.url==="/api/banner-editor" && privateAdmin?6500000:req.url==="/api/dealer-profile" && privateAdmin?2000000:1000000)){res.writeHead(413).end();return;}chunks.push(chunk);
      }
      body=Buffer.concat(chunks);
    }
    const route=new URL(req.url,base);
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
      if(prefix || base.hostname!==tenant.slug+".autodealership.si"){res.writeHead(302,{Location:"https://"+tenant.slug+".autodealership.si/dealer-login"}).end();return}
      res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Frame-Options":"DENY"}).end(clerkDealerPage(clerkOrg,tenant.slug));return;
    }
    if(route.pathname.startsWith("/api/dealer-auth/")){
      const op=route.pathname.split("/").pop();
      const reply=(code,data)=>res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"}).end(JSON.stringify(data));
      if(req.method==="GET" && op==="me")return reply(200,{signedIn:!!privateAdmin,managesUsers:clerkOrg?clerkRole==="org:admin":!!managesUsers,clerk:!!clerkRole,teamUrl:clerkRole==="org:admin"?"https://autodealership.si/onboarding/clerk-team":null});
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
        if(delegated)await pool.query("DELETE FROM public.client_desk_sessions WHERE token=$1",[createHash("sha256").update(desk[1]).digest("hex")]);
        res.setHeader("Set-Cookie",cookie("",0));return reply(200,{});
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
    if(tenant && ["/dealer","/dealer.html"].includes(route.pathname) && !privateAdmin){res.writeHead(302,{Location:prefix+"/dealer-login","Cache-Control":"no-store"}).end();return;}
    if(route.pathname==="/api/bhph"){
      if(tenant && !tenant.bhph){res.writeHead(req.method==="GET"?200:403,{"Content-Type":"application/json"}).end("{}");return;}
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
    if(tenant && route.pathname==="/api/client-inventory" && req.method==="PUT"){
      if(!privateAdmin || req.headers.origin!==base.origin){res.writeHead(403).end();return;}
      let car;try{car=JSON.parse(body);}catch{}
      if(!car || !/^[A-HJ-NPR-Z0-9]{17}$/.test(car.vin)|| !car.stock || !car.make || !car.model){res.writeHead(400).end();return;}
      car.id=car.vin;
      await db.query("INSERT INTO client_cars(vin,body) VALUES($1,$2) ON CONFLICT(vin) DO UPDATE SET body=excluded.body",[car.vin,JSON.stringify(car)]);
      res.writeHead(200,{"Content-Type":"application/json"}).end("{}");return;
    }
    if(tenant && route.pathname==="/assets/cdjr-inventory.js"){
      const cars=(await db.query("SELECT body FROM client_cars ORDER BY vin")).rows.map(r=>r.body);
      res.writeHead(200,{"Content-Type":"application/javascript","Cache-Control":"no-store"}).end("window.clientSite="+JSON.stringify({slug:tenant.slug,name:tenant.name,agent:tenant.agent_id,bhph:tenant.bhph})+";window.CdjrInventory="+JSON.stringify(cars)+";");return;
    }
    if(tenant && route.pathname==="/assets/cdjr-covers.js"){res.writeHead(200,{"Content-Type":"application/javascript"}).end("window.CdjrCovers={};");return;}
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
    if(route.pathname==="/dealer-login")req.url="/dealer-signin.html";
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
    const response=await worker.default.fetch(new Request(new URL(req.url,base),{method:req.method,headers,body}),{BUCKET:bucket,privateAdmin,offerSnapshot,clientHasVin:tenant?async vin=>(await db.query("SELECT 1 FROM client_cars WHERE vin=$1",[vin])).rowCount>0:null});
    if(tenant && /html|javascript/.test(response.headers.get("content-type")||"") && req.method==="GET"){
      let content=await response.text();
      if(!clerkOrg && ["/dealer-login","/dealer-signin.html"].includes(route.pathname))content=content.replace("</main>",platformSignIn(tenant.slug)+"</main>");
      if(clerkRole && response.headers.get("content-type").includes("html") && ["/dealer","/dealer.html"].includes(route.pathname))content=content.replace("</head>",clerkScript+'<script>window.dealerClerkReady=Clerk.load()</script></head>');
      if(prefix)content=content.replace(/(["'`])\/(?!\/)(?=(?:api\/|dealer-login|bhph\.|banner|inventory|index\.html))/g,"$1"+prefix+"/");
      if(response.headers.get("content-type").includes("html"))content=content.replaceAll("Capital City CDJR",tenant.name.replace(/[&<>"]/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x])));
      res.writeHead(response.status,{"Content-Type":response.headers.get("content-type"),"Cache-Control":"no-store","X-Robots-Tag":"noindex"}).end(content);return;
    }
    res.writeHead(response.status,Object.fromEntries(response.headers));
    if(req.method==="HEAD"||!response.body)res.end();
    else Readable.fromWeb(response.body).on("error",()=>res.destroy()).pipe(res);
    });
  }catch{if(!res.headersSent)res.writeHead(500);res.end();}
}).listen(Number(process.env.PORT||8184),process.env.BIND_ADDRESS||"127.0.0.1");
