# Dealer billing
The billing service listens on loopback. Nginx serves the sales site and proxies /billing/ to it. PostgreSQL stores accounts and billing records. Set BILLING_DATABASE_URL in /etc/autodealership-billing-postgres.env and install python3-psycopg. The public showroom demo is unmetered.

## Merchant activation
Create the dedicated AutoDealership.SI business. Configure these values in /etc/autodealership-billing.env (root-readable only). Sandbox and production require separate credentials, signing secrets, catalogs and databases.
- WHOP_ENV=sandbox or production
- WHOP_ACCOUNT_ID, WHOP_API_KEY, WHOP_WEBHOOK_SECRET. Use the complete literal ws_ webhook secret.
- Run catalog.py --account biz_... with the business credentials loaded and a writable BILLING_DATA directory. It creates the four plan variants with and without marketing and two prepaid dollar denominations. Set WHOP_VARIANTS to its returned JSON.
- Register https://autodealership.si/billing/whop-hook for payment.succeeded, payment.failed, setup_intent.succeeded and membership.deactivated. Use the current API event representation with account_id, variant_id and a Money subtotal. Version used by outbound calls: 2026-11-23-3.
- Configure BILLING_SMTP_HOST, BILLING_MAIL_FROM and the SMTP username/password for billing notifications. The mailer uses implicit TLS, port 465 by default.
- Restart the service after updating settings. Complete a sandbox checkout, card-save, refill, declined payment and cancellation with separate test credentials before charging customers.

## Provisioning paid voice
Assign a dedicated ElevenLabs agent to each paid rooftop in VOICE_AGENT_ACCOUNTS (JSON object mapping agent ID to the dealer UUID). Set ELEVENLABS_WEBHOOK_SECRET and configure the signed post_call_transcription endpoint /billing/voice-hook. The public demo agent must remain unmapped. Before issuing a signed session URL or accepting a phone call, the tenant's server must call POST /billing/internal/admit with its dealer ID and Authorization: Bearer BILLING_ADMISSION_KEY. Supply the returned reservation as the billing_reservation dynamic variable, respect maximumConnectedSeconds and use text or the configured phone fallback when denied. Never give a public browser this service key. The hosted sales service has no authority to provision a real dealer phone line or inventory feed.

## Reconciliation
Credit is granted from signed successful payments. Top-up requests use durable local orders and an Idempotency-Key. An ambiguous request older than an hour is left pending for reconciliation against Whop before any retry. Review refunds, chargebacks and externally modified subscriptions in Whop before adjusting customer credits. Scope checkout variants to the configured merchant; do not apply coupons to prepaid credits. Back up the PostgreSQL billing database before maintenance.

Run python test_billing.py in this directory for an isolated ledger test. Production checkout is disabled until merchant settings are supplied.
