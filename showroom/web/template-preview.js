(() => {
  const dialog = document.getElementById("template-preview");
  const stage = document.getElementById("template-preview-stage"), frame = stage.querySelector("iframe");
  const status = document.getElementById("template-preview-status"), impact = document.getElementById("template-preview-impact");
  const retry = document.getElementById("template-preview-retry"), fields = document.getElementById("settingsForm").elements;
  const full = document.getElementById("template-preview-full");
  const sizes = {desktop: 1280, mobile: 390};
  const buttons = [...dialog.querySelectorAll("[data-preview-size]")];
  let size, version = 0;

  function fit() {
    if (!dialog.open || !stage.clientWidth || !size) return;
    const width = sizes[size], scale = Math.min(1, stage.clientWidth / width);
    frame.style.width = width + "px";
    frame.style.height = Math.floor(stage.clientHeight / scale) + "px";
    frame.style.transform = "scale(" + scale + ")";
    frame.style.left = Math.max(0, (stage.clientWidth - width * scale) / 2) + "px";
  }
  function setSize(value) {
    size = value;
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.previewSize === size)));
    fit();
  }
  function showImpact(changes) {
    impact.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = "Page visibility"; impact.append(title);
    const groups = [[changes.added, "Will appear"], [changes.removed, "Will be hidden"]];
    if (groups.every(([pages]) => !pages.length)) {
      const text = document.createElement("p"); text.textContent = "The same pages will be visible."; impact.append(text);
    }
    for (const [pages, label] of groups) {
      if (!pages.length) continue;
      const details = document.createElement("details"), summary = document.createElement("summary"), list = document.createElement("ul");
      summary.textContent = label + " (" + pages.length + ")";
      for (const page of pages) {
        const item = document.createElement("li"), path = document.createElement("small");
        item.append(document.createTextNode(page.title + " ")); path.textContent = page.path; item.append(path); list.append(item);
      }
      details.append(summary, list); impact.append(details);
    }
    impact.hidden = false;
  }
  function failed() {
    status.textContent = "Preview unavailable. Check your sign-in and retry.";
    retry.hidden = false; full.hidden = true; impact.hidden = true; frame.style.visibility = "hidden";
  }
  function load() {
    const run = ++version;
    const url = new URL("dealer-preview", location.href);
    url.search = new URLSearchParams({layout: fields.siteTemplate.value, skin: fields.skin.value});
    document.getElementById("template-preview-selection").textContent =
      fields.siteTemplate.selectedOptions[0].text + " · " + fields.skin.selectedOptions[0].text;
    status.textContent = "Loading dealership preview…"; impact.hidden = true; retry.hidden = true; frame.style.visibility = "hidden";
    full.hidden = true; full.href = url.href;
    frame.onload = async () => {
      if (!dialog.open || run !== version) return;
      try {
        const win = frame.contentWindow, doc = frame.contentDocument;
        if (win.location.href === "about:blank") return;
        if (doc.documentElement.dataset.previewLayout !== fields.siteTemplate.value || !win.Store) throw Error();
        await Promise.all([win.Store.profileReady, win.Store.inventoryReady]);
        if (run !== version || !dialog.open) return;
        if (!win.Store.profileLoaded()) throw Error();
        showImpact(JSON.parse(doc.getElementById("preview-pages").textContent));
        full.hidden = false; frame.style.visibility = ""; status.textContent = ""; fit();
      } catch { if (run === version && dialog.open) failed(); }
    };
    frame.src = url.href;
  }
  buttons.forEach(button => button.onclick = () => setSize(button.dataset.previewSize));
  new ResizeObserver(fit).observe(stage);
  document.getElementById("open-template-preview").onclick = () => {
    dialog.showModal(); setSize(matchMedia("(max-width: 700px)").matches ? "mobile" : "desktop"); load();
  };
  retry.onclick = load;
  document.getElementById("close-template-preview").onclick = () => dialog.close();
  dialog.addEventListener("close", () => { ++version; frame.onload = null; frame.removeAttribute("src"); });
})();
