#!/usr/bin/env bash
# PURE retired integration Vercel cleanup. Run from the OWNER's linked Vercel
# directory (for example ~/Desktop/PURE-handoff), never from a random project.
# Dry-run by default; only --apply deletes variables.
set -euo pipefail
mode="${1:---dry-run}"
if [[ "$mode" != "--dry-run" && "$mode" != "--apply" ]]; then
  echo "Usage: $0 [--dry-run|--apply]" >&2
  exit 2
fi

expected_org='team_s50SCcocFvyWNRtyVdUs0raT'
expected_project='prj_V7iL1s1QyiPn6kqMBvdRgAuflcvg'
if [[ ! -f .vercel/project.json ]]; then
  echo "STOP: run from the directory linked to Vercel's existing PURE project." >&2
  exit 1
fi
node -e '
 const fs=require("node:fs");
 const p=JSON.parse(fs.readFileSync(".vercel/project.json","utf8"));
 if(p.orgId!==process.argv[1] || p.projectId!==process.argv[2]){
   console.error("STOP: linked Vercel project/team does not match PURE.");
   process.exit(1);
 }
' "$expected_org" "$expected_project"
command -v vercel >/dev/null || { echo "STOP: Vercel CLI is not installed." >&2; exit 1; }

# Pull to a private temporary file only for the three NONSECRET on/off flags.
# This never prints or uploads credentials; Vercel's sensitive values remain
# placeholders. The temporary file is removed on exit.
umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
vercel env pull "$tmp" --environment=production --yes >/dev/null
node -e '
 const fs=require("node:fs"),source=fs.readFileSync(process.argv[1],"utf8");
 for(const key of ["LOTUS_FULFILLMENT_ENABLED","PEPTIDEPAY_ENABLED","TAGADA_ENABLED"]){
   const m=source.match(new RegExp("^"+key+"=(.*)$","m"));
   const value=m?m[1].trim().replace(/^[\x22\x27]|[\x22\x27]$/g,""):"";
   if(value!=="false"){console.error("STOP: "+key+" is not confirmed disabled. No deletion performed.");process.exit(1);}
 }
' "$tmp"

retired_production=(
  LOTUS_FULFILLMENT_ENABLED LOTUS_PARTNER_API_KEY
  PEPTIDEPAY_API_KEY PEPTIDEPAY_WEBHOOK_SECRET PEPTIDEPAY_WALLET_ADDRESS
  PEPTIDEPAY_CURRENCIES PEPTIDEPAY_MODE PEPTIDEPAY_ENABLED PEPTIDEPAY_VERIFIED
  TAGADA_API_KEY TAGADA_STORE_ID TAGADA_ENABLED
)
protected=(
  RAMPEX_ENABLED RAMPEX_API_KEY RAMPEX_WEBHOOK_SECRET
  POLYGON_USDC_ENABLED POLYGON_USDC_RECIPIENT
  POLYGON_USDC_RPC_URL POLYGON_USDC_SECONDARY_RPC_URL
  SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
  RESEND_API_KEY SHIPPO_API_TOKEN SITE_URL
)
inventory="$(vercel env ls production 2>&1)"
for key in "${protected[@]}"; do
  if ! grep -Eq "(^|[[:space:]])${key}([[:space:]]|$)" <<< "$inventory"; then
    echo "STOP: protected variable ${key} is absent from the production listing." >&2
    exit 1
  fi
done

echo "Verified: correct PURE project; retired flags are false; protected keys are listed."
echo "No code, database tables, payment methods, Stripe keys, or domains will be changed."
printf 'Production variables to remove:\n'
printf '  %s\n' "${retired_production[@]}"
echo "Preview variable to remove: LOTUS_PARTNER_API_KEY"
if [[ "$mode" == "--dry-run" ]]; then
  echo "DRY RUN ONLY. After the regression-test/preview approval, rerun with --apply."
  exit 0
fi

echo "WARNING: Deleted sensitive Vercel values may be unrecoverable."
read -r -p 'Type REMOVE RETIRED ONLY to proceed: ' confirmation
if [[ "$confirmation" != "REMOVE RETIRED ONLY" ]]; then
  echo "Canceled; no variables deleted."
  exit 1
fi

for key in "${retired_production[@]}"; do
  echo "Removing retired production key: $key"
  vercel env rm "$key" production --yes
done
echo "Removing preview-only Lotus partner key"
vercel env rm LOTUS_PARTNER_API_KEY preview --yes
echo "Requested removals completed; now check the listing and redeploy safely after testing."
vercel env ls production
