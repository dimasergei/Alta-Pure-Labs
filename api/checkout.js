const { randomUUID } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { clients, checked } = require('../lib/backend');
const {
  configuredOrigin,
  parseBody,
  enforceRateLimit
} = require('../lib/checkout-security');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST.' });
  }

  try {
    const site = configuredOrigin(process.env.SITE_URL);

    if (process.env.CHECKOUT_ENABLED !== 'true') {
      return res.status(503).json({
        error: 'Test checkout is temporarily unavailable.'
      });
    }

    if (req.headers.origin !== site) {
      return res.status(403).json({ error: 'Origin not allowed.' });
    }

    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return res.status(415).json({ error: 'JSON required.' });
    }

    const body = parseBody(req.body);
    const b = body;

    const fail = (msg) => {
      const e = new Error(msg);
      e.validation = true;
      throw e;
    };

    if (!b || !Array.isArray(b.items) || !b.items.length || b.items.length > 100) {
      fail('Invalid cart.');
    }

    if (b.research !== true) {
      fail('Research confirmation required.');
    }

    for (const key of ['name', 'email', 'org']) {
      if (typeof b[key] !== 'string' || !b[key].trim() || b[key].length > 254) {
        fail('Name, email and organization are required.');
      }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) {
      fail('Invalid email.');
    }

    const { stripe, db } = clients();
    const authorization=req.headers.authorization||'';
    const token=/^Bearer ([A-Za-z0-9._~-]{20,8192})$/.exec(authorization);
    if(authorization&&!token)return res.status(401).json({error:'Sign in again to continue checkout.'});
    if(token){const {data,error}=await db.auth.getUser(token[1]);const email=data?.user?.email;if(error||!data?.user||!email||!data.user.email_confirmed_at)return res.status(401).json({error:'Sign in again to continue checkout.'});b.email=email.trim().toLowerCase();b.name=String(data.user.user_metadata?.full_name||b.name).trim();}else{b.email=b.email.trim().toLowerCase();}

    await enforceRateLimit(
      db,
      b.email,
      process.env.CHECKOUT_RATE_LIMIT_SECRET
    );

    const catalog = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'lib/catalog.json'), 'utf8')
    );

    const seen = new Set();

    const items = b.items.map((line) => {
      const product = catalog.find((item) => item.id === line.id);
      const variant = product?.variants.find((item) => item.size === line.size);

      if (
        !variant ||
        !Number.isSafeInteger(line.qty) ||
        line.qty < 1 ||
        line.qty > 100
      ) {
        fail('Invalid product, size or quantity.');
      }

      const lineKey = `${product.id}:${variant.size}`;

      if (seen.has(lineKey)) {
        fail('Duplicate cart lines.');
      }

      seen.add(lineKey);

      return {
        product_id: product.id,
        product_name: product.name,
        variant_size: variant.size,
        quantity: line.qty,
        unit_price_cents: Math.round(variant.price * 100)
      };
    });

    const shipping = Number(process.env.SHIPPING_FLAT_RATE_CENTS);

    if (shipping !== 2500) {
      throw new Error('Shipping must be configured as 2500 cents.');
    }

    const subtotal = items.reduce(
      (total, item) => total + item.quantity * item.unit_price_cents,
      0
    );

    if (subtotal + shipping > 99999999) {
      fail('Order exceeds checkout limit.');
    }

    const orderId = randomUUID();
    const orderNumber = await createOrderNumber(db);

    checked(
      await db.from('store_orders').insert({
        id: orderId,
        order_number: orderNumber,
        customer_email: b.email.trim(),
        customer_name: b.name.trim(),
        organization: b.org.trim(),
        currency: 'usd',
        subtotal_cents: subtotal,
        shipping_cents: shipping,
        total_cents: subtotal + shipping,
        research_confirmation_at: new Date().toISOString()
      })
    );

    checked(
      await db.from('store_order_items').insert(
        items.map((item) => ({
          ...item,
          order_id: orderId
        }))
      )
    );

    const session = await stripe.checkout.sessions.create(
      {
        adaptive_pricing: { enabled: false },
        mode: 'payment',
        customer_email: b.email.trim(),
        client_reference_id: orderId,
        metadata: {
          order_id: orderId
        },
        payment_intent_data: {
          metadata: {
            order_id: orderId
          }
        },
        line_items: items.map((item) => ({
          quantity: item.quantity,
          price_data: {
            currency: 'usd',
            unit_amount: item.unit_price_cents,
            product_data: {
              name: `${item.product_name} — ${item.variant_size}`
            }
          }
        })),
        shipping_address_collection: {
          allowed_countries: ['US']
        },
        shipping_options: [
          {
            shipping_rate_data: {
              type: 'fixed_amount',
              fixed_amount: {
                amount: shipping,
                currency: 'usd'
              },
              display_name: 'US flat-rate shipping'
            }
          }
        ],
        success_url: `${site}/checkout-result.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/?checkout=canceled#shop`
      },
      {
        idempotencyKey: `order-${orderId}`
      }
    );

    checked(
      await db
        .from('store_orders')
        .update({
          stripe_checkout_session_id: session.id
        })
        .eq('id', orderId)
    );

    return res.status(200).json({
      url: session.url
    });
  } catch (error) {
    const safeMessage = String(error.message || 'Unknown error')
      .replace(
        /(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]+|whsec_[A-Za-z0-9_]+|sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
        '[REDACTED]'
      )
      .slice(0, 600);

    console.error('checkout failed', {
      name: error.name,
      code: error.code,
      type: error.type,
      message: safeMessage
    });

    return res.status(error.validation ? 400 : 500).json({
      error: error.validation
        ? error.message
        : 'Checkout unavailable. Check Vercel function logs and configuration.'
    });
  }
};

async function createOrderNumber(db) {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let orderNumber = 'A';

    for (let index = 0; index < 9; index += 1) {
      orderNumber += characters[
        Math.floor(Math.random() * characters.length)
      ];
    }

    const existing = await db
      .from('store_orders')
      .select('id')
      .eq('order_number', orderNumber)
      .maybeSingle();

    if (!existing.data) {
      return orderNumber;
    }
  }

  throw new Error('Unable to generate a unique order number.');
}
