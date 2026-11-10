# Operational release verification

## Scope
Persistent request operations, customer history, notification recovery, Stripe-independent database access, a private operating-readiness register, public-only build output and crawlable product metadata. This release does not enable payment capture or fulfill the remaining financial/fulfillment program acceptance criteria in `full-operating-plan.md`.

## Completed pre-release checks
- 153 Node tests passed, including all pre-existing regression tests.
- Full production build passed; 46 product pages and 58 canonical sitemap URLs generated.
- Disposable PostgreSQL17 exercised duplicate submissions, content-ID conflicts, delivery leases, accepted-event replay, wrong-worker completion denial, five-attempt limit, expired idempotency window, version conflicts, service-only function grants and denied direct writes.
- Two concurrent PostgreSQL sessions competed for one notification: exactly one claim succeeded and the attempt count remained one.
- Eight browser groups passed with zero JavaScript errors: admin inbox/update/audit, retry/filter/export, readiness Unknown state, own-account request responses, durable contact success with queued notification, static metadata/output exclusion, mobile layout/logout, and JavaScript-error check.
- Browser authentication, request and mail transport were isolated fixtures. No real email or production account/request/order record was created for these tests.
- Both GitHub workflows passed on pre-release commit `34f6b9db49c876be5c69001af39f7315d905147f`.

## Database release
The locally generated migration was applied using Supabase's migration action. Supabase assigned remote version `20261110025900`; the repository filename is reconciled to that exact history version. SQL blob content remains unchanged from the tested generated migration.

Read-only production verification confirmed both new tables have RLS enabled, no anon/authenticated SELECT access, service_role SELECT but no direct INSERT/UPDATE/DELETE, and four functions executable only by the service role rather than browser roles. All four have a fixed `pg_catalog, pg_temp` search_path. Both new tables contained zero rows immediately after migration.

Supabase's advisor reported informational RLS-without-policy entries (expected for deliberately service-only tables). The pre-existing leaked-password-protection warning remains; this release does not alter Auth settings or paid-plan features.

## Limits
Provider acceptance is not inbox-delivery proof. No replacement payment, recurring billing, monetary wallet, commission payout, supplier shipment or production customer submission was tested or claimed. Positive admin/customer browser tests used isolated fixtures; deployment smoke tests are separate. Full operational acceptance remains governed by the operating plan.
