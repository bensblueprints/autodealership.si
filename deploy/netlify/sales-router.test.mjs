import assert from "node:assert/strict";
import test from "node:test";
import { routeSales } from "./sales-router.mjs";

const base = "https://autodealership.si";
test("account, API, ACME, tenant, and write requests preserve the original request", async () => {
  const paths = ["/onboarding/staff-email", "/billing/webhook", "/admin", "/clients/example/dealer",
    "/api/v1/vin/example", "/.well-known/acme-challenge/token", "/_domain/robots.txt", "/%61dmin"];
  const requests = paths.map(path => new Request(base + path));
  requests.push(new Request("https://demo.autodealership.si/"), new Request(base + "/", { method: "POST", body: "data" }));
  for (const request of requests) {
    await routeSales(request, async received => { assert.equal(received, request); return new Response("legacy"); });
  }
});

test("public HTML is served by Netlify without sharing cookies or hiding the primary domain from search", async () => {
  const request = new Request(base + "/products/?v=3&email=private", {headers: {Cookie: "session=test", Authorization: "example"}});
  const result = await routeSales(request, async upstream => {
    assert.equal(upstream.url, "https://autodealership-si.netlify.app/products/?v=3");
    assert.equal(upstream.headers.has("Cookie") || upstream.headers.has("Authorization"), false);
    return new Response("public", {headers: {"X-Robots-Tag": "noindex, nofollow", "Set-Cookie": "x=1"}});
  });
  assert.equal(await result.text(), "public");
  assert.equal(result.headers.has("X-Robots-Tag") || result.headers.has("Set-Cookie"), false);
  assert.equal(result.headers.get("X-ADSI-Hosting"), "Netlify");
});

test("the primary domain receives its real robots and signup files", async () => {
  for (const path of ["/robots.txt", "/signup.html", "/signup"]) {
    await routeSales(new Request(base + path), async upstream => {
      assert.equal(new URL(upstream.url).pathname, "/_domain" + (path === "/signup" ? "/signup.html" : path));
      return new Response("");
    });
  }
});

test("host redirects retain the shopper URL and unavailable hosting falls back to the original site", async () => {
  const request = new Request(base + "/company?utm_source=demo");
  const redirected = await routeSales(request, async () => Response.redirect("https://autodealership-si.netlify.app/company/", 301));
  assert.equal(redirected.headers.get("location"), base + "/company/?utm_source=demo");
  for (const unavailable of [async () => new Response(null, {status: 503}), async () => { throw Error("Network error"); }]) {
    const result = await routeSales(request, r => r === request ? Promise.resolve(new Response("original")) : unavailable());
    assert.equal(await result.text(), "original");
  }
});
