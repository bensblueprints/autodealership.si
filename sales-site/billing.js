const by=id=>document.getElementById(id),join=by("join"),login=by("login"),prefs=by("prefs");
const names={phone_widget:"Phone Voice + Web Chat Widget",chat:"Web Chat Widget",web_voice:"Dealer Chat + Web Voice",phone_only:"Phone Voice Receptionist",omnichannel:"Phone + Website Concierge",website:"Showroom",starter:"Voice Starter",concierge:"Sales Concierge",phone:"Showroom + Phone"},prices={phone_widget:1099,chat:299,web_voice:499,phone_only:799,omnichannel:1099,website:499,starter:798,concierge:1499,phone:2499};
const usd=value=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value);
const prefMarkup='<fieldset><legend>Voice billing</legend><label>Refill size<select name="refill"><option value="100">$100 at a $20 balance</option><option value="500">$500 at a $100 balance</option></select></label><label>Maximum automatic card charges per billing cycle ($)<input name="cap" type="number" min="0" max="100000" step="1" value="300" required></label><label class="check"><input type="checkbox" name="auto">I authorize automatic Whop card charges at the selected refill amount and cycle limit.</label><small>The first refill can occur with five included minutes left. Subsequent refills trigger below the selected balance. Turn this off for manual purchases.</small></fieldset>';
by("joinPrefs").innerHTML=prefMarkup;by("accountPrefs").innerHTML=prefMarkup;
let account;
async function api(path,body){const res=await fetch("/billing/"+path,body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error||"Please try again.");return data;}
function settings(form){return {refill:Number(form.elements.refill.value),cap:Number(form.elements.cap.value),auto:form.elements.auto.checked};}
function price(){const voice=!["website","chat"].includes(join.elements.plan.value);by("joinPrefs").hidden=!voice;if(!voice)join.elements.auto.checked=false;const monthly=prices[join.elements.plan.value]+(join.elements.marketing.checked?2500:0);by("total").textContent="First payment "+usd(monthly+997)+" (includes $997 one-time onboarding). Then "+usd(monthly)+" per month, before tax.";}
function guarded(fn){return async event=>{event.preventDefault();const btn=event.submitter||event.currentTarget;btn.disabled=true;by("status").textContent="";try{await fn();}catch(err){by("status").textContent=err.message;}finally{btn.disabled=false;}};}
function action(label,route,body){const btn=document.createElement("button");btn.className="primary";btn.textContent=label;btn.onclick=guarded(async()=>{const {url}=await api(route,body);location.assign(url);});by("accountButtons").append(btn);}
async function render(){
 account=await api("account");const signed=account.signedIn;
 by("account").hidden=!signed;join.hidden=signed;login.hidden=true;by("switch").hidden=signed;
 by("availability").textContent=account.checkoutAvailable?"":"Enrollment is open. Payment activation is pending. You can register without a charge.";
 if(!signed){by("title").textContent="Set up your showroom.";price();return;}
 by("title").textContent=account.name;by("summary").textContent=names[account.plan]+" · "+usd(prices[account.plan]+2500*account.marketing)+"/month · "+(account.status==="signup"?"Awaiting checkout · first payment "+usd(prices[account.plan]+2500*account.marketing+997)+" including $997 onboarding, before tax":account.status)+". Voice usage: "+(account.used/60).toFixed(1)+" minutes. Included: "+account.included+". Purchased balance: "+usd(account.balance/6000)+".";
 by("accountButtons").replaceChildren();
 if(account.checkoutAvailable && account.status==="signup")action("Continue to Whop checkout","checkout",{});
 if(account.status==="active" && !["website","chat"].includes(account.plan)){action(account.cardSaved?"Update saved card":"Save card with Whop","save-card",{});action("Buy $100 credit","buy",{amount:100});action("Buy $500 credit","buy",{amount:500});}
 prefs.hidden=["website","chat"].includes(account.plan);prefs.elements.refill.value=account.refill;prefs.elements.cap.value=account.cap;prefs.elements.auto.checked=!!account.auto;
 by("receipts").replaceChildren();for(const row of account.receipts){const li=document.createElement("li");li.textContent=new Date(row.received*1000).toLocaleDateString()+" · "+row.kind+" · "+usd(row.amount);by("receipts").append(li);}
 if(!account.receipts.length)by("receipts").textContent="No payments received.";
}
const requested=new URLSearchParams(location.search).get("plan");if(Object.hasOwn(names,requested))join.elements.plan.value=requested;
if(new URLSearchParams(location.search).get("marketing")==="1")join.elements.marketing.checked=true;
join.onchange=price;
join.onsubmit=guarded(async()=>{await api("signup",{...Object.fromEntries(new FormData(join)),...settings(join),marketing:join.elements.marketing.checked});join.reset();await render();});
login.onsubmit=guarded(async()=>{await api("login",Object.fromEntries(new FormData(login)));login.reset();await render();});
prefs.onsubmit=guarded(async()=>{await api("settings",settings(prefs));await render();by("status").textContent="Billing preferences saved.";});
by("switch").onclick=()=>{login.hidden=!login.hidden;join.hidden=!login.hidden;by("switch").textContent=login.hidden?"Already registered? Sign in":"Create a dealer account";by("title").textContent=login.hidden?"Set up your showroom.":"Dealer sign in";};
by("logout").onclick=guarded(async()=>{await api("logout",{});await render();});
render().catch(()=>{by("status").textContent="Billing is temporarily unavailable.";});
