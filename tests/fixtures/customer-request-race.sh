#!/usr/bin/env bash
set -euo pipefail
# Disposable PostgreSQL only, after customer-request-operations-checks.sql.
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "${PGHOST:-127.0.0.1}" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
"${PSQL[@]}" -c "SELECT public.enterprise_submit_customer_request('10000000-0000-4000-8000-000000000003',repeat('c',64),'{\"type\":\"contact\",\"name\":\"Concurrency fixture\",\"email\":\"race@example.test\",\"consent\":true,\"message\":\"Isolated concurrency test\"}'::jsonb,'{\"text\":\"fixture only\"}'::jsonb)" >/dev/null
"${PSQL[@]}" -Atc "BEGIN; SET ROLE service_role; SELECT public.enterprise_claim_request_email('10000000-0000-4000-8000-000000000003',null)->>'claimed'; SELECT pg_sleep(1); COMMIT;" >"$tmp/a" &
a=$!
"${PSQL[@]}" -Atc "BEGIN; SET ROLE service_role; SELECT public.enterprise_claim_request_email('10000000-0000-4000-8000-000000000003',null)->>'claimed'; SELECT pg_sleep(1); COMMIT;" >"$tmp/b" &
b=$!
wait "$a"; wait "$b"
true_count=$(cat "$tmp/a" "$tmp/b" | grep -c '^true$' || true)
false_count=$(cat "$tmp/a" "$tmp/b" | grep -c '^false$' || true)
[[ "$true_count" = 1 && "$false_count" = 1 ]]
"${PSQL[@]}" -c "DO \$\$ BEGIN IF (SELECT email_attempts FROM public.enterprise_customer_requests WHERE id='10000000-0000-4000-8000-000000000003')<>1 THEN RAISE EXCEPTION 'Concurrent duplicate send claim'; END IF; END \$\$;" >/dev/null
echo customer_request_concurrent_claim_passed
