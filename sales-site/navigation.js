(() => {
  const mast = document.querySelector(".mast");
  if (!mast) return;
  const nav = mast.querySelector(".mn-nav");
  const mobile = mast.querySelector(".mn-mobile");
  const sections = [...nav.querySelectorAll("details")];
  const wide = matchMedia("(min-width: 1041px)");
  const mouse = matchMedia("(hover: hover) and (pointer: fine)");
  let hoverTimer;

  function closeSections(except) {
    clearTimeout(hoverTimer);
    for (const section of sections) if (section !== except) section.open = false;
  }
  function closeNav() {
    closeSections();
    nav.classList.remove("is-open");
    mobile.setAttribute("aria-expanded", "false");
  }
  mast.classList.add("mn-enhanced");
  mobile.hidden = false;
  mobile.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    mobile.setAttribute("aria-expanded", String(open));
    if (!open) closeSections();
  });
  for (const section of sections) {
    const summary = section.querySelector("summary");
    summary.addEventListener("click", () => closeSections(section));
    summary.addEventListener("keydown", event => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        closeSections(section);
        section.open = true;
        section.querySelector("a").focus();
      }
    });
    summary.addEventListener("pointerenter", event => {
      if (event.pointerType !== "mouse" || !wide.matches || !mouse.matches) return;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => { closeSections(section); section.open = true; }, 140);
    });
    summary.addEventListener("pointerleave", () => clearTimeout(hoverTimer));
  }
  mast.addEventListener("pointerleave", event => {
    if (wide.matches && event.pointerType === "mouse" && !nav.contains(document.activeElement)) closeSections();
  });
  document.addEventListener("pointerdown", event => { if (!mast.contains(event.target)) closeNav(); });
  mast.addEventListener("focusout", event => { if (event.relatedTarget && !mast.contains(event.relatedTarget)) closeNav(); });
  mast.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const open = sections.find(section => section.open);
    if (open) {
      open.open = false;
      open.querySelector("summary").focus();
    } else if (nav.classList.contains("is-open")) {
      closeNav();
      mobile.focus();
    }
  });
  wide.addEventListener("change", closeNav);
  const finder = document.querySelector("#dealer-finder");
  finder?.addEventListener("submit", event => {
    event.preventDefault();
    const slug = finder.elements.store.value.trim().toLowerCase();
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 63) {
      location.assign("https://" + slug + ".autodealership.si/dealer");
    }
  });
})();
