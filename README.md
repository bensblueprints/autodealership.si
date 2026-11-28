# AutoDealership.SI

The dealership sales website lives in `sales-site/`. The shopper showroom, vehicle pages, concierge, test-drive booking and dealer dashboard live in `showroom/`.

## Run the showroom locally

From `showroom/`, use Node.js 22.13 or later.

```sh
node worker/build.mjs
node worker/node-server.mjs
```

Open http://127.0.0.1:8184/ for the showroom and http://127.0.0.1:8184/dealer.html for the dealer dashboard. The Node adapter saves profiles and appointments in `showroom-data/`. The demo inventory is a snapshot and vehicle galleries reference dealer-hosted images.

## Hosting

The Netlify preview of the sales site is available at [netlify-preview.autodealership.si](https://netlify-preview.autodealership.si/). The Netlify project is `autodealership-si` in Advanced Marketing Main. Build with `node deploy/netlify/build-sales.mjs` and publish `dist/netlify-sales`. The preview directs account links to the authenticated domain and sends a noindex header.

The trial serves `autodealership.si/company/our-approach/` through Netlify on the primary domain. Its Cloudflare route is in `deploy/netlify/wrangler.toml`. Admin, onboarding, billing, VIN APIs, legacy client routes, and requests that change data use the existing origin. The demo and dealer subdomains have their own hosting. If Netlify is unavailable, the router retrieves the original page from Hetzner. Removing the trial route restores direct service from the original host. Keep the proxied apex DNS record pointed at Hetzner while using this routing setup.

Run `node --test deploy/netlify/sales-router.test.mjs` before making routing changes. Deploy the router with `npx wrangler deploy --config deploy/netlify/wrangler.toml` from the repository root.

Serve `sales-site/` as the document root for the sales domain. The Hetzner configuration in `deploy/` routes the demo domain to the showroom on loopback port 18284. The Compose file expects the built `showroom/dist/server/index.js` as `showroom.mjs`, the Node adapter as `server.mjs`, and a writable `data/` directory beside the Compose file.
