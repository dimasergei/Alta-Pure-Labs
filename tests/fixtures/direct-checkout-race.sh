#!/usr/bin/env bash
set -euo pipefail
# Disposable CI PostgreSQL only. Competing checkouts cannot overspend one account.
db=(psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d postgres)
"${db[@]}" <<'SQL'
set role service_role;
select public.commerce_admin_command('save_method','{"id":"d0000000-0000-4000-8000-000000000001","version":0,"kind":"bank_transfer","label":"Race fixture bank","currency":"USD","payee":"Fixture only","instructions":"Disposable fixture instructions","acceptance_reference":"Isolated race fixture","active":true,"business_confirmed":true,"catalog_accepted":true}', 'race-fixture-admin');
select public.commerce_issue_credit('d0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000002',5000,'Isolated race credit','race-fixture-admin');
SQL
run_checkout(){
 "${db[@]}" -c "set role service_role; select public.commerce_place_checkout(jsonb_build_object('id','$1','customer_id','d0000000-0000-4000-8000-000000000002','customer_email','race@example.test','customer_name','Race fixture','kind','goods','digest',repeat('e',64),'request',jsonb_build_object('items','[]'::jsonb,'address',jsonb_build_object('country','US')),'consent',true,'terms_version','launch-2026-11-v1','checkout_version','checkout-2026-11-v1','currency','USD','method_id','d0000000-0000-4000-8000-000000000001','method_version',1,'subtotal_cents',10000,'discount_cents',500,'shipping_cents',2500,'tax_cents',0,'total_cents',8000,'points_redeemed',0,'credit_redeemed_cents',4000,'earned_points',55,'pricing','{}'::jsonb,'membership_invoice_id',null));"
}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
run_checkout d0000000-0000-4000-8000-000000000004 >"$tmp/one" 2>&1 & one=$!
run_checkout d0000000-0000-4000-8000-000000000005 >"$tmp/two" 2>&1 & two=$!
successes=0
if wait "$one"; then successes=$((successes+1)); fi
if wait "$two"; then successes=$((successes+1)); fi
if [ "$successes" -ne 1 ]; then cat "$tmp/one" "$tmp/two"; exit 1; fi
"${db[@]}" <<'SQL'
do $$ begin
 if (select credit_cents from public.commerce_balance_accounts where customer_id='d0000000-0000-4000-8000-000000000002')<>1000
 or (select count(*) from public.commerce_invoices where customer_id='d0000000-0000-4000-8000-000000000002')<>1 then raise exception 'Concurrent checkout overspent or duplicated'; end if;
end $$;
SQL
echo 'Concurrent account redemption passed'
