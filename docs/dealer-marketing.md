# Dealer marketing, search visibility and advertising

The unit of operation is one dealership and its authorized accounts. A dealer can use the campaign desk with zero media spend. The [GitHub roadmap](https://github.com/bensblueprints/autodealership.si/issues/1) tracks 20 deliverables, their dependencies and acceptance criteria.

## Available in the shared showroom

| Capability | Dealer workflow | Boundary of this release |
|---|---|---|
| Campaign approval | In **Dealer dashboard → Marketing**, enter the program, channel, market, monthly USD budget, local landing path, copy, origin and sources. Save, reopen and submit. An administrator checks the sources and approves or returns the brief with a reason. | Planning and internal approval. The budget does not create an order with a media platform. |
| Evidence and revisions | Review history retains the actor, decision, time, copy and source references at submission and decision. Editing approved copy creates a draft. Simultaneous decisions on the same revision yield one successful update. | Source references are entered by staff. A reviewer must inspect vehicle specs, OEM language and offer terms. Automatic verification and review of other publishing surfaces remain open. |
| Native reporting | Inquiries received and test drives booked are counted from this rooftop's PostgreSQL records, using their creation timestamps in a rolling 30-day UTC window. | These are submission counts. A shopper can do both. Neither measure represents unique shoppers, completed sales, paid-channel attribution or a conversion rate. |
| AI-search foundations | Available vehicle detail pages serve visible vehicle facts and matching Schema.org Vehicle data in the initial HTML, using the dealer's inventory, canonical URL and available stock fields. Sold or removed vehicles receive the existing unavailable response. | This makes facts accessible to crawlers. Actual search impressions, citations, referrals and rankings need observations from their respective sources. |

The marketing API is dealer-authenticated and uses the existing request-scoped database routing. Clerk organization members can draft and submit. Organization administrators and authorized platform administrators or assigned engineers can review. Legacy administrator access is supported. Review history is private. The editorial workflow supports a single-owner store reviewing its own work.

## Delivery sequence

| Phase | Engineering work | Exit condition |
|---|---|---|
| 1. First-party pilot | [GEO](https://github.com/bensblueprints/autodealership.si/issues/2), [reporting](https://github.com/bensblueprints/autodealership.si/issues/3), [content review](https://github.com/bensblueprints/autodealership.si/issues/4), [campaign approvals](https://github.com/bensblueprints/autodealership.si/issues/5). Extend reviews to public pages and generated descriptions. Record source revision, expiry and revalidation triggers. | One rooftop can trace a claim from a published asset to its evidence and review. A dealer can reconcile reported inquiries and bookings to the operational records. |
| 2. Data and controls | [Conversions](https://github.com/bensblueprints/autodealership.si/issues/6), [consent](https://github.com/bensblueprints/autodealership.si/issues/7), [vehicle feeds](https://github.com/bensblueprints/autodealership.si/issues/8), [geographic targeting](https://github.com/bensblueprints/autodealership.si/issues/13), [budgets](https://github.com/bensblueprints/autodealership.si/issues/15), [OEM rules](https://github.com/bensblueprints/autodealership.si/issues/20). Establish consent receipts, stable conversion IDs, verified URLs, store codes, feed monitoring, account caps and market-specific rules. | A test lead appears once. Refusal and withdrawal suppress remarketing. Sold stock disappears from the test feed. Finance claims require the applicable source, terms, effective dates and review. |
| 3. Channel pilots | [Google Search](https://github.com/bensblueprints/autodealership.si/issues/9), [Microsoft](https://github.com/bensblueprints/autodealership.si/issues/10), [Meta](https://github.com/bensblueprints/autodealership.si/issues/11), [dynamic inventory](https://github.com/bensblueprints/autodealership.si/issues/12), [creative](https://github.com/bensblueprints/autodealership.si/issues/14), [landing pages](https://github.com/bensblueprints/autodealership.si/issues/16), [YouTube](https://github.com/bensblueprints/autodealership.si/issues/17), [service](https://github.com/bensblueprints/autodealership.si/issues/18), [used vehicles](https://github.com/bensblueprints/autodealership.si/issues/19). Use one authorized rooftop per pilot. Add search, inventory, display remarketing, paid social and video in that order as dependencies clear. | Read-only reports reconcile to each platform. Validated or paused creatives match approved copy, destination, geography and budget. Enabling delivery requires a separate, recorded decision. |
| 4. Co-op operations | [Reimbursement documentation](https://github.com/bensblueprints/autodealership.si/issues/21). Package approved assets, invoices, proof of delivery, dates, market, actual spend, program version and pre-approvals. Track filing, adjudication and payment. | A dealer can export one reconciled sample packet and identify missing items. Count reimbursed dollars only when an actual payment is recorded. |

The channel mix follows the public Acura program benchmark. Each OEM's current dealer agreement, reviewer, creative rules and reimbursement checklist must be obtained for its own pilot. This roadmap records engineering readiness separately from an OEM's written approval. [DealerOn Acura program](https://www.dealeron.com/acura/)

## Measurement contracts

| Question | Planned source and metric | Interpretation |
|---|---|---|
| Where do shoppers find us in ordinary search? | Search Console clicks, impressions and average position, grouped by query, page, country and device. | Label position as a Google average. Preserve filters, suppressed rows and report date. [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics) |
| Do AI-assisted results surface our inventory? | Google generative-AI impressions and Bing AI citations and cited URLs. Verify access for the dealership property and supported export or API fields. | Store engine, time window, surface and source. Google impressions and Bing citations measure different things. Keep sampled local prompts in a separate, labeled benchmark. [Google search reporting](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports) · [Bing AI Performance](https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/) |
| Which visits generated activity? | Authorized GA4 sessions and referrals, filtered for the dealer host, plus committed inquiry, booking and future service events. | Show traffic source, time window and consent-related coverage. A booking requires a successful backend confirmation. Publish a conversion rate only when numerator, denominator and attribution window are compatible. [GA4 Data API](https://developers.google.com/analytics/devguides/reporting/data/v1) |
| Which ads produce booked or sold outcomes? | Native event IDs plus authorized network and eventual CRM/DMS outcome feeds. | Keep first-party observed, provider-attributed and modeled totals separate. A closed lead status alone cannot establish a retail sale. Link spend and outcomes using currency, account, campaign and conversion window. |

## Channel and pilot dependencies

- **Google.** Obtain dealer authorization, Ads customer ID and developer access. Link the correct Merchant Center property, dealership store code and vehicle-ad program. Validate feed price, image, inventory status, VIN and landing page agreement before a paused pilot. [Google Ads OAuth](https://developers.google.com/google-ads/api/docs/oauth/overview) · [Vehicle ads eligibility](https://support.google.com/merchants/answer/11544533)
- **Microsoft.** Authorize the dealer customer and account, obtain developer access and implement Microsoft's automotive feed format with its own diagnostics. [Microsoft Advertising authentication](https://learn.microsoft.com/en-us/advertising/guides/authentication-oauth-quick-start?view=bingads-13) · [Automotive inventory feeds](https://learn.microsoft.com/en-us/advertising/guides/auto-inventory-feeds)
- **Meta and display.** Identify the authorized business, ad account, Page, dataset, catalog and permitted audience uses. Before sending tags or server-side events, honor the recorded purpose and withdrawal state. Use a shared event ID for browser/server deduplication. Include a financing-policy review for BHPH campaigns by market. [Meta Marketing APIs](https://developers.facebook.com/docs/marketing-apis/) · [Conversions API](https://developers.facebook.com/docs/marketing-api/conversions-api/) · [Google consent configuration](https://developers.google.com/tag-platform/security/guides/consent)
- **YouTube.** Conventional Video campaign management has API write restrictions. Import reporting on supported Video campaigns, use eligible Demand Gen workflows for programmatic pilots, or hand approved assets to the dealer's Ads operator. Record the external ID and execution method. [Google Ads video campaign support](https://developers.google.com/google-ads/api/docs/video/overview)

## First pilot

### Configure the U.S. Google vehicle feed

1. In **Dealer dashboard → Marketing → Feed settings**, enter the store code assigned to the dealership in its linked Google Business Profile. Verify that the dealership's advertised cash prices include its mandatory dealer fees. Save the settings. Public cash pricing and the pricing breakdown must be enabled.
2. Under **Marketing → Google vehicle feed**, inspect the eligible count and expand the excluded vehicles. Open the vehicle to supply missing facts or a real photo. For inventory imported as “Listed online” or saved without a status, confirm the car is physically on the lot and select **Available** in its inventory record. Clearing the store code disables the public feed.
3. In the dealer's authorized Merchant Center vehicle ads program, add the displayed HTTPS URL as a scheduled-fetch primary data source for U.S. in-store offers. Select the correct store and vehicle-ads destination. Review the first processing result and resolve Google disapprovals in Merchant Center. The desk's listing checks are local validation. [Google vehicle data source specification](https://support.google.com/merchants/answer/11192663?hl=en)

The feed is generated from the current dealership database on every fetch. Sold and deleted vehicles are removed, and an eligible vehicle marked available again returns. A configured empty lot emits a valid empty feed. Google refreshes its copy on its own schedule. Each item uses the VIN, a store-specific vehicle landing link, and the same cash price as the detail page, including a BHPH cash override when applicable.

### Reconcile native conversions

Use **Marketing → Download conversion events** to export the last 30 rolling days for the signed-in dealership. Each row has an event ID, type, UTC timestamp, VIN and channel. One committed test-drive confirmation produces one booking conversion. Web and concierge booking requests reuse a request key on retry. Repeating a request with matching details returns the original receipt. Competing shoppers receive one successful booking for the slot. The export also includes saved shopper inquiries, each identified by its persisted inquiry ID. Earlier bookings retain their original timestamp and show an unrecorded channel. The export omits shopper names, email addresses, phone numbers and private booking tokens.

### Choose a dealer website template

Engineering can choose **Franchise / OEM**, **Independent dealer**, **Buy Here Pay Here** or **Showroom** in the onboarding wizard. Existing stores can change the layout under **Branding & store settings → Storefront layout**. The color skin can be chosen independently. The **Today** tab checks live inventory, logo variants, contact information and published hours, plus template-specific requirements.

The franchise layout prioritizes new, used and certified inventory. It surfaces service and specials after their dealer pages are enabled. The independent layout prioritizes pre-owned and budget inventory. The BHPH layout links to specific vehicles and shows the dealer-entered down payment, installment and term when an eligible schedule exists. A layout selection never grants OEM certification, enables credit terms or creates a financing offer. Each franchise still needs its current brand assets, authorized offers, disclosures and formal OEM review.

### Review franchise offers before publishing a homepage banner

For a decorative homepage image, go to **Website settings → Homepage banners → Hero image → Template artwork**. Select a scene, inspect both crops and save. The ordinary dealership upload is retained, so staff can switch back to **Dealership photo**. The artwork is independent of vehicle listings, Google feeds and promotional slides.

The shared library is stored in the platform PostgreSQL database. To provision a fresh installation, start the showroom, extract a reviewed artwork pack, and pipe `python deploy/import-template-art.py /path/to/pack` into `psql` as the application database owner. The importer checks the paired image hashes and adds the images to the signed-in selector. Each dealership controls its own homepage selection.

1. Open **Dealer dashboard → Website settings → OEM programs**. Save the manufacturer's offer title, brand, market, source bulletin, version, effective dates and exact shopper-facing disclosure. Record any written manufacturer acceptance separately.
2. An authorized administrator opens the saved draft, checks it against the source, confirms the review and approves that revision. Staff can prepare drafts.
3. In **Homepage banners**, upload the artwork, enter its description and destination, select the approved program revision and save. An administrator reviews the saved artwork and approves it. Enable the slideshow to display eligible banners.
4. Use **Download evidence** in OEM programs for a private JSON record of each revision and decision, including the approved creative, digest, reviewer and timestamp. Invoices, delivery records, reimbursement claims and manufacturer adjudication remain separate work.

The franchise template holds every promotional slide until it has both approvals. A dealership exterior hero photo can still display. Independent and BHPH stores can publish ordinary banners or opt individual offers into the same review. A linked offer displays its saved disclosure and follows its start and end dates in the dealership's configured time zone, including the entire end date.

Changing the image, description or destination requires a matching artwork approval. Saving a new program draft or withdrawing the current revision removes the old offers from subsequent storefront requests. An already-open page checks again when it regains visibility and every minute while visible. It also hides expired artwork at the scheduled cutoff. To release a revised program, approve it, select that revision in the banner editor and review the artwork. These approvals record dealer decisions. Manufacturer certification requires written acceptance through the applicable program.

### Next external pilot

Start with **used-vehicle search**. Connect a dealer-authorized Merchant Center property, verify the scheduled fetch, compare a published offer price with its landing page, and reconcile Google's diagnostics. Service advertising follows when a dealer can supply a working service scheduler and a reliable booking event.
