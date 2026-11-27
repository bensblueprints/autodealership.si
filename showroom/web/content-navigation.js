(() => {
  const link=document.querySelector(".content-skip");
  if(!link)return;
  link.addEventListener("click",event=>{
    if(event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return;
    const target=document.getElementById(link.hash.slice(1));
    if(!target)return;
    // Catalog filters can change the URL after the server renders the link.
    // Keep the current query and the dashboard's selected tab intact.
    event.preventDefault();
    target.focus({preventScroll:true});
    target.scrollIntoView({block:"start",behavior:"instant"});
  });
})();
