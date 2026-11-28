# AutoDealership.SI

The dealership sales website lives in `sales-site/`. The shopper showroom, vehicle pages, concierge, test-drive booking and dealer dashboard live in `showroom/`.

## Run the showroom locally

From `showroom/`, use Node.js 22.13 or later.

```sh
node worker/build.mjs
node worker/node-server.mjs
```

Open http://127.0.0.1:8184/ for the showroom and http://127.0.0.1:8184/dealer.html for the dealer dashboard. The deployed Node adapter stores dealer profiles and appointments in PostgreSQL. The demo inventory is a snapshot and vehicle galleries reference dealer-hosted images.

## Hosting

Serve `sales-site/` as the document root for the sales domain. The Hetzner configuration in `deploy/` routes the demo domain to the showroom on loopback port 18284. The Compose file expects the built `showroom/dist/server/index.js` as `showroom.mjs`, the Node adapter as `server.mjs`, and a writable `data/` directory beside the Compose file.

For managed PostgreSQL, set `SHOWROOM_DATABASE_URL` to the direct PostgreSQL connection URL for the showroom control database, including the provider’s TLS options. The showroom uses this connection for the control database and selects each dealer’s registered database by name on the same PostgreSQL server. Onboarding uses `CLIENT_DATABASE_URL` for that control database. Its provisioning role needs permission to create dealer databases. Billing uses `BILLING_DATABASE_URL` for its separate billing database. Keep connection URLs in the deployment secret store.

To run the showroom against the managed service, combine `deploy/compose.yaml` and `deploy/compose.managed-database.yaml` with Docker Compose v2.24.4 or later and start the `showroom` service. The override removes its local database dependency. The original Compose configuration uses a local PostgreSQL instance and requires a `SHOWROOM_DB_PASSWORD` for initial database creation.
