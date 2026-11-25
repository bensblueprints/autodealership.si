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
 function apply(){
   const saved=Store.showroomSkin();
   const key=Object.hasOwn(showroomSkins,saved)?saved:"midnight";
   const [,surface,card,ink,accent]=showroomSkins[key]||showroomSkins.midnight;
   const root=document.documentElement;const changed=root.dataset.skin!==key;root.dataset.skin=key;
   const light=["pearl","sand"].includes(key);
   root.style.colorScheme=light?"light":"dark";
   for(const [name,value] of Object.entries({surface,card,ink,acid:accent,"on-accent":light?"#ffffff":"#101510",control:"color-mix(in srgb,"+card+" 92%, "+ink+")",selected:"color-mix(in srgb,"+card+" 90%, "+accent+")",muted:"color-mix(in srgb,"+ink+" 78%, "+surface+")",hair:"color-mix(in srgb,"+ink+" 30%, "+surface+")"}))root.style.setProperty("--"+name,value);
   if(changed)window.dispatchEvent(new Event("showroom:skin"));
 }
 addEventListener("showroom:update",apply);addEventListener("storage",apply);apply();
})();
