(()=>{
  const get=id=>document.getElementById(id),controls=get("banner-controls"),msg=get("banner-status"),upload=get("banner-upload");
  let slides=[],revision=0,loaded=false;
  function render(){
    const list=get("banner-list");list.replaceChildren();
    slides.forEach((slide,index)=>{
      const row=document.createElement("div");row.className="banner-row";const img=new Image();img.src=slide.image;img.alt="Slide "+(index+1)+" preview";row.append(img);
      for(const [field,title,limit] of [["alt","Offer description (required)",300],["link","Destination link (optional)",2048]]){
        const label=document.createElement("label"),input=document.createElement("input");label.textContent=title;input.value=slide[field];input.maxLength=limit;input.oninput=()=>slide[field]=input.value.trim();label.append(input);row.append(label);
      }
      for(const [label,step] of [["Move up",-1],["Move down",1],["Remove",0]]){
        const b=document.createElement("button");b.textContent=label;b.disabled=step!==0 && !slides[index+step];b.onclick=()=>{slides.splice(index,1);if(step)slides.splice(index+step,0,slide);if(!slides.length)get("banner-enabled").checked=false;render();};row.append(b);
      }
      list.append(row);
    });upload.disabled=slides.length>=6;
  }
  document.querySelector('[data-view="banners"]').addEventListener("click",async()=>{
    if(loaded)return;
    try{const res=await fetch("/api/banner-editor");if(!res.ok)throw Error("Use Dealer sign in to manage banners.");const data=await res.json();slides=data.slides;revision=data.revision;get("banner-enabled").checked=data.enabled;loaded=true;controls.disabled=false;render();}catch(e){msg.textContent=e.message;}
  });
  upload.onchange=async()=>{
    const file=upload.files[0];if(!file)return;controls.disabled=true;
    try{
      if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>15000000)throw Error("Choose a JPG, PNG or WebP under 15 MB.");
      const bitmap=await createImageBitmap(file),canvas=document.createElement("canvas"),scale=Math.min(1,1800/bitmap.width,1000/bitmap.height);
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      let image=canvas.toDataURL("image/jpeg",.85);if(image.length>1000000)image=canvas.toDataURL("image/jpeg",.55);
      if(image.length>1000000)throw Error("Choose a smaller image.");
      slides.push({image,alt:"",link:""});render();msg.textContent="Add an offer description, then save.";
    }catch(e){msg.textContent=e.message;}finally{controls.disabled=false;upload.value="";}
  };
  get("banner-save").onclick=async()=>{
    controls.disabled=true;
    try{const res=await fetch("/api/banner-editor",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({slides,revision,enabled:get("banner-enabled").checked})});const result=await res.json();if(!res.ok)throw Error(result.error);revision=result.revision;msg.textContent="Slideshow saved.";}catch(e){msg.textContent=e.message;}finally{controls.disabled=false;}
  };
})();
