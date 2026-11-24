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

Serve `sales-site/` as the document root for the sales domain. The Hetzner configuration in `deploy/` routes the demo domain to the showroom on loopback port 18284. The Compose file expects the built `showroom/dist/server/index.js` as `showroom.mjs`, the Node adapter as `server.mjs`, and a writable `data/` directory beside the Compose file.
