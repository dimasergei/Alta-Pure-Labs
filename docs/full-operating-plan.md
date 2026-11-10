# AltaPure Labs — complete operating plan and acceptance contract

Review: November 9, 2026 local / November 10 UTC. Baseline: main `0de17a0afad65b0f52195af589c810c2b6556bb0` (storefront overhaul). This is one implementation backlog and release contract, not a series of cosmetic phases.

## 1. Definition of fully operational

A visitor must be able to choose an eligible item, obtain an authoritative price including delivery and applicable taxes, pay through an approved method, receive an accurate confirmation, have the correct quantity and lot allocated, and receive the product with tracking. Staff must be able to reconcile settlement, resolve failures, refund correctly, and recall affected lots. Memberships, recurring orders, points, credit, promotions and partners must operate from durable records and actual approved terms—not UI labels or editable customer metadata.

The full target is not met while checkout is paused, financial programs are only display areas, inventory/quality tables contain no real lots/reports, or supplier handoff is untested. A passing website build does not establish this target. The final gate is the end-to-end evidence in section 10.

## 2. Benchmark and what it does not prove

NeuroLabs' public storefront exposes a catalog, product pages, research builder, bulk ordering, memberships, COA browsing, account features, promotions and contact channels. Those are the appropriate customer-facing feature benchmarks. Its public pages do not establish its private payment acquirer, ledger correctness, supplier integrations, tax setup, profitability or operational reliability. AltaPure should reproduce useful workflows, not presume access to or copy undocumented backend machinery, proprietary content, laboratory claims or unapproved commercial terms.

Primary public benchmark pages reviewed: https://neurolabsresearch.com/ ; /research-builder/ ; /bulk-orders/ ; /memberships/ ; /coas/ . Published prices or benefits on those pages are competitor terms, not approved AltaPure terms.

## 3. Verified starting position

The redesigned storefront and account shell are deployed. The catalog contains 46 product records and 84 exact variants. It has dosage-specific product pages, local cart/favorites/comparison, search, currency-display conversion, English/French/Spanish controls, four-compound research-list planning, bulk quantity estimates, exports, account history/tracking, and document/inquiry surfaces. Research lists save locally and, when authenticated, to customer user metadata; this is nonfinancial planning data.

New Stripe checkout is deliberately retired, with historical signed-event handling preserved. A replacement processor is not yet integrated. Processor inquiries to PeptideApprove and RFG were found in Gmail Sent; this review found no approval reply. Do not send duplicate applications or treat an inquiry as an executed merchant agreement.

Live Supabase inspection found no inventory lot records or quality documents. Catalog entries are not proof of sellable stock. Existing inventory/reservation and COA review infrastructure is partial; it is not connected to a replacement paid-order lifecycle. Rewards and promotions modules include offline simulations, not active financial ledgers. Customer app-metadata display areas do not substitute for transactional balances.

A separate defect was found: shared database calls initialized Stripe even when only the database was needed. That unnecessarily tied accounts and administration to retired payment credentials. The operational release makes Stripe lazy while retaining validation for actual historical payment handlers.

## 4. Implemented in the operational release

### Persistent request workflow

Contact, bulk, partner and update inquiries are validated and stored in `enterprise_customer_requests` before any email attempt. The exact submitted request ID is unique, and a digest prevents reusing that ID for different content. Bulk names, sizes and unit amounts are derived from the server catalog. The browser cannot submit its own accepted price.

The authenticated staff inbox supports status/type filters, 25-record pages, assignment labels, internal audit notes, customer-visible account responses, and page export. Changes lock the row and require the current version; stale staff edits fail instead of silently overwriting another update. A separate append-only event table preserves the workflow history. The existing shared admin password remains the authentication method: a staff label is not independent proof of an individual employee's identity.

Verified customers can view only request status and public responses associated with their authenticated email. Original request payloads, other customers' identities, internal notes and notification metadata are not returned by the customer endpoint.

### Notification recovery

The stored request is authoritative; email is a notification channel. The outbox uses a single leased claim, an immutable message payload and a stable provider idempotency key. Transport failure leaves the request available in the staff inbox. Retries are bounded to five attempts and a 23-hour window, shorter than Resend's documented 24-hour idempotency retention. A timed-out delivery may be uncertain, so the system must not retry indefinitely and accidentally duplicate mail. The admin can retry queued/failed notifications within the safe window. `needs_review` means reconcile the original provider delivery before any resend. This release does not install a scheduled retry worker, bounce handler, campaign platform or SMS service.

`accepted` means the provider accepted the notification; it does not mean the recipient read it or that inbox delivery was proved. Public responses posted through the staff inbox appear in the customer's account; they do not automatically send a separate reply email.

### Operating-readiness evidence

The staff dashboard exposes live aggregate counts, configuration presence and an 18-item acceptance register. Missing/unreadable counts appear as unavailable, not zero. Configuration presence does not prove delivery, payment acceptance, stock accuracy or legal eligibility. The readiness response remains `fully_operational:false` until the full operational conditions have been met and the implementation is updated with evidence.

### Delivery and discoverability

The production build emits an explicit public output directory. Server libraries, migrations, tests, private operating requirements and development files are excluded from static hosting. Product URLs receive unique server-rendered names/descriptions, canonical links and product structured data without invented ratings or purchasable-offer claims. Public navigation routes receive distinct metadata. A sitemap, robots rules and a genuine not-found page are generated. Search-engine indexing and ranking remain separate checks, not guarantees from publishing a sitemap.

## 5. The remaining engineering, organized by dependency

### A. Payments, checkout and order truth

Inputs: actual contracted acquirer/gateway, merchant credentials entered in the provider's secure interface, approved product/country/method scope, settlement currency, reserves/fees, fraud rules, refunds and recurring-billing support. Requested methods—cards, ACH/wire, Zelle, Venmo, Cash App, Interac and BTC—are separate integrations. Implement only methods the actual bank/platform approves; a payout rail is not a customer checkout rail.

Implement a provider-specific hosted-payment adapter, with no card details handled by the application unless its security scope explicitly supports that. A server-created quote must capture catalog version, exact variants, quantities, shipping destination, tax/rate evidence, discount allocations and a short expiry. Browser totals are display only. Recheck eligibility and stock when creating the order.

Use one durable idempotency key per checkout attempt. In a database transaction, create the pending order and its immutable priced lines, reserve stock, and record the attempt. The provider session/intent reference is attached with a unique constraint. Do not hold a database transaction open during a remote payment call. Use a compensating release if session creation fails or expires. A verified webhook or authenticated provider reconciliation, not the return URL, determines payment success.

Store unique `(provider,event_id)` events and process them transactionally. Compare order ID, currency, amount and provider account before applying state. Out-of-order/repeated events must not regress paid/refunded/disputed states or duplicate notifications, allocations, rewards or batches. Reconcile unsettled/uncertain attempts against provider data. Retain historical Stripe handling until prior refunds, disputes and settlements are fully accounted for.

Required states: checkout attempt initiated/session_created/failed/expired; payment pending/authorized/paid/partially_refunded/refunded/disputed; fulfillment unfulfilled/allocated/submitted/acknowledged/partially_shipped/shipped/delivered/canceled. Do not reuse one status field for all three lifecycles.

Acceptance: approved sandbox payment, decline, timeout, duplicate/reordered event, wrong currency/amount, abandoned session, partial refund, full refund and dispute. Then an owner-authorized low-value live purchase/refund with processor-settlement reconciliation. No replacement adapter or live paid flow is delivered merely by this operational-request release.

### B. Supplier, stock, delivery and quality

Inputs: legal supplier identity, written dropship terms, cost by exact SKU, handling/pack fees, neutral/AltaPure branding, origin/site, carrier services, packaging/temperature requirements, shipping costs, cutoffs, stock source, substitutions, returns, damage claims and recall contact. The current catalog must be reconciled against the supplier's available variants; a pricing sheet is not inventory or a COA.

Load real lots into quarantine with traceable supplier evidence. Release only reviewed stock. Connect atomic reserve/commit/release to pending/paid/canceled orders. On-hand, available, allocated, shipped, damaged and recalled quantities must be distinguishable. Link each fulfilled line to its actual lot and supplier cost snapshot. Test concurrent last-unit purchases and cancellation after partial shipment.

Convert eligible paid allocations into one supplier order/batch with a unique submission key. A generated PDF is not supplier acceptance. Record transmitted/acknowledged/rejected states, supplier order ID, tracking and exceptions. For a manual supplier, use a logged human acknowledgment step rather than pretend an API exists. Supplier API/CSV/email mode is chosen only after confirming its actual supported interface.

Obtain real reports, verify laboratory/report/lot identity and retain the evidence. COA publication requires named reviewer accountability and a synchronized publish/revoke path. A withdrawn database record must not remain in a static public JSON registry. Add lot recall -> affected order lookup -> holds -> contact case workflow. No report should be generated to fill the empty library.

Shipping must be priced for each supported route using real origin/service/rate or carrier quotes, with address validation and packaging limits. Specify who is importer of record and who pays duties/taxes. Start with reviewed destinations, expand route coverage without altering existing order terms. Currency display is not settlement currency or shipping eligibility.

Acceptance: one approved paid order is allocated to a real lot, acknowledged by the supplier, shipped with valid carrier tracking and reconciled to cost; an out-of-stock and a recall case are handled without overselling or losing traceability.

### C. Commercial programs and financial ledgers

Owner-approved terms are still required. Do not silently copy competitor prices, award rates, renewal promises, free products or commission obligations.

**Memberships:** versioned plan catalog, billed interval, terms acceptance, provider subscription ID, entitlements and current period. Implement pending/active/past_due/canceled/expired/refunded transitions from verified provider events. Access is enforced by backend entitlement checks. Proration, grace period, cancellation timing and refund consequences must be explicit.

**Product subscriptions:** turn a saved list into a separate explicit purchase agreement with fixed/variable price policy, cadence, stock handling, advance notice, skip/pause/change/cancel controls and renewed permission where required. Every cycle has a unique billing-period key, one payment attempt and one order. Failed payment creates no paid fulfillment; unavailable stock cannot silently substitute another compound.

**Points and credit:** use durable accounts plus immutable event ledgers, not JWT/user metadata as the balance source. Lock the account when redeeming; record holds/debits atomically; never allow concurrent requests to overspend. Link earns and reversals to unique order/event lines. Rules cover excluded amounts, shipping/tax treatment, expiry, promotional versus purchased credit, partial returns and negative-balance policy. Customer display is a projection of issued events.

**Promotions and bulk quotes:** versioned rules with approved dates, scope, minimum quantities/spend, stacking priority, usage caps and discount allocation by line. Reserve usage counts atomically. Free gifts consume real stock. A bulk request becomes a versioned staff quote with currency, expiry, shipping/tax assumptions and customer acceptance, then revalidated checkout—not a request silently treated as an order.

**Partners:** approved applications, unique referral identity, consent-aware attribution, self-referral/fraud checks, commission basis, hold period, refund/chargeback reversals and verified payouts. A click or email inquiry does not create a commission. Payouts require a ledger and approval/reconciliation flow.

Acceptance: duplicate payment events cannot double-grant entitlements or points; two simultaneous redemptions cannot overspend; cancellation changes the correct next cycle; partial refunds reverse only attributable value; commissions never mature on a refunded/disputed order; paid plan terms are displayed before consent.

### D. Communications, support, accounting and resilience

Verify sending-domain authentication and real recipient delivery with an authorized recipient. Add provider delivery/bounce/complaint webhook handling and suppression. Separate transactional messages from marketing consent; an inquiry consent does not authorize general campaigns. Email/SMS campaigns require purpose/channel-specific opt-in, unsubscribe and suppression handling. The updates request currently captures interest; it is not a complete newsletter platform. Do not launch abandoned-cart emails without the relevant consent and purpose review.

Connect support cases to actual order/payment/shipment records. Staff refunds call the selected provider and reconcile the resulting event; clicking Resolved is not a financial refund. Add attachments only with private storage, size/type controls and authorized access. Define privacy export/deletion, retention, consent withdrawal and legal-hold handling, with tested redaction of personal data from logs.

Confirm seller-of-record identity, settlement account, invoice fields and applicable tax collection/remittance requirements with the appropriate business advisers. Integrate a suitable tax engine or a documented jurisdiction-specific calculation after those obligations are established. No blanket 0% tax assumption. Reconcile gross sales, fees, reserves, refunds, taxes, shipping, supplier costs and payouts; daily processor reconciliation is separate from order count.

Introduce individual staff authentication/roles and privileged-operation auditing instead of relying indefinitely on a shared password. Scope access by actual duties. Review recovery/email verification, secret rotation, session expiry and deployment permissions. Keep test fixtures isolated and do not weaken production authentication for screenshots.

Define backups, restore procedure and verified recovery targets. Test restoration in isolation. Add actionable alert ownership for unpaid fulfillment, paid/unrecorded orders, repeated webhook failures, stuck reservations, missing supplier acknowledgments, notification failures, disputes and stock-feed staleness. Use a supported scheduled worker on the selected hosting plan; request-triggered processing alone is not reliable periodic reconciliation.

## 6. Business input checklist — exact missing values

| Decision | Required record | Owner |
|---|---|---|
| Merchant | Contracted gateway/acquirer, exact accepted SKUs/countries/methods, secure sandbox/live credentials, fees/reserves, settlement and recurring/refund support | Owner + processor |
| Seller | Final seller-of-record entity, invoicing identity, settlement account, registrations and tax treatment | Owner + accountant/adviser |
| Supplier | Legal name, fulfillment origin/site, signed dropship terms, exact SKU costs/stock/lot/COA evidence, submission and tracking mechanism | Owner + supplier |
| Shipping | Allowed route/product matrix, rates/weight brackets, packaging, duties responsibility, returns and temperature constraints | Owner + carrier/supplier |
| Membership | Plan names, prices/currency, interval, actual benefits, renewal/cancellation/proration/refund policy | Owner |
| Rewards/credit | Earn basis/rate, redemption value, caps/minimums, exclusions, expiry, reversal and negative-balance rules | Owner |
| Promotions | BOGO/free-gift/free-shipping thresholds, eligible SKUs, stacking limits, inventory and margin approval | Owner |
| Affiliate | Attribution window, commission basis/rate, hold period, return reversals, payout minimum/cadence and approved payout method | Owner |
| Operations | Staff roles, support owner/response target, retention periods, backup recovery targets and alert destination | Owner |

Missing values are unconfigured—not permission to invent them. Private contracts, banking details and owner identity documents must not be committed to this public repository.

## 7. Single dependency order

Continue engineering and business onboarding in parallel. The concrete critical path is:

`merchant acceptance + real supplier/route terms -> payment adapter + authoritative quote -> order/reservation/event transactions -> fulfillment acknowledgment/tracking -> refund/settlement reconciliation -> live acceptance test`.

In parallel, owner-approved program terms unlock memberships/subscriptions/rewards/promotions/affiliates. These share the payment and order-event foundation rather than each implementing their own payment truth. Inquiry operations, account isolation, public build delivery and SEO do not need to wait for acquiring approval and are implemented in this release.

This is an execution dependency graph, not a request to approve a new mini-phase for every change. One consolidated release may include all independently verified work; money movement and customer promises cannot be activated before their real inputs exist.

## 8. Proposed durable schema for unfinished financial work

The request tables in this release are implemented. The following are **proposed, not deployed by this release**: `commerce_quotes` and quote lines; `payment_attempts`; provider-scoped `payment_events`; `order_allocations`; supplier submissions/acknowledgments; shipment records; versioned membership plans and customer terms acceptance; subscriptions and billing cycles; wallet accounts and ledger events; promotion rules and reservations; referral attributions, commission events and payout batches; reconciliation runs and exception records.

Use integer minor currency units, explicit currency codes and immutable snapshots. Uniqueness belongs in the database, not only JavaScript. Every financial command needs an idempotency key, a row-lock/transaction strategy, tested failure behavior and an audit trail. Every mutable staff record needs a version/concurrency check. Customer reads derive identity from validated sessions and constrain all returned rows to that identity.

## 9. Operational runbook for the delivered request system

Open `/admin-operations.html` with the existing admin password. Passwords remain in memory, not browser storage. New requests are durable and initially New. Assign a staff label, move to In review/Waiting for customer/Resolved/Spam, and enter an internal audit note for each change. Public responses are visible under `/account/requests` to the verified email owner. Use the explicit email-reply link for a separate email response.

For notification Failed/Queued, retry from the request detail. Accepted means the email service accepted it. Sending may be a worker lease or an uncertain completion; wait until the lease expires before retry. Needs review blocks automatic retries after the attempt/time limit; check the provider's original message status first. Do not create a new request merely to force another email. Existing pre-release emails are not automatically imported into this inbox.

Readiness displays live counts and a finite requirements register. A green-looking page does not grant stock, approval or revenue. Missing counts are Unknown. The register does not autonomously update contractual facts or continuously monitor inbox replies. Those facts need evidence updates and recurring checks only when explicitly configured.

Rollback: retain the previous production deployment. A code rollback leaves the additive request tables/data intact. Do not drop the tables to revert a UI change. If a request submit path is unavailable, keep its recovery email visible. Back up and export new records before any future schema reversal.

## 10. Release/launch acceptance matrix

| Workflow | Required evidence before full operation |
|---|---|
| Customer authentication | Real email/password and Google flows, recovery, verified identity, expiry, cross-account denial |
| Request handling | Stored before email; duplicate ID one record; mail failure recovery; staff version conflict; own-email history; no private-note leakage |
| Pricing | Server catalog matches variants; stale quote rejected; shipping/tax/discount rounding deterministic |
| Payment | Approved sandbox + owner-authorized live transaction; signed/replayed/out-of-order events; mismatch rejection; settlement reconciliation |
| Stock | Real lot loaded/released; last-unit race; reservation expiry; partial shipment and cancellation |
| Fulfillment | Supplier accepts exactly once; stock exception; valid tracking; delivered or documented exception |
| Returns/refunds | Partial and full refund, provider confirmation, inventory disposition, tax/rewards/commission reversal |
| Membership/subscription | Actual agreed price and consent; renewal, decline, dunning, skip/pause/cancel, expiry; one order per successful cycle |
| Rewards/credit | Immutable issuance; concurrent redemption; refund/expiry; no metadata-based spending authority |
| Promotions/partners | Actual approved rules; usage concurrency; gift stock; attribution, refund reversal and payout reconciliation |
| Quality | Authentic lot report; accountable publish/revoke; affected-order recall lookup |
| Messaging/privacy | Domain/delivery confirmation; bounce/suppression; purpose-specific opt-in; unsubscribe; export/deletion retention |
| Reliability | Automated isolated CI; production read-only smoke; backups restored; alert ownership; supported reconciler job |
| Discovery/accessibility | Crawlable product pages/sitemap; proper404; keyboard/mobile checks; internal source absent from static output |

Full operation requires evidence for every enabled customer promise. Items intentionally not sold or offered can be absent, but full NeuroLabs-style program parity requires implementing and testing those programs—not labeling their tabs as complete.

## 11. Sources and implementation evidence

Repository source and live aggregate database inspection are the evidence for AltaPure's current state. Confirm final commit, migration history, CI result and deployment in the release report. Source references consulted for design:
- NeuroLabs public pages listed in section2; private backend is unknown.
- https://supabase.com/docs/guides/database/functions — function security and scoped execution grants.
- https://supabase.com/docs/guides/database/postgres/row-level-security — table privileges and row access.
- https://supabase.com/changelog — current tooling changes; CLI3.1.0 was inspected before generating the new migration locally.
- https://resend.com/docs/api-reference/emails/send-email — send request contract.
- https://resend.com/docs/dashboard/emails/idempotency-keys — 24-hour key retention; do not retry uncertain mail beyond that window without reconciliation.

This plan does not report unfinished adapters or external approvals as completed. Financial and fulfillment integration remains substantive engineering work after the required real inputs are available.
