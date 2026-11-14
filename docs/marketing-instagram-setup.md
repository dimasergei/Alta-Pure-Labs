# AltaPure Marketing — cloud CRM and Instagram connection
Updated: 2026-11-13

## Already implemented
- Marketing tab: persistent creator prospects, manually logged outreach, follow-up dates, draft editor, CSV and JSON backup.
- Server-owned Supabase table `public.ap_marketing_workspaces`; revision checks prevent silent overwrites between browsers.
- Instagram OAuth start and callback via the existing Vercel `/api/customer-config` function (no extra Hobby function).
- Meta-signed inbound Instagram webhook deployed as Supabase Edge Function `alta-instagram-webhook` with `verify_jwt=false`, and raw HMAC signature validation before database writes.
- Encrypted Instagram access tokens; inbox sync; one-at-a-time manual replies to users who already messaged within the supported window.
- No unsolicited bulk DMs, profile scraping, auto-message scheduling, or automatic send on draft generation.

## Required account-side setup (cannot be done without Meta app access)
1. Ensure the AltaPure Instagram account is Professional (Business or Creator). Sign into [Meta Developers](https://developers.facebook.com/apps/) and create/select the Business app with **Instagram API with Instagram Login**.
2. Request `instagram_business_basic` and `instagram_business_manage_messages`; App Review/Advanced Access may be needed for customers outside app roles.
3. Add this exact authorized redirect URL:
   `https://altapurelabs.com/api/instagram/callback`
4. Set in the **Vercel altapurelabs Production environment** (never in public JS or in chat):
   - `INSTAGRAM_APP_ID`: Instagram Login product's client ID
   - `INSTAGRAM_APP_SECRET`: matching Instagram Login product secret
   - Optional: `INSTAGRAM_TOKEN_ENCRYPTION_KEY`: independent random 32-byte hex key. If omitted, the existing `PARTNER_BANK_ENCRYPTION_KEY` is used through domain-separated derivation.
   - Optional: `OPENAI_API_KEY` and `OPENAI_MARKETING_MODEL` for server-side AI drafts.
5. Set in **Supabase Project → Edge Functions → Secrets**:
   - `INSTAGRAM_APP_SECRET` — same Meta Instagram client secret for HMAC signing
   - `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` — a new high-entropy random value you choose.
   - Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Edge runtime.
6. In the Meta app Webhooks config, use callback:
   `https://mqtitxfsdphqbsxhwdma.supabase.co/functions/v1/alta-instagram-webhook`
   and enter the same `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`. Subscribe to `messages` (and `messaging_postbacks` if enabled).
7. Redeploy the Vercel project so the new environment variables are available, open **Marketing → Instagram Inbox → Connect Instagram**, and authorize the Professional account.
8. From a separate Instagram account, message AltaPure to open a conversation. In Marketing, click **Sync inbox**. Test a manual reply in the messaging window. Check status and error logs for the webhook and inbox if messages do not arrive.

## Security
The CRM, OAuth state, IG account, and message tables deny `anon` and `authenticated` direct access; only the server-side service role accesses them. Meta webhook POSTs require a valid `X-Hub-Signature-256` derived from the Meta app secret. OAuth uses one-time 10-minute state records. Access tokens are encrypted at rest with AES-256-GCM.

## Known limits
- Instagram API cannot start unsolicited conversations; sending requires prior inbound messages and relevant platform messaging eligibility.
- AI text generation is inactive without an API key; templates remain available.
- Webhook receives no events until configured and Meta permission subscription is approved.
- CRM uses optimistic locking; concurrent edits from two browsers can produce a visible conflict that requires refresh.
