#!/usr/bin/env bash
set -euo pipefail
# Run only against the disposable CI PostgreSQL service after the SQL fixture.
export PGPASSWORD="${PGPASSWORD:-postgres}"
args=(-X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5434 -U postgres -d postgres)
psql "${args[@]}" -c "update public.enterprise_inventory_lots set on_hand=8, reserved=7, damaged=0 where lot_number='FIXTURE-LOT-1';"
set +e
psql "${args[@]}" -c "select public.enterprise_reserve_inventory(id,1,'fixture-race-a-0001','fixture-race') from public.enterprise_inventory_lots where lot_number='FIXTURE-LOT-1';" > /tmp/alta-race-a.log 2>&1 &
pid_a=$!
psql "${args[@]}" -c "select public.enterprise_reserve_inventory(id,1,'fixture-race-b-0001','fixture-race') from public.enterprise_inventory_lots where lot_number='FIXTURE-LOT-1';" > /tmp/alta-race-b.log 2>&1 &
pid_b=$!
wait "$pid_a"; status_a=$?
wait "$pid_b"; status_b=$?
set -e
successes=0
[[ "$status_a" -eq 0 ]] && successes=$((successes+1))
[[ "$status_b" -eq 0 ]] && successes=$((successes+1))
if [[ "$successes" -ne 1 ]]; then
  echo "Expected exactly one successful concurrent reservation; observed $successes" >&2
  cat /tmp/alta-race-a.log /tmp/alta-race-b.log >&2
  exit 1
fi
remaining=$(psql "${args[@]}" -tAc "select on_hand-reserved-damaged from public.enterprise_inventory_lots where lot_number='FIXTURE-LOT-1';")
reserved=$(psql "${args[@]}" -tAc "select reserved from public.enterprise_inventory_lots where lot_number='FIXTURE-LOT-1';")
if [[ "$remaining" != "0" || "$reserved" != "8" ]]; then
  echo "Concurrent reservations corrupted inventory: reserved=$reserved remaining=$remaining" >&2
  exit 1
fi
echo "PASS: one of two concurrent reservations succeeded, no oversell."
