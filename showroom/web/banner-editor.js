(()=>{
  const get=id=>document.getElementById(id),controls=get("banner-controls"),msg=get("banner-status"),upload=get("banner-upload");
  let heroImage="", publishedSlides=[], publishedEnabled=false;
  let slides=[],revision=0,loaded=false;
  const mode=get("hero-mode"),choice=get("template-art-choice"),picker=get("template-art-picker");
  function previewHero(){
    const show=mode.value==="artwork" && Boolean(choice.value);
    picker.hidden=!show;
    get("hero-preview").hidden=mode.value!=="dealership" || !heroImage;
    if(show)for(const size of ["desktop","mobile"]){
      const img=get("art-"+size),src="api/template-art/"+choice.value+"/"+size+".jpg";
      if(img.getAttribute("src")!==src)img.src=src;
    }
  }
  function artworkChoices(data){
    const art=data.art||[],labels={franchise:"Franchise",independent:"Independent",bhph:"Buy Here Pay Here"};
    const layout=window.Store?.settings()?.profile?.siteTemplate;
    choice.replaceChildren(...art.map(item=>new Option((labels[item.layout]||item.layout)+" · "+item.title,item.id)));
    choice.value=data.heroArtwork||art.find(item=>item.layout===layout)?.id||art[0]?.id||"";
    mode.querySelector('[value="artwork"]').disabled=art.length===0;
  }
  let programs=[],canReview=false,franchise=false,states=[],timezone="",dirty=false;
  function programReview(row,slide,index){
    const box=document.createElement("fieldset"),legend=document.createElement("legend");
    legend.textContent="Offer approval";box.append(legend);
    const label=document.createElement("label"),select=document.createElement("select");
    label.textContent="OEM program revision";label.append(select);
    select.add(new Option(franchise?"Choose an approved program":"Standard dealership banner",""));
    const approved=programs.filter(p=>p.state==="approved");
    for(const p of approved)select.add(new Option(p.details.brand+" · "+p.details.title+" · "+p.details.version+" (r"+p.revision+")",p.program_id+"@"+p.revision));
    if(slide.program){
      const key=slide.program.id+"@"+slide.program.revision;
      if(!Array.from(select.options).some(o=>o.value===key))select.add(new Option("Superseded or withdrawn revision",key));
      select.value=key;
    }
    select.onchange=()=>{
      const p=approved.find(p=>p.program_id+"@"+p.revision===select.value);
      if(p)slide.program={id:p.program_id,revision:p.revision};else delete slide.program;
      dirty=true;render();
    };
    const matching=approved.find(p=>p.program_id===slide.program?.id && p.revision===slide.program?.revision);
    const status=document.createElement("p");
    const saved=JSON.stringify(slide)===JSON.stringify(publishedSlides[index]);
    status.textContent=saved?(states[index]||"Save and refresh to check status."):"Save this artwork before review.";
    box.append(label,status);
    if(matching){
      const detail=document.createElement("p"),source=document.createElement("p"),copy=document.createElement("blockquote");
      const d=matching.details;
      detail.textContent=d.brand+" · "+d.market+" · "+d.startsOn+" through "+d.endsOn+" · "+timezone;
      source.textContent="Source: "+d.source+" · "+d.version;copy.textContent=d.disclosure;
      box.append(detail,source,copy);
      if(canReview && states[index]!=="Approved" && states[index]!=="Scheduled" && saved){
        const attest=document.createElement("label"),check=document.createElement("input"),approve=document.createElement("button");
        check.type="checkbox";attest.className="oem-check";attest.append(check," I checked this image, destination and disclosure against the program.");
        approve.textContent="Approve this artwork";approve.type="button";approve.disabled=true;check.onchange=()=>approve.disabled=!check.checked;
        approve.onclick=async()=>{
          if(JSON.stringify(slide)!==JSON.stringify(publishedSlides[index])){msg.textContent="Save your edits before reviewing this artwork.";return;}
          controls.disabled=true;
          try{
            const result=await fetch("api/oem-programs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"approve-artwork",id:matching.program_id,revision:matching.revision,index,bannerRevision:revision,checked:check.checked})});
            const data=await result.json();if(!result.ok)throw Error(data.error||"Unable to approve artwork.");
            await loadEditor(false);msg.textContent="Artwork approval recorded.";
          }catch(error){msg.textContent=error.message;}finally{controls.disabled=false;}
        };
        box.append(attest,approve);
      }
    }
    row.append(box);
  }
  function render(){
    const list=get("banner-list");list.replaceChildren();
    slides.forEach((slide,index)=>{
      const row=document.createElement("div");row.className="banner-row";const img=new Image();img.src=slide.image;img.alt="Slide "+(index+1)+" preview";row.append(img);
      for(const [field,title,limit] of [["alt","Offer description (required)",300],["link","Destination link (optional)",2048]]){
        const label=document.createElement("label"),input=document.createElement("input");label.textContent=title;input.value=slide[field];input.maxLength=limit;input.oninput=()=>{slide[field]=input.value.trim();dirty=true;};label.append(input);row.append(label);
      }
      for(const [label,step] of [["Move up",-1],["Move down",1],["Remove",0]]){
        const b=document.createElement("button");b.textContent=label;b.disabled=step!==0 && !slides[index+step];b.onclick=()=>{dirty=true;slides.splice(index,1);if(step)slides.splice(index+step,0,slide);if(!slides.length)get("banner-enabled").checked=false;render();};row.append(b);
      }
      programReview(row,slide,index);list.append(row);
    });upload.disabled=slides.length>=6;
  }
  let loadSequence=0;
  async function loadEditor(replace){
    const seq=++loadSequence;
    const [res,library]=await Promise.all([readDealerDesk("api/banner-editor",{cache:"no-store"}),readDealerDesk("api/oem-programs",{cache:"no-store"})]);
    if(!res.ok)throw Error("Use Dealer sign in to manage banners.");
    const data=await res.json(),catalog=library.ok?await library.json():{programs:[],canReview:false};
    if(seq!==loadSequence)return;
    programs=catalog.programs;canReview=catalog.canReview;franchise=data.franchise;timezone=data.timezone;
    if(replace || !loaded){
      heroImage=data.heroImage||"";get("hero-mode").value=data.heroMode||"vehicle";
      artworkChoices(data);previewHero();if(heroImage)get("hero-preview").src=heroImage;
      slides=data.slides;publishedSlides=structuredClone(slides);publishedEnabled=data.enabled;revision=data.revision;
      get("banner-enabled").checked=data.enabled;dirty=false;loaded=true;
    }
    states=data.revision===revision?data.states:[];controls.disabled=false;render();
  }
  get("banner-enabled").onchange=()=>dirty=true;
  mode.onchange=choice.onchange=()=>{dirty=true;previewHero();};
  document.querySelector('[data-view="banners"]').addEventListener("click",()=>loadEditor(!dirty).catch(e=>msg.textContent=e.message));
  for(const input of [upload,get("hero-upload")])input.onchange=async()=>{
    const isHero=input!==upload;const file=input.files[0];if(!file)return;controls.disabled=true;
    try{
      if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>15000000)throw Error("Choose a JPG, PNG or WebP under 15 MB.");
      const bitmap=await createImageBitmap(file),canvas=document.createElement("canvas"),scale=Math.min(1,(isHero?2560:1800)/bitmap.width,(isHero?1600:1000)/bitmap.height);
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      const limit=isHero?2400000:1000000;let image=canvas.toDataURL("image/jpeg",.85);if(image.length>limit)image=canvas.toDataURL("image/jpeg",.55);
      if(image.length>limit)throw Error("Choose a smaller image.");
      if(isHero){heroImage=image;get("hero-preview").src=image;get("hero-preview").hidden=false;mode.value="dealership";previewHero();msg.textContent="Saving dealership photo…";await persist(publishedSlides,publishedEnabled);msg.textContent="Dealership photo saved to the homepage.";return;}
      slides.push({image,alt:"",link:""});dirty=true;render();msg.textContent="Add an offer description, then save.";
    }catch(e){msg.textContent=e.message;}finally{controls.disabled=false;input.value="";}
  };
  async function persist(items,enabled){
    const res=await fetch("/api/banner-editor",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({heroImage,heroMode:mode.value,heroArtwork:mode.value==="artwork"?choice.value:null,slides:items,revision,enabled})});
    const result=await res.json().catch(()=>({}));
    if(!res.ok)throw Error(result.error||(res.status===413?"Image upload is too large.":"Save failed. Reopen the dashboard if your session expired."));
    revision=result.revision;
    publishedSlides=structuredClone(items);publishedEnabled=enabled;
  }
  get("banner-save").onclick=async()=>{
    controls.disabled=true;
    try{await persist(slides,get("banner-enabled").checked);await loadEditor(true);msg.textContent="Homepage banners saved. Review the publication status for each banner.";}catch(e){msg.textContent=e.message;}finally{controls.disabled=false;}
  };
})();
