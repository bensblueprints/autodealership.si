(async()=>{
  const id=s=>document.getElementById(s);
  async function api(op,data){const r=await fetch("/api/dealer-auth/"+op,data?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}:{});const result=await r.json();if(!r.ok)throw Error(result.error);return result;}
  const me=await api("me");
  id("desk-login").hidden=me.signedIn;id("desk-logout").hidden=!me.signedIn;id("desk-users").hidden=!me.managesUsers;
  id("desk-logout").onclick=async()=>{await api("logout",{});location.assign("dealer-login");};
  id("desk-users").onclick=async()=>{
    const d=document.createElement("dialog");d.innerHTML='<button type="button" aria-label="Close">×</button><h2>Staff accounts</h2><p>Staff can manage this dealership’s inventory, BHPH pricing and appointments.</p><form><label>Staff email<input name="email" type="email" required></label><label>Initial password<input name="password" type="password" autocomplete="new-password" minlength="14" maxlength="128" required></label><small>Use at least 14 characters. Share the login privately.</small><button class="primary">Create staff account</button></form><p role="status"></p><div></div>';document.body.append(d);d.showModal();d.querySelector("button").onclick=()=>d.close();d.onclose=()=>d.remove();
    const status=d.querySelector("[role=status]");
    async function list(){const out=d.querySelector("div");out.replaceChildren();for(const u of await api("users")){const p=document.createElement("p");p.textContent=u.email+" · "+(u.active?"Active":"Disabled")+" ";if(u.active){const b=document.createElement("button");b.textContent="Disable access";b.onclick=async()=>{try{await api("disable",{email:u.email});await list()}catch(e){status.textContent=e.message}};p.append(b)}out.append(p)}}
    d.querySelector("form").onsubmit=async e=>{e.preventDefault();try{await api("users",Object.fromEntries(new FormData(e.target)));e.target.reset();status.textContent="Staff account created.";await list()}catch(err){status.textContent=err.message}};await list();
  };
})().catch(()=>{});
