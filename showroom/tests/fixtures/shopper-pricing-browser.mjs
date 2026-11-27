import assert from "node:assert/strict";

// Run against the disposable layout-preview PostgreSQL fixture with its signed-in QA browser.
export async function verifyShopperPricing(page, base) {
  assert.equal(new URL(base).hostname, "dealer.qa.test");
  const vin = "1A000000000000087";
  const cash = "$17,500";
  const vehicleUrl = base + "/vehicle.html?stock=" + vin;
  await page.goto(base + "/robots.txt");
  await page.addInitScript(() => {
    let site;
    Object.defineProperty(window, "clientSite", {
      configurable:true, get:() => site, set:value => {site=value && {...value, agent:"qa"};}
    });
  });
  await page.route("**/api/web-voice/**", route => route.fulfill({json:{signedUrl:"fixture"}}));
  await page.route("**/vendor/elevenlabs-client.js", route => route.fulfill({contentType:"application/javascript",
    body:'window.ElevenLabsClient={Conversation:{startSession:async ({clientTools})=>{window.qaSearchInventory=clientTools.search_inventory;return {};}}};'}));
  async function voiceResult() {
    if(await page.locator("#showroom-concierge").isHidden())await page.locator("#concierge-launcher").click();
    await page.locator(".ac-voice").click();
    await page.waitForFunction(() => typeof window.qaSearchInventory === "function");
    const data = await page.evaluate(vin => JSON.parse(window.qaSearchInventory({query:vin})), vin);
    assert.equal(data.vehicles.length, 1);
    return data.vehicles[0];
  }
  const original = await page.evaluate(async () => (await (await fetch("/api/dealer-profile")).json()).settings);
  async function configure(options, layout=original.profile?.siteTemplate) {
    const result = await page.evaluate(async ({original, options, layout}) => {
      const url = "/api/dealer-profile";
      const {revision} = await (await fetch(url)).json();
      const body = options ? {...original, profile:{...original.profile, siteTemplate:layout}, financingEnabled:true, options:{...original.options,
        cash:true, pricing:true, finance:true, lease:true, price:true, payment:true, compare:true, aprFinancingEnabled:true, ...options}} : original;
      const response = await fetch(url, {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({...body,revision})});
      return [response.status, response.ok ? "" : await response.text()];
    }, {original, options, layout});
    assert.equal(result[0], 200, result[1]);
  }
  async function navigate(url, ready) {
    await page.goto(url);
    await page.locator(ready).first().waitFor({state:"visible"});
  }
  const card = page.locator("#cards article").filter({hasText:"PREVIEW-87"}).first();
  try {
    await configure({cash:false, aprFinancingEnabled:false}, "bhph");
    await navigate(base + "/#inventory?min=999999&sort=priceLow", "#cards article .retail-card");
    assert.equal(await page.locator("body").getAttribute("data-store-template"), "bhph");
    assert.equal(await card.count(), 1);
    assert.ok(!(await card.innerText()).includes(cash));
    assert.ok(!(await page.locator("#herospec").innerText()).includes(cash));
    assert.ok(await page.locator("#budget").isHidden(), await page.locator("#budget").evaluate(el=>JSON.stringify({visibleModes:el.innerText, hidden:el.hidden, apr:Store.aprAllowed(),loaded:Store.profileLoaded(),cash:Store.cashPriceVisible()})));
    assert.equal(await page.locator("#sortInventory").inputValue(), "recommended");
    assert.ok(await page.locator("#sortInventory option[value=priceLow]").isDisabled());
    assert.ok(!new URL(page.url()).hash.includes("min="));
    assert.ok(await page.locator("#bhph-filter").isVisible());
    await card.locator("[data-retail=compare]").click();
    await page.locator("[data-retail=compareList]").click();
    assert.ok(!(await page.locator(".retail-dialog").innerText()).includes(cash));
    await page.locator(".retail-dialog [data-retail=close]").click();
    await navigate(vehicleUrl, "#vehicle-payment-schedules");
    assert.ok(await page.locator("#price").isHidden());
    assert.ok(await page.locator("#price-detail").isHidden());
    assert.ok(await page.locator("#calculate").isHidden());
    const offer = page.locator("#vehicle-payment-schedules");
    assert.ok(!(await offer.innerText()).includes(cash));
    assert.ok((await offer.innerText()).includes("$19,500"));
    assert.ok((await offer.innerText()).includes("$3,000"));
    await offer.locator("select").selectOption({index:1});
    assert.match(await offer.locator("[role=status]").innerText(), /weekly payments/i);
    await page.locator("#concierge-launcher").click();
    await page.locator(".ac-form input").fill("What is the cash price?");
    await page.locator(".ac-form input").press("Enter");
    const reply = await page.locator(".ac-line.reply").last().innerText();
    assert.ok(reply.includes("Ask the sales team"));
    assert.ok(reply.includes("$19,500"));
    assert.ok(!reply.includes(cash));

    const hiddenVoice = await voiceResult();
    assert.equal(hiddenVoice.price, null);
    assert.ok(!hiddenVoice.buyHerePayHere.includes(cash));
    assert.ok(hiddenVoice.buyHerePayHere.includes("$19,500"));
    await configure({pricing:false, lease:false}, "franchise");
    await navigate(base + "/", "#cards article .retail-card");
    assert.equal(await page.locator("body").getAttribute("data-store-template"), "franchise");
    assert.ok(!await page.locator("#budget [data-mode=cash]").count());
    assert.equal(await page.locator("#budget [data-mode=all]").getAttribute("aria-pressed"), "true");
    await page.locator("#budget [data-mode=finance]").click();
    assert.match(await card.innerText(), /Est\. \$[\d,.]+\/mo/);
    assert.ok(!(await card.innerText()).includes(cash));
    await page.locator("#budget [data-mode=all]").click();
    assert.equal(await card.locator(".monthly-estimate").count(), 0);
    await navigate(vehicleUrl, "#vehicle-payment-schedules");
    assert.equal(await page.locator("#modes button").allTextContents().then(rows=>rows.join(",")), "Finance");
    assert.match(await page.locator("#price").innerText(), /\/mo$/);
    await page.locator("#calculate").click();
    assert.ok(!(await page.locator(".retail-dialog").innerText()).includes(cash));
    assert.match(await page.locator(".retail-dialog output").innerText(), /\/mo$/);
    await configure({}, "independent");
    await navigate(vehicleUrl, "#vehicle-payment-schedules");
    assert.equal(await page.locator("#price").innerText(), cash);
    assert.ok((await page.locator("#pricing").innerText()).includes(cash));
    assert.ok((await offer.innerText()).includes(cash));
    assert.equal((await voiceResult()).price, 17500);
    console.log("Verified cash, BHPH-only and monthly-estimate policies across shopper pages, comparisons, shared filters, concierge text and voice tool data.");
  } finally {
    await configure(null);
  }
}
