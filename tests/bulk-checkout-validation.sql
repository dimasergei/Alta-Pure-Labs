-- Read-only verification: fixture JSON only. No customers, invoices or payments are created.
-- Run after the bulk checkout migration. Any failed case raises an exception.
begin;
do $verify$
declare fixtures jsonb := $fixtures$[
 {
  "id": "c0000000-0000-4000-8000-000000000003",
  "customer_id": "c0000000-0000-4000-8000-000000000001",
  "customer_email": "fixture@example.test",
  "customer_name": "Fixture",
  "kind": "goods",
  "plan": null,
  "request": {
   "name": "Fixture",
   "organization": "",
   "note": "",
   "items": [
    {
     "id": "a",
     "name": "A",
     "size": "5mg",
     "qty": 3,
     "unit_price_usd_cents": 1001
    },
    {
     "id": "a",
     "name": "A",
     "size": "10mg",
     "qty": 7,
     "unit_price_usd_cents": 2003
    }
   ],
   "address": {
    "line1": "123 Example Road",
    "line2": "",
    "city": "Example",
    "region": "FL",
    "postal_code": "12345",
    "country": "US"
   },
   "research_use_confirmed": true,
   "bulk_order": true,
   "checkout": {
    "version": "checkout-2026-11-v4",
    "method_id": "c0000000-0000-4000-8000-000000000002",
    "points": 0,
    "credit_cents": 0,
    "coupon": "",
    "delivery": {
     "shipping": "express",
     "extras": []
    },
    "sms_opt_in": false,
    "billing_same": true
   }
  },
  "consent": true,
  "terms_version": "launch-2026-11-v1",
  "digest": "28f4e7e2b631ce95ca7dc654102b130dd90498962e307394b965a4b25b8f24d2",
  "pricing": {
   "lines": [
    {
     "id": "a",
     "name": "A",
     "size": "5mg",
     "qty": 3,
     "unit_price_usd_cents": 1001,
     "unit_price_cents": 1001,
     "gross_cents": 3003,
     "discount_cents": 1501,
     "discount_bps": 5000,
     "discount_reason": "bulk",
     "line_total_cents": 1502
    },
    {
     "id": "a",
     "name": "A",
     "size": "10mg",
     "qty": 7,
     "unit_price_usd_cents": 2003,
     "unit_price_cents": 2003,
     "gross_cents": 14021,
     "discount_cents": 7010,
     "discount_bps": 5000,
     "discount_reason": "bulk",
     "line_total_cents": 7011
    }
   ],
   "subtotal_cents": 17024,
   "discount_cents": 8511,
   "currency": "USD",
   "fx_ppm": 1000000,
   "terms_version": "launch-2026-11-v1",
   "bulk_order": true,
   "delivery": {
    "selection": {
     "shipping": "express",
     "extras": []
    },
    "shipping_cents": 0,
    "country": "US",
    "rate_version": "bulk-express-v1",
    "extras": [],
    "extras_cents": 0,
    "total_cents": 0
   },
   "checkout_version": "checkout-2026-11-v4",
   "billing_period": null,
   "conversion_version": "conversion-2026-11-v1",
   "redeemed_points": 0,
   "credit_cents": 0,
   "shipping_note": "Free 2-day express delivery."
  },
  "subtotal_cents": 17024,
  "discount_cents": 8511,
  "shipping_cents": 0,
  "tax_cents": 0,
  "total_cents": 8513,
  "points_redeemed": 0,
  "credit_redeemed_cents": 0,
  "earned_points": 212,
  "membership_invoice_id": null,
  "method_version": 1,
  "currency": "USD",
  "method_id": "c0000000-0000-4000-8000-000000000002",
  "checkout_version": "checkout-2026-11-v4"
 },
 {
  "id": "c0000000-0000-4000-8000-000000000003",
  "customer_id": "c0000000-0000-4000-8000-000000000001",
  "customer_email": "fixture@example.test",
  "customer_name": "Fixture",
  "kind": "goods",
  "plan": null,
  "request": {
   "name": "Fixture",
   "organization": "",
   "note": "",
   "items": [
    {
     "id": "a",
     "name": "A",
     "size": "5mg",
     "qty": 25,
     "unit_price_usd_cents": 1001
    },
    {
     "id": "a",
     "name": "A",
     "size": "10mg",
     "qty": 25,
     "unit_price_usd_cents": 2003
    },
    {
     "id": "b",
     "name": "B",
     "size": "5mg",
     "qty": 49,
     "unit_price_usd_cents": 3007
    }
   ],
   "address": {
    "line1": "123 Example Road",
    "line2": "",
    "city": "Example",
    "region": "FL",
    "postal_code": "12345",
    "country": "US"
   },
   "research_use_confirmed": true,
   "bulk_order": true,
   "checkout": {
    "version": "checkout-2026-11-v4",
    "method_id": "c0000000-0000-4000-8000-000000000002",
    "points": 0,
    "credit_cents": 0,
    "coupon": "",
    "delivery": {
     "shipping": "express",
     "extras": []
    },
    "sms_opt_in": false,
    "billing_same": true
   }
  },
  "consent": true,
  "terms_version": "launch-2026-11-v1",
  "digest": "462c55d00220b9dc182b26dafb56fca19366881dda71d57e29c86cbf48876f6b",
  "pricing": {
   "lines": [
    {
     "id": "a",
     "name": "A",
     "size": "5mg",
     "qty": 25,
     "unit_price_usd_cents": 1001,
     "unit_price_cents": 1001,
     "gross_cents": 25025,
     "discount_cents": 15015,
     "discount_bps": 6000,
     "discount_reason": "bulk",
     "line_total_cents": 10010
    },
    {
     "id": "a",
     "name": "A",
     "size": "10mg",
     "qty": 25,
     "unit_price_usd_cents": 2003,
     "unit_price_cents": 2003,
     "gross_cents": 50075,
     "discount_cents": 30045,
     "discount_bps": 6000,
     "discount_reason": "bulk",
     "line_total_cents": 20030
    },
    {
     "id": "b",
     "name": "B",
     "size": "5mg",
     "qty": 49,
     "unit_price_usd_cents": 3007,
     "unit_price_cents": 3007,
     "gross_cents": 147343,
     "discount_cents": 73671,
     "discount_bps": 5000,
     "discount_reason": "bulk",
     "line_total_cents": 73672
    }
   ],
   "subtotal_cents": 222443,
   "discount_cents": 118731,
   "currency": "USD",
   "fx_ppm": 1000000,
   "terms_version": "launch-2026-11-v1",
   "bulk_order": true,
   "delivery": {
    "selection": {
     "shipping": "express",
     "extras": []
    },
    "shipping_cents": 0,
    "country": "US",
    "rate_version": "bulk-express-v1",
    "extras": [],
    "extras_cents": 0,
    "total_cents": 0
   },
   "checkout_version": "checkout-2026-11-v4",
   "billing_period": null,
   "conversion_version": "conversion-2026-11-v1",
   "redeemed_points": 0,
   "credit_cents": 0,
   "shipping_note": "Free 2-day express delivery."
  },
  "subtotal_cents": 222443,
  "discount_cents": 118731,
  "shipping_cents": 0,
  "tax_cents": 0,
  "total_cents": 103712,
  "points_redeemed": 0,
  "credit_redeemed_cents": 0,
  "earned_points": 2592,
  "membership_invoice_id": null,
  "method_version": 1,
  "currency": "USD",
  "method_id": "c0000000-0000-4000-8000-000000000002",
  "checkout_version": "checkout-2026-11-v4"
 }
]$fixtures$::jsonb;
 cases jsonb := $cases$[
 {
  "name": "10 combined strengths with odd cents",
  "accept": true,
  "fixture": 0,
  "patches": []
 },
 {
  "name": "50 combined strengths and separate 49-unit product",
  "accept": true,
  "fixture": 1,
  "patches": []
 },
 {
  "name": "under minimum",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "items",
     "1",
     "qty"
    ],
    "value": 6
   }
  ]
 },
 {
  "name": "different products cannot share minimum",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "items",
     "1",
     "id"
    ],
    "value": "b"
   },
   {
    "path": [
     "pricing",
     "lines",
     "1",
     "id"
    ],
    "value": "b"
   }
  ]
 },
 {
  "name": "duplicate strength",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "items",
     "1",
     "size"
    ],
    "value": "5mg"
   }
  ]
 },
 {
  "name": "fractional quantity",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "items",
     "0",
     "qty"
    ],
    "value": 3.5
   }
  ]
 },
 {
  "name": "oversized quantity",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "items",
     "0",
     "qty"
    ],
    "value": 101
   }
  ]
 },
 {
  "name": "incorrect tier",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "pricing",
     "lines",
     "0",
     "discount_bps"
    ],
    "value": 6000
   }
  ]
 },
 {
  "name": "incorrect payable",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "total_cents"
    ],
    "value": 8512
   }
  ]
 },
 {
  "name": "incorrect line price",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "pricing",
     "lines",
     "0",
     "unit_price_cents"
    ],
    "value": 1
   }
  ]
 },
 {
  "name": "invalid source unit price",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "items",
     "0",
     "unit_price_usd_cents"
    ],
    "value": 0
   }
  ]
 },
 {
  "name": "changed canonical source price",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "items",
     "0",
     "unit_price_usd_cents"
    ],
    "value": 1
   }
  ]
 },
 {
  "name": "missing line",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "pricing",
     "lines"
    ],
    "value": [
     {
      "id": "a",
      "name": "A",
      "size": "5mg",
      "qty": 3,
      "unit_price_usd_cents": 1001,
      "unit_price_cents": 1001,
      "gross_cents": 3003,
      "discount_cents": 1501,
      "discount_bps": 5000,
      "discount_reason": "bulk",
      "line_total_cents": 1502
     }
    ]
   }
  ]
 },
 {
  "name": "stacked bank discount",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "pricing",
     "payment_discount"
    ],
    "value": {
     "amount_cents": 1
    }
   }
  ]
 },
 {
  "name": "stacked coupon",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "checkout",
     "coupon"
    ],
    "value": "BOGO"
   }
  ]
 },
 {
  "name": "stacked bogo",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "pricing",
     "lines",
     "0",
     "bogo_free_units"
    ],
    "value": 1
   }
  ]
 },
 {
  "name": "stacked referral",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "pricing",
     "referral"
    ],
    "value": {}
   }
  ]
 },
 {
  "name": "stacked points",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "points_redeemed"
    ],
    "value": 100
   }
  ]
 },
 {
  "name": "stacked credit",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "credit_redeemed_cents"
    ],
    "value": 100
   }
  ]
 },
 {
  "name": "shipping charge",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "shipping_cents"
    ],
    "value": 100
   }
  ]
 },
 {
  "name": "standard shipping substitution",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "checkout",
     "delivery",
     "shipping"
    ],
    "value": "standard"
   }
  ]
 },
 {
  "name": "delivery extra substitution",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "checkout",
     "delivery",
     "extras"
    ],
    "value": [
     "protection"
    ]
   }
  ]
 },
 {
  "name": "false bulk flag",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "bulk_order"
    ],
    "value": false
   }
  ]
 },
 {
  "name": "string bulk flag",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "bulk_order"
    ],
    "value": "true"
   }
  ]
 },
 {
  "name": "wrong checkout version",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "checkout_version"
    ],
    "value": "checkout-2026-11-v3"
   }
  ]
 },
 {
  "name": "non-goods bulk order",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "kind"
    ],
    "value": "membership"
   }
  ]
 },
 {
  "name": "non-US destination",
  "accept": false,
  "fixture": 0,
  "patches": [
   {
    "path": [
     "request",
     "address",
     "country"
    ],
    "value": "CA"
   }
  ]
 }
]$cases$::jsonb;
 test_case jsonb; patch jsonb; data jsonb; accepted boolean; checked integer:=0;
begin
 for test_case in select value from jsonb_array_elements(cases) loop
  data:=fixtures->(test_case->>'fixture')::integer;
  for patch in select value from jsonb_array_elements(test_case->'patches') loop
   data:=jsonb_set(data,array(select jsonb_array_elements_text(patch->'path')),patch->'value',true);
  end loop;
  accepted:=true;
  begin
   perform commerce_internal.validate_bulk_checkout(data);
  exception when sqlstate '22023' then accepted:=false;
  end;
  if accepted is distinct from (test_case->>'accept')::boolean then
   raise exception 'Bulk validation failed: % (accepted=%)',test_case->>'name',accepted;
  end if;
  checked:=checked+1;
 end loop;
 if has_function_privilege('anon','commerce_internal.validate_bulk_checkout(jsonb)','EXECUTE')
 or has_function_privilege('authenticated','commerce_internal.validate_bulk_checkout(jsonb)','EXECUTE')
 or not has_function_privilege('service_role','commerce_internal.validate_bulk_checkout(jsonb)','EXECUTE')
 or has_function_privilege('anon','public.commerce_place_checkout(jsonb)','EXECUTE')
 or has_function_privilege('authenticated','public.commerce_place_checkout(jsonb)','EXECUTE')
 then raise exception 'Bulk checkout permissions are not restricted'; end if;
 if strpos(pg_get_functiondef('public.commerce_place_checkout(jsonb)'::regprocedure),'commerce_internal.validate_bulk_checkout(p_data)')=0
 then raise exception 'Bulk validator is not connected to checkout'; end if;
 raise notice 'Passed % bulk checkout validation cases and RPC permission checks',checked;
end $verify$;
rollback;
