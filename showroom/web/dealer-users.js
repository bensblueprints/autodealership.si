(async()=>{
  const id=s=>document.getElementById(s);
  async function api(op,data){const r=await (op==="me"?readDealerDesk:fetch)("/api/dealer-auth/"+op,data?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}:{});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
  const me=await api("me");
  const emailSetup=id("dealer-email-setup");
  emailSetup.hidden=!me.managesEmail;
  emailSetup.onclick=async()=>{
    emailSetup.disabled=true;
    try{
      const response=await fetch("api/dealer-email/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
      const data=await response.json();
      if(!response.ok)throw Error(data.error);
      location.assign(data.url);
    }catch(error){id("notice").textContent=error.message||"Could not open dealership email setup.";}
    finally{emailSetup.disabled=false;}
  };
  id("desk-login").hidden=me.signedIn;id("desk-logout").hidden=!me.signedIn;id("desk-users").hidden=!me.managesUsers;
  id("desk-logout").onclick=async()=>{await api("logout",{});if(me.clerk){await window.dealerClerkReady;await Clerk.signOut({redirectUrl:location.origin+"/dealer-login"});return}location.assign("dealer-login");};
  id("desk-users").onclick=async()=>{
    if(me.teamUrl){location.assign(me.teamUrl);return}
    const d=document.createElement("dialog");d.innerHTML='<button type="button" aria-label="Close">×</button><h2>Staff accounts</h2><p>Staff can manage this dealership’s inventory, BHPH pricing and appointments.</p><form><label>Staff email<input name="email" type="email" required></label><label>Initial password<input name="password" type="password" autocomplete="new-password" minlength="14" maxlength="128" required></label><small>Use at least 14 characters. Share the login privately.</small><button class="primary">Create staff account</button></form><p role="status"></p><div></div>';document.body.append(d);d.showModal();d.querySelector("button").onclick=()=>d.close();d.onclose=()=>d.remove();
    const status=d.querySelector("[role=status]");
    async function list(){const out=d.querySelector("div");out.replaceChildren();for(const u of await api("users")){const p=document.createElement("p");p.textContent=u.email+" · "+(u.active?"Active":"Disabled")+" ";if(u.active){const b=document.createElement("button");b.textContent="Disable access";b.onclick=async()=>{try{await api("disable",{email:u.email});await list()}catch(e){status.textContent=e.message}};p.append(b)}out.append(p)}}
    d.querySelector("form").onsubmit=async e=>{e.preventDefault();try{await api("users",Object.fromEntries(new FormData(e.target)));e.target.reset();status.textContent="Staff account created.";await list()}catch(err){status.textContent=err.message}};await list();
  };
})().catch(()=>{});
(async()=>{
  const panel=document.querySelector("#voice"),state=document.querySelector("#voice-state");
  if(!window.clientSite){state.textContent="Usage reporting is available in each client dealership’s dashboard.";return;}
  let loading=false;
  async function openVoice(){
  if(loading)return;
  loading=true;
  try{
  const response=await readDealerDesk("/api/web-voice/settings");
  if(!response.ok)throw Error();
  const config=await response.json();
  panel.innerHTML='<h2>Website voice usage</h2><label>Usage month (UTC) <input type="month"></label><p role="status"></p>';

  const month=panel.querySelector("input"),status=panel.querySelector("p");
  month.value=new Date().toISOString().slice(0,7);
  function display(d){status.textContent=d.calls+" verified calls · "+(d.seconds/60).toFixed(2)+" minutes · "+(d.terms?d.terms.minutes+" included · $"+(d.overageCents/100).toFixed(2)+" overage":"Billing terms pending");}
  display(config);
  month.onchange=async()=>{const value=month.value;try{const r=await readDealerDesk("/api/web-voice/settings?month="+encodeURIComponent(value));if(!r.ok)throw Error();const report=await r.json();if(month.value===value)display(report);}catch{if(month.value===value)status.textContent="Could not load usage for this month.";}};
  if(!config.editable)return;
  const form=document.createElement("form");
  form.innerHTML='<h3>Connect ElevenLabs agent</h3><label>Agent ID <input name="agent" required></label> <label>Included monthly minutes <input name="minutes" type="number" min="0"></label> <label>Overage cents per minute <input name="cents" type="number" min="0"></label> <button>Save voice settings</button><p>Terms apply from the current UTC calendar month.</p>';
  panel.append(form);form.elements.agent.value=config.agent||"";
  for(const field of ["minutes","cents"])form.elements[field].value=config.terms?.[field]??"";
  form.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(form));for(const field of ["minutes","cents"])data[field]=data[field]===""?null:Number(data[field]);
    try{const r=await fetch("/api/web-voice/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});if(!r.ok)throw Error((await r.json()).error||"Save failed.");location.reload()}catch(err){status.textContent=err.message}};
  }catch{loading=false;state.textContent="Could not load voice usage. Select Website Voice Usage to retry.";}
  }
  document.querySelector('[data-view="voice"]').addEventListener("click",openVoice);
})().catch(()=>{});
