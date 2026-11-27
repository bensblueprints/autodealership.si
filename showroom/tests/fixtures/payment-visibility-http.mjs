import assert from "node:assert/strict";

const site = "http://dealer.qa.test:8080";
const headers = { authorization: "Basic ZGVhbGVyOnFh", origin: site, "content-type": "application/json" };
const profileUrl = site + "/api/dealer-profile";
const calculator = "/finance/payment-calculator/";
const leasing = "/finance/leasing/";
const initial = (await (await fetch(profileUrl, { headers })).json()).settings;

async function save(settings) {
  const { revision } = await (await fetch(profileUrl, { headers })).json();
  const response = await fetch(profileUrl, {
    method: "PUT", headers, body: JSON.stringify({ ...settings, revision })
  });
  assert.equal(response.status, 200, await response.text());
}

const pages = { ...initial.pages,
  "payment-calculator": { enabled: true },
  "under-20k": { enabled: true },
  leasing: { enabled: true, body: "Ask the team about lease terms." }
};
try {
  for (const [description, financingEnabled, options, loanPage, leasePage] of [
    ["Lease only", true, { finance: false, lease: true }, false, true],
    ["Loan only", true, { finance: true, lease: false }, true, false],
    ["Calculator disabled", true, { payment: false }, false, true],
    ["BHPH and cash", true, { aprFinancingEnabled: false }, false, false],
    ["Cash only, including older profiles", false, {}, false, false],
    ["Monthly estimates without cash prices", true, { cash: false }, true, true],
    ["BHPH schedules only", true, { pricing: false, aprFinancingEnabled: false }, false, false]
  ]) {
    await save({ ...initial, financingEnabled, pages,
      profile: { ...initial.profile, siteTemplate: "bhph" },
      options: { ...initial.options, cash: true, pricing: true, finance: true, lease: true, aprFinancingEnabled: true, payment: true, ...options }
    });
    const sitemap = await (await fetch(site + "/sitemap.xml")).text();
    for (const [path, visible] of [[calculator, loanPage], [leasing, leasePage], ["/inventory/under-20000/", options.cash !== false && options.pricing !== false]]) {
      const response = await fetch(site + path);
      assert.equal(response.status, visible ? 200 : 404, description + " " + path);
      assert.equal(sitemap.includes(path + "</loc>"), visible, description + " sitemap " + path);
    }
    const oldRoute = await fetch(site + "/page.html?page=payment-calculator", { redirect: "manual" });
    assert.equal(oldRoute.status, loanPage ? 301 : 404, description + " legacy calculator");
    const offers = await (await fetch(site + "/api/bhph")).json();
    assert.ok(Object.values(offers).some(offer => Number.isFinite(offer.cash)), "Fixture needs a cash price");
    assert.equal(Object.values(offers).some(offer => offer.enabled && offer.schedules?.length), financingEnabled, description + " BHPH schedules");
  }
  console.log("Verified independent APR and lease routes, sitemap, legacy URLs, cash prices and BHPH schedules.");
} finally {
  await save(initial);
}
