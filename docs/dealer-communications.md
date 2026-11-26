# Dealer follow-up and communications pricing

Proposed U.S. pilot. AutoDealership.SI would sell a managed follow-up service per dealership. Dealers would manage conversations, phone numbers, senders, allowances and spend limits in their dashboard. Their staff could work entirely in the existing PostgreSQL inbox.

## What the dealer buys

A shopper asks about stock DJ123 and chooses email. The system reads that dealership’s inventory and replies from its verified address about that vehicle. When the shopper replies “Can I come Saturday?”, the conversation returns to the original inquiry. The assistant offers available slots and asks for confirmation before booking. The assigned salesperson sees the transcript, phone number, booking and next action. A human can take over at any point.

| Channel | Proposed connection | Dealer experience |
|---|---|---|
| Text and telephone | One managed Twilio subaccount per rooftop, with dealership-specific phone numbers, Messaging Service and registered use cases. ElevenLabs handles the AI portion of calls. | The platform supplies the number or coordinates a port. A pilot can start on a new local number. Forwarding an existing voice line does not by itself move its SMS traffic. Validate both routes before advertising the number. |
| Email | Start with Resend and verify the dealer’s sending subdomain. Use a dedicated reply subdomain, per-conversation reply address and inbound webhook. | A message can come from “Southern Ohio Auto Sales” and a verified dealer address. Replies reach the right inquiry. The dealer keeps its existing Google Workspace or Microsoft 365 mail routing. Add MX records only at the dedicated receiving subdomain. |
| Existing provider account | Offer a dealer-owned account option after the managed pilot. The dealer pays its provider directly. | Charge for the inbox, AI workflows, reporting and support. Show which usage appears on the provider’s bill before the dealer enrolls. |

For U.S. local texting, follow Twilio’s ISV onboarding process for each customer brand and campaign. Register the actual use case. For a BHPH store, start with stock questions and requested visits. Review financial content separately before enabling it. [Twilio subaccounts](https://www.twilio.com/docs/iam/api/subaccounts) · [Twilio registration](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) · [Restricted messaging categories](https://help.twilio.com/articles/360045004974)

## Email provider decision

The engineer’s onboarding wizard should show separate **Email**, **Text** and **Telephone** connection states. Email setup asks for the display name, sending subdomain, reply subdomain and postal address, then shows the exact provider DNS records for sending authentication and receiving. Test domain authentication, an outbound message and an inbound reply before marking email ready. Text setup collects the authorized business contact, sender registration and opt-in evidence. Telephone setup verifies that a test call reaches the assigned agent and transfers to the correct staff line. Dealers can start with email while carrier registration is pending.

| Provider | Public U.S. dollar pricing | When it makes sense |
|---|---|---|
| **Resend** | Pro starts at $20/month for 50,000 transactional emails. Extra volume on that tier is $0.90 per 1,000. | Pilot choice. Verified sending domains, inbound email and webhooks cover the shopper reply loop. Budget for additional domains and inbound usage as dealers are added. [Pricing](https://resend.com/pricing) · [Receiving email](https://resend.com/docs/dashboard/receiving/introduction) |
| **Mailgun** | Foundation starts at $35/month for 50,000 emails. | Alternative when the team wants provider-managed inbound routing rules. Check the domain and route limits of the chosen plan. [Pricing and routes](https://www.mailgun.com/pricing/) |
| **Twilio SendGrid** | Essentials starts at $19.95/month. Pro starts at $89.95/month and includes subuser management. | Good choice when dealership subusers and an existing Twilio commercial relationship matter. Inbound Parse brings replies into the application. [Pricing](https://www.twilio.com/en-us/products/email-api/pricing) · [Inbound Parse](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook) |
| **Amazon SES** | Base outbound rate of $0.10 per 1,000 emails. Receiving, data, tenant management and other selected AWS services have their own charges. | Strong option for many rooftops. SES supports per-tenant reputation controls. Budget engineering time for production access, inbound routing, events and deliverability operations. [Pricing](https://aws.amazon.com/ses/pricing/) · [Tenant management](https://docs.aws.amazon.com/ses/latest/dg/tenants.html) |

Use a provider-neutral conversation ID and usage record from day one. Start with one working email integration. Revisit SES when the projected savings or reputation isolation justify the operating cost. For example, at 50,000 outbound emails the difference between Resend Pro and SES base sending is $15 per month before AWS extras.

## Proposed pilot rate card

Existing subscriptions, negotiated website fees and included voice minutes continue under their existing agreements. Offer **Managed Follow-up at $99/month per rooftop** as an optional addition. The existing $100 Southern Ohio website agreement would change only if the dealer elects the add-on. These are proposed retail rates for a U.S. pilot.

| Included or metered item | Proposed dealer price | Billing rule |
|---|---|---|
| Follow-up workspace | $99/month includes one standard local number, 500 SMS segments combined across both directions, and 1,000 outbound inquiry emails | Includes the shared inbox, automatic first reply, staff handoff and reporting. Disclose registration and recurring campaign fees at provisioning. |
| SMS overage | $0.04 per additional segment | Cover standard domestic carrier costs in this rate. Count actual provider-reported segments. Show the estimate before staff send a long or Unicode message. Incoming shopper replies also use the allowance. Absorb STOP, HELP, carrier error and compliance traffic. |
| Email overage | $5 per 1,000 additional outbound emails, prorated at $0.005 per recipient | Charge once per accepted outbound recipient. Receive customer replies without a separate retail fee. Suppress future sends on hard bounces, complaints and unsubscribes. |
| AI receptionist or website voice | Use the dealer’s agreed included minutes and existing overage tiers where applicable | Current standard tiers in billing code are $0.35, $0.30 and $0.27 per additional AI minute by volume. Bundle the standard domestic telephone leg during AI handling into the AI rate. Web-only voice incurs no telephone leg. |
| Human-only forwarding | Proposed $0.05 per connected minute for standard domestic forwarding after handoff | Start the human-only meter when the transfer connects and AI handling ends. Preview separately priced destinations, recording or conferencing before enabling them. |

Twilio lists U.S. local SMS at $0.0083 per segment in either direction plus carrier charges. Standard local voice is $0.0085/min inbound and $0.014/min outbound with a $1.15 monthly local number. A bridged inbound call can consume both legs. ElevenLabs, models and any retained recordings add separate costs. [Twilio SMS](https://www.twilio.com/en-us/sms/pricing/us) · [Twilio Voice](https://www.twilio.com/en-us/voice/pricing/us)

### Illustrative unit economics

The following examples are separate one-dealer pilots. Each carries the full $20 Resend plan, one $1.15 number and an assumed blended $0.0123 per SMS segment. Both remain inside the provider’s included email volume. Carrier mix changes actual SMS cost.

| Monthly usage | Dealer revenue | Modeled SMS, number and email cost | Amount left for other costs and profit |
|---|---:|---:|---:|
| 500 segments and 1,000 outbound emails | $99.00 | $27.30 | $71.70 |
| 2,500 segments and 5,000 outbound emails | $199.00 | $51.90 | $147.10 |

The remaining amount must cover AI generation, support, payment processing, registration/campaign fees, taxes where applicable and failed traffic. Measure these against real provider invoices during the pilot. For voice, a 60% contribution target at $0.35/min allows $0.14/min of direct cost. At $0.27/min the ceiling is $0.108/min. Test the actual agent, language model, call routing and transfer mix before offering volume commitments.

## Which follow-ups can run

1. **New question.** Offer the shopper a reply channel. Respond on that channel about the specific stock number. Check live inventory, current price and appointment availability before answering. A missing fact creates a staff task. If neither digital channel is appropriate, assign a manual callback where requested.
2. **Incoming response.** Resolve the sender, dealership and conversation. Display the entire thread to the assigned rep. Pause any queued sequence when a shopper replies. A rep taking over holds automation until staff explicitly release it.
3. **Booking.** Confirm using the existing appointment ID. A duplicate event or reschedule must preserve the single booking conversion. Recheck the appointment immediately before sending a reminder. A cancellation invalidates queued reminders.
4. **Exceptions.** An after-hours message can acknowledge the question and queue a local-time follow-up. Missed-call text-back needs its own permission and registration review. Block unsolicited financing promotions, collections and outbound AI dialing in the pilot. Use spam filtering and reply-loop protection for vacation notices, bounces and automated senders.
5. **Channel controls.** Record the recipient, permitted channel and purpose, source, disclosure version, timestamp and withdrawals per dealership. Separate sales promotions from requested replies and appointment messages. Honor text STOP, all-channel requests, email complaints and unsubscribes during dispatch. A blocked SMS must never trigger an automatic email workaround. Apply the relevant commercial email identification, address and unsubscribe requirements. [Twilio messaging policy](https://www.twilio.com/en-us/legal/messaging-policy) · [FTC commercial email guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)

## Wallet and engineering sequence

1. **Inbox and ownership.** Add rep assignment, due time, next action, channel choice and visible response history to each lead. Use a shared conversation for a shopper replying about the same inquiry. Keep unrelated inquiries for the same person distinguishable.
2. **Email pilot.** Add dealer domain verification, per-dealer sender, opaque reply tokens, signed events, outbound queue and human takeover. Validate recipient and rooftop on every inbound route. Test duplicate events, forwarded replies, spoofed senders, out-of-office replies, bounces and withdrawal during queue delays.
3. **Phone and SMS.** Provision the Twilio subaccount under the platform account and bind each verified business number to one dealership. Verify webhook signatures and destination ownership. Link SMS identifiers, Twilio call legs and ElevenLabs conversations to the same rooftop and conversation. Test a real internal handset and staff transfer after the dealer authorizes the pilot.
4. **Shadow billing.** Write usage events with a unique provider ID, unit, channel, timestamp, rooftop and versioned retail rate to PostgreSQL. Settle SMS with the final segment count and email with accepted sends. Reconcile Twilio and ElevenLabs records for each AI call. Delivery callbacks update status and replay safely. For ambiguous submissions, reconcile or flag them before retrying. Keep opt-outs and incoming replies available at a zero balance.
5. **Paid activation.** Extend the existing Whop prepaid voice ledger into a communications balance. Migrate balances at their full dollar value. Get explicit approval for the new channels, retail rates and automatic refills. Apply included allowances first, reserve eligible balance before outbound dispatch, and post each usage event once. Respect the dealer’s chosen refill amount and monthly cap across channels. A separate low-balance alert and next-action queue let staff continue manually. Run card-save, payment failure, duplicate webhook, refund, cancellation and concurrent refill tests before collecting money.

**Pilot acceptance.** A shopper requests an email about a real stock number, replies to it and reaches one dealership thread. A salesperson takes over; an already-queued automated reply is suppressed. An opted-in text conversation exercises the same handoff. The dealer can reconcile message segments, outbound emails and connected AI seconds to provider records and a mock Whop statement. Live sends and paid billing each require separate dealer activation.
