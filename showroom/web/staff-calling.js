const StaffCalling=(()=>{
  const bar=document.getElementById("staff-call-bar"),status=document.getElementById("staff-call-status"),end=document.getElementById("staff-call-end");
  let active=null,library;
  function loadSdk(){
    if(window.Twilio?.Device)return Promise.resolve();
    if(!library)library=new Promise((ok,fail)=>{
      const script=document.createElement("script");script.src="/assets/twilio-voice-2.19.0.min.js";
      script.onload=()=>ok();script.onerror=()=>{library=null;script.remove();fail(Error("Could not load the phone. Try again."));};document.head.append(script);
    });return library;
  }
  function finish(session,text){
    if(active!==session)return;
    active=null;session.device?.destroy();status.textContent=text;end.textContent="Dismiss";
    end.onclick=()=>{bar.hidden=true;};
    if(session.connected)session.refresh();
  }
  async function start(id,name,refresh){
    bar.hidden=false;if(active){bar.scrollIntoView({block:"nearest"});return;}
    const session={refresh};active=session;status.textContent="Starting call to "+name+"…";end.textContent="Cancel";
    end.onclick=()=>{session.call?.disconnect();finish(session,"Call ended.");};
    try{
      await loadSdk();if(active!==session)return;
      const request=crypto.randomUUID();
      const response=await fetch("/api/conversations/call",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,request})});
      const data=await response.json();if(!response.ok)throw Error(data.error||"Could not start this call.");if(active!==session)return;
      const device=new Twilio.Device(data.token);session.device=device;
      device.on("error",()=>finish(session,"Voice connection failed. Check your microphone and connection."));
      status.textContent="Calling "+name+" from "+data.from+"…";
      const call=await device.connect({params:{CallRequest:request}});
      if(active!==session){call.disconnect();return;}session.call=call;end.textContent="End call";
      call.on("accept",()=>{session.connected=true;status.textContent="On a call with "+name;});
      call.on("error",()=>finish(session,"The call could not connect."));
      for(const event of ["disconnect","cancel","reject"])call.on(event,()=>finish(session,"Call ended."));
    }catch(e){finish(session,e.message||"Could not start the call.");}
  }
  return {start};
})();
