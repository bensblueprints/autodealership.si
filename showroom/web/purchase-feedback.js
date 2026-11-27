(async()=>{
  const get=id=>document.getElementById(id),form=document.querySelector("form"),status=get("status");
  window.addEventListener("hashchange",()=>location.reload());
  const args=new URLSearchParams(location.hash.slice(1)),token=args.get("token");
  async function call(action,body={}){
    const response=await fetch("api/purchase-feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,action,...body})});
    const result=await response.json();if(!response.ok)throw Error(result.error||"Please try again.");return result;
  }
  const stop=get("stop");
  stop.onclick=async()=>{stop.disabled=true;try{await call("stop");status.textContent="You’re unsubscribed from this dealership’s review emails.";stop.hidden=true;}catch(err){status.textContent=err.message;stop.disabled=false;}};
  try{
    if(!token)throw Error("Open the personal link in your purchase email.");
    if(args.get("unsubscribe")==="1"){stop.hidden=false;status.textContent="Confirm below to stop receiving review emails from this dealership.";return;}
    const data=await call("view");get("dealer").textContent=data.dealer;stop.hidden=false;
    if(data.link){get("google-link").href=data.link;get("google").hidden=false;}
    for(let stars=1;stars<=5;stars++){
      const l=document.createElement("label"),input=document.createElement("input");input.type="radio";input.name="stars";input.value=stars;input.required=true;
      input.setAttribute("aria-label",stars+(stars===1?" star":" stars"));l.append(input," "+stars+" ★");document.querySelector(".ratings").append(l);
    }
    form.hidden=data.submitted;status.textContent=data.submitted?"Thank you. Your private feedback has been received.":"You can leave a public review, send private feedback, or do both.";
    form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector("button");b.disabled=true;try{await call("rate",{stars:Number(new FormData(form).get("stars")),comment:get("comment").value});form.hidden=true;status.textContent="Thank you. Your private feedback has been received.";}catch(err){status.textContent=err.message;b.disabled=false;}};
  }catch(err){status.textContent=err.message;}
})();
