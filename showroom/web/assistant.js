(() => {
  "use strict";
  if (window.parent !== window && window.parent.location.origin === location.origin && window.parent.document.querySelector("#showroom-concierge")) { window.addEventListener("open-assistant",()=>parent.dispatchEvent(new Event("open-assistant"))); return; }
  const agentId = "agent_7301m87be6t1fasvq15wzgg7wd3g";
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "assistant.css";
  document.head.append(style);
  const panel = document.createElement("section");
  panel.id = "showroom-concierge";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Showroom assistant");
  panel.innerHTML = '<header><div><small>PERSONAL SHOPPER</small><h2>Showroom concierge</h2></div><button type="button" class="ac-close" aria-label="Minimize concierge">Minimize</button></header><div class="ac-log" role="log" aria-live="polite"></div><div class="ac-suggestions"><button type="button">SUVs under $30k</button><button type="button">Show all cars</button></div><form class="ac-form"><input aria-label="Ask about inventory" placeholder="Ask about the inventory…" maxlength="300" required><button aria-label="Send message">Send Message</button></form><footer><button type="button" class="ac-voice">Start Voice Chat</button><span class="ac-status" role="status">Voice by ElevenLabs</span></footer>';
  document.body.append(panel);
  const log = panel.querySelector(".ac-log");
  const field = panel.querySelector("input");
  const voice = panel.querySelector(".ac-voice");
  const status = panel.querySelector(".ac-status");
  let sdkLoad, session, connecting = false, canceled = false, opener, last = [];
  const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-‐‑]/g," ");
  const title = car => [car.year,car.make,car.model].join(" ");
  const money = value => value == null || String(value).trim()==="" || !Number.isFinite(Number(value)) ? "Contact dealer for price" : Number(value).toLocaleString("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0});
  function addLine(content, kind = "reply") {
    const entry = document.createElement("div");
    entry.className = "ac-line " + kind;
    entry.textContent = content;
    log.append(entry); messages.push({content,kind}); saveChat();
    log.scrollTop = log.scrollHeight;
    return entry;
  }
  const launcher=document.createElement("button");
  launcher.id="concierge-launcher";
  launcher.textContent="Dealer Concierge";
  launcher.setAttribute("aria-controls",panel.id);
  launcher.setAttribute("aria-expanded","false");
  launcher.onclick=open;
  document.body.append(launcher);
  const invite=document.createElement("aside");
  invite.id="concierge-invite";
  invite.hidden=true;
  invite.setAttribute("aria-label","Dealer Concierge invitation");
  invite.innerHTML='<button class="invite-close" type="button" aria-label="Dismiss invitation">×</button><p>Looking for a vehicle?</p><span>Talk to the Dealer Concierge about the inventory or book a test drive.</span><button type="button" class="invite-talk">Start Voice Chat</button>';
  document.body.append(invite);
  const inviteKey="dealer-concierge-invited";
  function dismissInvite(){
    invite.hidden=true;
    try{sessionStorage.setItem(inviteKey,"1");}catch{}
  }
  invite.querySelector(".invite-close").onclick=()=>{dismissInvite();launcher.focus();};
  invite.querySelector(".invite-talk").onclick=()=>{open();voice.focus();voice.click();};
  function scheduleInvite(){
    setTimeout(()=>{
      try{if(sessionStorage.getItem(inviteKey))return;}catch{}
      if(!panel.hidden || document.querySelector("dialog[open]"))return;
      invite.hidden=false;
      try{sessionStorage.setItem(inviteKey,"1");}catch{}
    },1800);
  }
  if(document.readyState==="complete")scheduleInvite();else addEventListener("load",scheduleInvite,{once:true});
  let listing;
  const initialUrl=location.href;
  const messages=[];
  function saveChat(){
    try {sessionStorage.setItem("showroom-chat",JSON.stringify({messages:messages.slice(-60),open:!panel.hidden,draft:field.value}));}catch{}
  }
  field.addEventListener("input",saveChat);
  function close() {
    panel.hidden = true;
    launcher.textContent=session || connecting ? "Voice concierge · Open" : "Dealer Concierge";
    launcher.setAttribute("aria-expanded","false");launcher.hidden=false; saveChat(); (opener?.offsetParent ? opener : launcher).focus();
  }
  function open() {
    dismissInvite();launcher.setAttribute("aria-expanded","true");
    opener = document.activeElement;
    panel.hidden = false;
    launcher.hidden=true; saveChat(); field.focus();
  }
  window.addEventListener("open-assistant",open);
  panel.querySelector(".ac-close").addEventListener("click", close);
  panel.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
  function identifiers(car){
    return [...new Set([car.id,car.stock,car.vin].filter(Boolean).map(normalize))];
  }
  function referencedCars(cars,query,allowMake=false){
    const words=normalize(query);
    const exact=cars.filter(car=>identifiers(car).some(id=>words.includes(id)));
    if(exact.length)return exact;
    const models=cars.filter(car=>car.model && words.includes(normalize(car.model)));
    if(models.length)return models;
    if(allowMake)return cars.filter(car=>car.make && words.includes(normalize(car.make)));
    return [];
  }
  const indexedCars=new WeakMap();
  function searchText(car){
    if(!indexedCars.has(car)){
      const words=[title(car),car.id,car.stock,car.vin,car.trim,car.body,car.color,car.interior,car.fuel,car.transmission,car.drivetrain,car.engine,car.condition,car.location,car.status,...(car.packages || []),...(car.features || [])];
      indexedCars.set(car,normalize(words.join(" ")));
    }
    return indexedCars.get(car);
  }
  function inventorySearch(input) {
    const cars = window.Store.cars();
    let words = normalize(input).replace(/\$/g,"").replace(/,/g,"").replace(/\b(suv|truck|sedan|coupe|wagon|convertible|van|hatchback)s\b/g,"$1");
    const limits = [];
    const conditions=/\b(certified(?: used| pre owned)?|new|used|pre owned)\b/.exec(words);
    if(conditions){
      const category=conditions[1];
      limits.push(car=>{
        const condition=normalize(car.condition);
        if(category.startsWith("certified"))return condition.includes("certified");
        if(category==="new")return condition==="new";
        return ["used","pre owned","certified"].some(v=>condition.includes(v));
      });
      words=words.replace(conditions[0]," ");
    }
    const monthly = /(?:per month|a month|monthly|\/mo\b)/.test(words);
    const mode = /\blease\b/.test(words) ? "lease" : "finance";
    if (monthly && (Store.settings().options?.[mode] === false || Store.settings().options?.payment === false)) return [];
    words = words.replace(/(?:per month|a month|monthly|\/mo\b|\bfinance\b|\blease\b|\bpayments?\b)/g, " ");
    words = words.replace(/\b(under|below|less than|up to|at most|over|above|more than)\s*(\d+(?:\.\d+)?)\s*(k|thousand)?\s*(miles?|mi\b)?/g, (_, op, amount, scale, unit) => {
      const value = Number(amount) * (scale ? 1000 : 1);
      limits.push(car => {
        const valueForCar = !unit && monthly ? window.Retail?.amount(car, mode) : car[unit ? "miles" : "price"];
        if (valueForCar == null || String(valueForCar).trim()==="" || !Number.isFinite(Number(valueForCar))) return false;
        const n = Number(valueForCar);
        return ["over","above","more than"].includes(op) ? n>value : ["up to","at most"].includes(op) ? n<=value : n<value;
      });
      return " ";
    });
    const stop = new Set("a an all any and are at available browse by can car cars cost currently do find for from get have i in inventory is like list looking lot me my of on only please price priced see show showroom stock that the there to under vehicle vehicles want what which with you your anything something less than".split(" ").concat(["vin","number","here","dealership"]));
    const terms = words.split(/[^a-z0-9]+/).filter(word => word && !stop.has(word));
    return cars.filter(car => {
      const hay = searchText(car);
      return limits.every(test => test(car)) && terms.every(term => hay.includes(term));
    });
  }
  function relevant(items, query, limit) {
    const words = normalize(query).split(/[^a-z0-9]+/).filter(word => word.length>2);
    const scored = items.map((text,index)=>{
      const lower=normalize(text);
      const score=words.filter(word=>lower.includes(word)).length;
      return {text,index,score};
    });
    return scored.sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,limit).map(item=>item.text);
  }
  function search(query) {
    last = inventorySearch(query);
    window.filterCars?.(query,last.map(car => car.id));
    return last;
  }
  function currentCar(){
    const id=new URL(listing?.src || location.href).searchParams.get("stock");
    return id && Store.cars().find(c=>c.id===id || c.vin===id);
  }
  const vehicleDoc=()=>listing ? listing.contentDocument : document;
  function vehiclePrompt(car){
    if(!car)return "Welcome to the showroom. What kind of vehicle are you looking for?";
    const options=["schedule a test drive"];
    if(Store.settings().options?.payment!==false)options.push("estimate a monthly payment");
    if(Store.settings().options?.trade!==false)options.push("request a trade-in appraisal");
    return "You're looking at the "+title(car)+". Would you like to "+new Intl.ListFormat("en",{type:"disjunction"}).format(options)+"?";
  }
  function announceCar(car){
    const prompt=vehiclePrompt(car);
    addLine(prompt);
    if(session)session.sendUserMessage("Website navigation event: the shopper selected "+title(car)+", ID "+car.id+". Briefly offer the available next steps: "+prompt);
  }
  document.addEventListener("click",e=>{
    if(!session && !connecting && panel.hidden || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button!==0)return;
    const a=e.target.closest('a[href]');if(!a)return;
    const url=new URL(a.href);
    if(url.origin!==location.origin || !url.pathname.endsWith("/vehicle.html"))return;
    const car=Store.cars().find(c=>c.id===url.searchParams.get("stock"));
    if(car){e.preventDefault();openCar(car);}
  },true);
  let activeWorkflow;
  let review=null;
  function watchActions(doc){
    doc.addEventListener("click",event=>{
      const btn=event.target.closest?.("#request-drive,#vehicle-actions [data-retail]");
      if(!btn)return;
      const kind=btn.id==="request-drive"?"test_drive":({payment:"financing",trade:"trade_in"})[btn.dataset.retail];
      if(!kind)return;
      activeWorkflow=kind;review=null;
      if(session && event.isTrusted)session.sendUserMessage("Website action: shopper chose "+kind+" for "+title(currentCar())+". Help fill the form by voice. Read it first with shopper_action.");
    },true);
  }
  watchActions(document);
  async function shopperAction(args){
    const car=currentCar(),doc=vehicleDoc(),kind=args.workflow;
    if(!car || !doc || !doc.getElementById("request-drive"))return "Open the selected listing first, then retry.";
    const booking=kind==="test_drive",finance=kind==="financing";
    if(!booking && !finance && kind!=="trade_in")return "Unknown workflow.";
    const dialogSelector=booking?"#drive":".retail-dialog";
    const trigger=doc.querySelector(booking?"#request-drive":finance?'#vehicle-actions [data-retail="payment"]':'#vehicle-actions [data-retail="trade"]');
    if(!trigger || trigger.hidden)return "This action is unavailable on this listing.";
    if(activeWorkflow!==kind || !doc.querySelector(dialogSelector)?.open){
      doc.querySelectorAll("dialog[open]").forEach(d=>d.close());
      trigger.click();activeWorkflow=kind;review=null;
    }
    const dialog=doc.querySelector(dialogSelector),form=dialog?.querySelector("form");
    if(!form || form.hidden)return dialog?.innerText || "The form is unavailable.";
    const allowed=booking?["name","email","phone","slot","message"]:finance?["rate","months","down","residual"]:["name","email","phone","tradeCar","tradeMiles","condition"];
    if(booking && form.elements.slot.options.length<2){
      for(let i=0;i<30 && form.elements.slot.options.length<2;i++)await new Promise(resolve=>setTimeout(resolve,100));
    }
    for(const key of allowed){
      if(args[key]==null || args[key]==="")continue;
      const input=form.elements.namedItem(key);
      if(!input)return "That field is unavailable: "+key;
      if(key==="slot" && !Array.from(input.options).some(o=>o.value===args.slot))return "Choose a currently offered time.";
      input.value=String(args[key]);input.dispatchEvent(new Event("input",{bubbles:true}));
    }
    if(finance)return JSON.stringify({vehicle:title(car),terms:Object.fromEntries(new FormData(form)),estimate:form.querySelector("output")?.textContent,disclosure:dialog.querySelector(".retail-note")?.textContent});
    const missing=allowed.filter(key=>form.elements[key] && !form.elements[key].validity.valid);
    const details=Object.fromEntries(new FormData(form));
    const signature=JSON.stringify([car.id,kind,details]);
    if(args.submit===true){
      if(missing.length)return JSON.stringify({submitted:false,missing,instruction:"Ask only for the missing or invalid fields."});
      // The agent can deliver the chosen slot and the shopper's confirmation in the same call.
      if(!booking && review!==signature)return "Read the completed appraisal details back and ask for confirmation first.";
      if(form.querySelector("button[type=submit],button.primary")?.disabled)return "Submission is already in progress.";
      review=null;form.requestSubmit();
      for(let i=0;i<80;i++){
        await new Promise(resolve=>setTimeout(resolve,100));
        if(booking && form.hidden)return doc.getElementById("drive-status").textContent;
        if(!booking && !form.isConnected)return dialog.innerText;
        if(!form.querySelector("button")?.disabled)return (booking?doc.getElementById("drive-status"):form.querySelector('[role=status]'))?.textContent || "Review the entries and try again.";
      }
      return "Submission is pending. Check the on-screen status before reporting a result.";
    }
    review=missing.length?null:signature;
    const result={vehicle:title(car),details,missing,readyForConfirmation:!missing.length};
    if(booking){result.timezone="America/Chicago";result.times=Array.from(form.elements.slot.options).filter(o=>o.value).map(o=>[o.value,o.text]);}
    return JSON.stringify(result);
  }

  function openCar(car,book=false,push=true) {
    if(!car)return false;
    const url=new URL("vehicle.html",location.href);
    url.searchParams.set("stock",car.id);
    if(book)url.searchParams.set("book","1");
    if(!listing){
      listing=document.createElement("iframe");
      listing.id="concierge-listing"; listing.title="Vehicle listing";
      document.body.append(listing);
    }
    listing.onload=()=>{
      activeWorkflow=null;review=null;watchActions(listing.contentDocument);
      if(!book)announceCar(car);
      const back=listing.contentDocument?.getElementById("back");
      if(back)back.onclick=e=>{e.preventDefault();history.back();};
    };
    listing.src=url.href;
    if(push)history.pushState({conciergeCar:car.id,book},"",url);
    if(book || matchMedia("(max-width:650px)").matches){
      panel.hidden=true;launcher.setAttribute("aria-expanded","false");launcher.hidden=false;saveChat();
    }
    return true;
  }
  addEventListener("popstate",e=>{
    if(e.state?.conciergeCar)openCar(Store.cars().find(c=>c.id===e.state.conciergeCar),e.state.book,false);
    else {listing?.remove();listing=null;if(location.href!==initialUrl)location.reload();}
  });
  const originalShowCar=window.showCar;
  window.showCar=id=>{
    const car=Store.cars().find(c=>c.id===id);
    return session || connecting || !panel.hidden ? openCar(car) : originalShowCar ? originalShowCar(id) : openCar(car);
  };
  function list(text,cars,book=false) {
    const entry = addLine(text);
    for (const car of cars.slice(0,4)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ac-car";
      button.textContent = title(car) + " · " + money(car.price) + (car.stock ? " · "+car.stock : "");
      button.addEventListener("click", () => openCar(car,book));
      entry.append(button);
    }
    log.scrollTop = log.scrollHeight;
  }
  function handleText(input) {
    const query = input.trim();
    if(!query) return;
    addLine(query,"user");
    if (/test[ -]?drive|book an appointment|schedule a drive/i.test(query)){
      const named=referencedCars(Store.cars(),query);
      const car=named.length===1?named[0]:currentCar() || (last.length===1?last[0]:null);
      if(car){addLine("Choose a time and enter your contact details to reserve the test drive.");openCar(car,true);}
      else list("Select a vehicle to schedule your test drive.",named.length?named:last.length?last:Store.cars(),true);
      return;
    }
    if (/\b(features?|equipment|equipped|options|packages?)\b|\bdoes\b.*\bhave\b/i.test(query)) {
      const normalized = normalize(query);
      const cars = window.Store.cars();
      const named=referencedCars(cars,query,true);
      const options = named.length ? named : currentCar() ? [currentCar()] : last.length ? last : cars;
      const car = options.length === 1 ? options[0] : null;
      if (car) {
        const packages=/\bpackages?\b/i.test(query);
        const features=(packages?car.packages:car.features)||[];
        const relevant=features.filter(f=>normalized.includes(normalize(f)) || normalize(f).split(" ").some(t=>t.length>3 && normalized.includes(t)));
        const displayed=[...new Set([...relevant,...features])].slice(0,12);
        list(features.length ? title(car) + " lists " + displayed.join(", ") + "." + (features.length>displayed.length ? " Open the listing for the full list." : "") : (packages ? "No packages are listed for this vehicle." : "The dealer hasn’t listed specific equipment for this vehicle."),[car]);
      } else {
        list("Which vehicle did you have in mind? Open a listing to see its features or ask me about its model.",options);
      }
      return;
    }
    if (/\b(test[ -]?drive|callback|contact|inquir|interested|schedule|book|open|details|first one|second one)\b/i.test(query)) {
      const all = window.Store.cars(), normalized = normalize(query);
      const named=referencedCars(all,normalized);
      const index = /\bsecond\b/i.test(query) ? 1 : /\bfirst\b/i.test(query) ? 0 : -1;
      const options = named.length ? named : last.length ? last : all;
      if(options.length === 1 || (index >= 0 && options[index])) {
        openCar(options[index >= 0 ? index : 0]);
      } else {
        list("Choose a vehicle to see its details and send the dealership a request.",options);
      }
      return;
    }
    const results = search(query);
    if (!results.length) addLine("I couldn’t match that search. Try a make, model, body style, or price limit.");
    else list(results.length + (results.length === 1 ? " vehicle matches." : " vehicles match.") + " Select one for details or a test drive.", results);
  }
  panel.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    handleText(field.value);
    field.value = ""; saveChat();
  });
  panel.querySelectorAll(".ac-suggestions button").forEach(button => button.addEventListener("click", () => handleText(button.textContent)));
  async function sdk() {
    if (!sdkLoad) sdkLoad = new Promise((resolve,reject) => {
      const script = document.createElement("script");
      script.src = "vendor/elevenlabs-client.js";
      script.onload = () => resolve(window.ElevenLabsClient);
      script.onerror = () => { sdkLoad = undefined; reject(new Error("SDK could not load")); };
      document.head.append(script);
    });
    return sdkLoad;
  }
  function idle(label) {
    launcher.textContent="Dealer Concierge";session = undefined;
    connecting = false;
    voice.disabled = false;
    voice.textContent = "Start Voice Chat";
    status.textContent = label;
  }
  voice.addEventListener("click", async () => {
    if (session) { await session.endSession(); return; }
    if (connecting) return;
    connecting = true;
    canceled = false;
    voice.disabled = true;
    status.textContent = "Connecting microphone…";
    try {
      const client = await sdk();
      if(canceled) { idle("Voice by ElevenLabs"); return; }
      const connection = await client.Conversation.startSession({
        agentId, connectionType:"websocket", dynamicVariables:{showroom_greeting:vehiclePrompt(currentCar())},
        workletPaths: {
          rawAudioProcessor:"vendor/rawAudioProcessor.js",
          audioConcatProcessor:"vendor/audioConcatProcessor.js"
        },
        libsampleratePath:"vendor/libsamplerate.worklet.js",
        clientTools: {
          shopper_action:shopperAction,
          search_inventory({query}) {
            const matches = search(String(query || "all"));
            return JSON.stringify({
              count:matches.length,
              vehicles:matches.slice(0,8).map(car=>({
                id:car.id,stock:car.stock,vin:car.vin,year:car.year,make:car.make,model:car.model,trim:car.trim,
                body:car.body,price:car.price??null,miles:car.miles??null,location:car.location,condition:car.condition,
                availability:car.availability || "Confirm with dealer",observedAt:car.observedAt,
                features:relevant(car.features||[],query,12),packages:relevant(car.packages||[],query,6)
              }))
            });
          },
          open_vehicle({car_id}) {
            const car = window.Store.cars().find(item => identifiers(item).includes(normalize(car_id)));
            if (!car) return "Vehicle is no longer available.";
            openCar(car);
            return "Opened the full vehicle page. The shopper can request a test drive or confirm availability there.";
          }
        },
        onMessage: ({message,source}) => {
          if(!message)return;
          addLine(message,source==="user"?"user":"reply");
        },
        onModeChange: ({mode}) => { status.textContent = mode === "speaking" ? "Concierge speaking" : "Listening…"; },
        onDisconnect: () => idle("Voice session ended"),
        onError: () => {status.textContent = "Voice connection interrupted. Text search is available.";}
      });
      if (canceled) { await connection.endSession(); idle("Voice by ElevenLabs"); return; }
      session = connection;launcher.textContent="Voice concierge · Open";
      connecting = false;
      voice.disabled = false;
      voice.textContent = "End Voice Chat";
      status.textContent = "Voice connected";
    } catch {
      idle("Voice unavailable. Check microphone access or type below.");
    }
  });
  if(currentCar()){
    invite.querySelector("p").textContent=title(currentCar());
    invite.querySelector("span").textContent=vehiclePrompt(currentCar());
  }
  let restored;
  try {restored=JSON.parse(sessionStorage.getItem("showroom-chat"));}catch{}
  if(restored?.messages?.length){for(const m of restored.messages)addLine(m.content,m.kind);field.value=restored.draft||"";if(restored.open)open();saveChat();}
  else addLine("What would you like to drive? I can search the dealership inventory and open a test-drive request.");
})();

