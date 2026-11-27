(() => {
  "use strict";
  let dialog;
  let activeListing;

  function open(car) {
    if (!dialog) dialog = createDialog();
    const url = new URL("/vehicle.html", window.clientSite?.publicOrigin || location.origin);
    url.searchParams.set("stock", car.vin || car.id);
    const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
    const title = [car.year, car.make, car.model, car.trim].map(clean).filter(Boolean).join(" ") || "Vehicle listing";
    const dealer = clean(Store.settings().dealerName);
    const detail = [dealer, car.stock && "Stock #" + clean(car.stock)].filter(Boolean).join(" · ");
    activeListing = {title, text: [title, detail].filter(Boolean).join(" — "), url: url.href};
    dialog.querySelector("h2").textContent = title;
    dialog.querySelector(".share-stock").textContent = detail;
    dialog.querySelector("input").value = url.href;
    dialog.querySelector("[role=status]").textContent = "";
    const mail = dialog.querySelector("a");
    mail.href = "mailto:?subject=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(activeListing.text + "\n\n" + url.href);
    dialog.querySelector("[data-native]").hidden = typeof navigator.share !== "function";
    dialog.showModal();
  }

  function createDialog() {
    const element = document.createElement("dialog");
    element.className = "listing-share-dialog";
    element.setAttribute("aria-labelledby", "listing-share-heading");
    element.setAttribute("aria-describedby", "listing-share-vehicle listing-share-stock");
    element.innerHTML = `<div class="share-top"><strong id="listing-share-heading">Share listing</strong><button type="button" data-close aria-label="Close share listing">×</button></div>
      <h2 id="listing-share-vehicle"></h2><p id="listing-share-stock" class="share-stock"></p>
      <label>Vehicle link<input type="url" readonly spellcheck="false"></label>
      <div class="share-actions"><button type="button" data-copy>Copy link</button><a>Email listing</a><button type="button" data-native>More sharing options</button></div>
      <p role="status"></p>`;
    element.querySelector("[data-close]").onclick = () => element.close();
    const input = element.querySelector("input");
    input.addEventListener("focus", () => input.select());
    element.querySelector("[data-copy]").onclick = async () => {
      const listing = activeListing;
      try {
        await navigator.clipboard.writeText(listing.url);
        if (activeListing === listing) element.querySelector("[role=status]").textContent = "Vehicle link copied.";
      } catch {
        if (activeListing !== listing) return;
        input.focus();
        input.select();
        element.querySelector("[role=status]").textContent = "The vehicle link is selected. Use your device’s Copy command.";
      }
    };
    element.querySelector("[data-native]").onclick = async () => {
      const listing = activeListing;
      try {
        await navigator.share(listing);
        if (activeListing === listing) element.close();
      } catch (error) {
        if (activeListing === listing && error.name !== "AbortError") element.querySelector("[role=status]").textContent = "Use Copy link or Email listing to share this vehicle.";
      }
    };
    element.addEventListener("close", () => { activeListing = null; });
    document.body.append(element);
    return element;
  }
  window.VehicleShare = {open};
})();
