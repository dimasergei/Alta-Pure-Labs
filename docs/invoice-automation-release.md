# Invoice automation release

## Delivered behavior
New invoice events queue transactional mail atomically with the invoice audit event. Customers receive request acknowledgment, issued invoice, recorded payment/refund and order-status/tracking messages. Staff receive new-request and customer-acceptance alerts. No marketing opt-in or campaign is created. The existing validated financial command commits independently; a mail outage never marks or unmarks an invoice paid.

Queued mail uses the configured Resend transport and sender. Each event/audience has one stable idempotency key and immutable email envelope. Claims are leased, retries limited to five attempts and a23-hour window, and obsolete requests to pay an expired/void/paid invoice are suppressed or held. Accepted means provider acceptance, not recipient delivery/read.

The private payment desk includes Activation & automatic emails: actual receiving-method count, transport/team configuration presence, retry-worker configuration and recent message states. It identifies missing owner inputs. No credentials or receiving instructions are exposed in the panel response or in notification emails. Payment instructions remain inside the authenticated customer invoice page.

## Scheduled recovery
Supabase Cron invokes the fixed notification-only worker every10 minutes when eligible queued work exists. Empty queues do not generate HTTP traffic. Its secret is stored in Vercel sensitive production configuration and Supabase Vault, not in code.

Deployment verification discovered that the hosted pg_net extension retained platform-owned public queue grants despite ordinary revocation attempts. The worker was changed before release: no reusable bearer secret enters that queue. Each request contains a scoped HMAC signature, a60-second timestamp and a single-use nonce, which the backend consumes atomically. The signing key stays in Vault/server configuration. Reading an expired/replayed job proof cannot authorize a new job, and this endpoint cannot record payments.

Applied migration versions:20261110061306_invoice_notification_outbox;20261110061350_invoice_notification_schedule;20261110061802_signed_invoice_worker. Source filenames match remote history. No invoice, payment, receiver or historical notification was seeded or backfilled.

## Tests
178 Node tests passed; the production build passed. Disposable PostgreSQL17 verified outbox creation in the invoice transaction, no historical backfill, replay uniqueness, recipient matching, leased claims, immutable retries, expired idempotency window, nonce replay/expiry and role restrictions. Six isolated browser checks passed for activation prompts, in-memory credential handling, recovery button, mobile width and logout. Positive sender/authentication tests used isolated fixtures. Live worker and production route checks are recorded on the release PR after deployment.

## Owner-only inputs remaining
Enter a real permitted business receiving route in /admin-payments.html: bank-confirmed Interac receiving email and exact registered payee, bank-issued incoming-transfer instructions, or an already-approved provider-hosted payment route. A support email is not assumed to be a payment address. Native card integration still requires actual underwriting/merchant setup, secure provider credentials and an authorized funds-receipt test.

The hosting team was reported as Hobby. Vercel's published Hobby terms are for non-commercial personal use. The owner must approve a commercial hosting plan/billing arrangement before commercial operation; this release does not purchase an upgrade or claim free commercial hosting permission. Source: https://vercel.com/docs/plans/hobby .

## Limits and rollback
No new payment processor, receiving account, direct bank monitoring, recurring billing, merchant contract, supplier connector or real payment was activated. Manual receipt verification and manual fulfillment remain the intended model. The previous production deployment remains a code rollback candidate. Disable the named retry cron job before reverting worker code, and retain invoice/event/outbox records. Do not drop financial records during rollback.
