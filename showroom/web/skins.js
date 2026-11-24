const showroomSkins={
  midnight:["Midnight black","#101210","#1c201c","#f6f6f0","#d6fc57"],
  pearl:["Pearl white","#f5f4f0","#ffffff","#17212a","#155a94"],
  navy:["Navy blue","#091a30","#132b47","#eff6ff","#79ceff"],
  forest:["Forest green","#10241b","#193728","#eff9ee","#ace09e"],
  burgundy:["Burgundy","#2e101c","#421a2c","#fff0f6","#ffadcb"],
  plum:["Plum","#24152e","#372041","#fbf0ff","#dcafff"],
  slate:["Slate gray","#252d33","#364149","#f4f7f8","#a5e1ec"],
  sand:["Desert sand","#f1e0c6","#fff2df","#32261e","#844022"]
};
(() => {
 const defaultSkin=()=>Store.settings().profile?.skin || "midnight";
 const select=document.createElement("select");
 const label=document.createElement("label");label.className="skin-picker";label.append("Showroom skin ",select);
 select.add(new Option("Dealer default",""));
 for(const [key,[name]] of Object.entries(showroomSkins))select.add(new Option(name,key));
 document.querySelector(".top")?.after(label);
 function apply(){
   const preview=sessionStorage.getItem("skin-preview")||"";
   select.value=preview;
   const key=Object.hasOwn(showroomSkins,preview)?preview:defaultSkin();
   const [,surface,card,ink,accent]=showroomSkins[key]||showroomSkins.midnight;
   const root=document.documentElement;root.dataset.skin=key;
   for(const [name,value] of Object.entries({surface,card,ink,acid:accent,muted:"color-mix(in srgb,"+ink+" 78%, "+surface+")",hair:"color-mix(in srgb,"+ink+" 30%, "+surface+")"}))root.style.setProperty("--"+name,value);
 }
 select.onchange=()=>{sessionStorage.setItem("skin-preview",select.value);apply();};
 addEventListener("showroom:update",apply);addEventListener("storage",apply);apply();
})();
