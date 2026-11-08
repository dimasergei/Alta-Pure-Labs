# AltaPure Labs — Store Setup

This project includes a research-use catalog, Stripe test checkout, Supabase order storage, and Resend order emails.

## Important

This build is configured for **Stripe test mode only**. It accepts only a Stripe secret key beginning with `sk_test_`.

Do not use real customer payment details during testing.

## 1. Install and run locally

```sh
npm install
npm run build
npx serve . -l 3000
```

Open:

```text
http://localhost:3000
```

Run catalog checks:

```sh
node --test tests/catalog.test.cjs
```

## 2. Supabase setup

In the Supabase SQL Editor, run:

```text
supabase/payment-webhook.sql
```

This creates or replaces the `apply_store_checkout_event` function. It verifies payment amounts, saves shipping details, marks paid orders, records processed Stripe events, and prevents duplicate webhook processing.

## 3. Vercel environment variables

In **Vercel → Project → Settings → Environment Variables**, add:

```text
CHECKOUT_ENABLED=true
```

```text
SITE_URL=[https://altapurelabs.vercel.app](https://altapurelabs.vercel.app)
```

```text
SHIPPING_FLAT_RATE_CENTS=2500
```

```text
STRIPE_SECRET_KEY=sk_test_your_stripe_test_secret_key
```

```text
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_signing_secret
```

```text
SUPABASE_URL=[https://your-project-ref.supabase.co](https://your-project-ref.supabase.co)
```

```text
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

```text
RESEND_API_KEY=re_your_resend_api_key
```

```text
ORDER_CONFIRMATION_FROM=AltaPure Labs <orders@altapurelabs.com>
```

```text
ADMIN_ORDER_EMAIL=altapurelabs@protonmail.com
```

Use your verified sending domain in `ORDER_CONFIRMATION_FROM`. Do not use `@protonmail.com` as the sending address unless that domain is verified in Resend.

## 4. Stripe webhook

In Stripe test mode, create a webhook endpoint:

```text
[https://altapurelabs.vercel.app/api/stripe-webhook](https://altapurelabs.vercel.app/api/stripe-webhook)
```

Select these events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

Copy the endpoint’s signing secret, beginning with `whsec_`, into:

```text
STRIPE_WEBHOOK_SECRET
```

Then redeploy the Vercel project.

## 5. Resend setup

1. Verify your sending domain in Resend.
2. Create a Resend API key.
3. Add the API key to Vercel as `RESEND_API_KEY`.
4. Set `ORDER_CONFIRMATION_FROM` to an address on the verified domain.

The webhook sends:

- A customer confirmation email.
- An internal new-order notification to `ADMIN_ORDER_EMAIL`.

## 6. Test an order

1. Open the site.
2. Add a product to the cart.
3. Complete the required name, email, organization, and research-use confirmation.
4. Start checkout.
5. Confirm Stripe shows USD, the correct item price, and $25 shipping.
6. Use Stripe’s test card:

```text
4242 4242 4242 4242
```

Use any future expiration date and any three-digit CVC.

7. Complete the test payment.
8. Return to the confirmation page.
9. Wait for the page to display **Payment successful**.
10. Check Stripe webhook logs for an HTTP 200 response.
11. Check Supabase:

```text
store_orders
```

The order should show:

```text
payment_status = paid
```

Check:

```text
store_order_items
```

It should contain the correct products, sizes, and quantities.

12. Check both the customer inbox and `altapurelabs@protonmail.com` for confirmation emails.

## 7. What the webhook does

When Stripe sends a successful payment event, the webhook:

- Verifies the Stripe signature.
- Checks whether the event has already been processed.
- Updates the order in Supabase.
- Saves the shipping name and address.
- Retrieves the order and line items.
- Sends the customer confirmation email.
- Sends the admin notification email.
- Returns HTTP 200 to Stripe.

## 8. Troubleshooting

### Checkout returns 500

Check Vercel function logs and confirm:

- `CHECKOUT_ENABLED` is `true`.
- `STRIPE_SECRET_KEY` begins with `sk_test_`.
- Supabase URL and service-role key are set.
- The catalog build completed successfully.

### Webhook returns 400

Check that:

- The webhook URL is correct.
- The webhook is in the same Stripe test account as the API key.
- `STRIPE_WEBHOOK_SECRET` is the endpoint-specific `whsec_` secret.
- The Vercel project was redeployed after adding the secret.

### Webhook returns 500

Check that:

- `supabase/payment-webhook.sql` was run.
- The order exists in `store_orders`.
- The Stripe session amount matches the Supabase order total.
- Shipping is exactly 2500 cents.
- A US shipping address was provided.

### No email arrives

Check Vercel logs for:

```text
RESEND_API_KEY is missing
```

or:

```text
Resend email failed
```

Confirm that:

- `RESEND_API_KEY` is set.
- `ORDER_CONFIRMATION_FROM` uses your verified domain.
- The customer email address is valid.
- The email is not in spam.

## 9. Production readiness

Before accepting live payments, complete separate business, legal, payment-processor, and fulfillment review. This technical integration does not by itself establish product authorization, shipping eligibility, tax compliance, refund handling, inventory controls, or institutional-buyer approval.
