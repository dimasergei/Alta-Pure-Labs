# Standalone Inventory contract

Inventory is an independent private stock spreadsheet. It has no storefront catalog,
order, supplier, checkout, payment, fulfillment, or external-service integration.
All items are manually created or imported. No live catalog rows or opening counts
are seeded. Quantities do not change when orders are paid, refunded, or shipped.

## Storage and authorization

- `pure_stock_items`: one independent row per SKU.
- `pure_stock_events`: append-only quantity and metadata history, with event-time names.
- `pure_stock_requests`: immutable operation payload/result for safe request replay.
- `pure_stock_command`: one transaction for the row, event, and request receipt.
- Existing `PureAdminAuth` session and CSRF protection authorize the server handler.
- Tables have RLS, deny public/customer roles, and are accessible only to the service role.
- The application role cannot delete stock rows or update/delete events/request receipts.
- Actor references are derived on the server from the authenticated admin session;
  the browser cannot supply or impersonate an actor.

The migration adds only these standalone objects. It does not modify the older
enterprise inventory tables or their data.

## Item row

| Field | Contract |
|---|---|
| `id` | Server-generated immutable UUID |
| `sku` | Required, unique including archived rows, trimmed and uppercased; 1–64 ASCII letters/numbers/dots/underscores/hyphens; starts with a letter or number |
| `product_name` | Required text, 1–160 characters |
| `strength` | Optional free text, up to 80 characters; default empty |
| `unit` | `vial`, `pen`, `bottle`, `pack`, or `unit`; default `vial` |
| `quantity` | `null` means not counted; otherwise whole number 0–2,147,483,647 |
| `minimum` | Whole number 0–2,147,483,647; default 0 |
| `unit_cost` | Optional numeric cost in the chosen currency; null or 0–9,999,999,999.99, at most two decimal places |
| `currency` | `USD` or `CAD`; default `USD` |
| `location` | Optional free text, up to 120 characters |
| `notes` | Optional multiline text, up to 2,000 characters |
| `archived` | Boolean; default false; reversible |
| `version` | Server-managed positive integer for optimistic concurrency |
| `created_at`, `updated_at` | Server timestamps |

The number is always a count of the selected unit. There is no automatic pack,
vial, milligram, currency, or other conversion.

## HTTP contract

Route: `/api/customer-config?inventory=1`.

Use `PureAdminAuth.fetch` for every request. Every POST is JSON and includes a
browser-generated UUID `request_id`. Retain that same ID and exact payload when
retrying an unconfirmed mutation. A new intended change receives a new ID.

| Method/action | Payload | Result |
|---|---|---|
| GET | None | `{items:[...]}` including archived items |
| GET activity | `&view=activity&offset=0&page_size=50` | `{events:[...],has_more:boolean}` |
| POST `create` | `{action,request_id,item,reason?}` | `{item}` |
| POST `update` | `{action,request_id,id,expected_version,item,reason?}` | `{item}` |
| POST `adjust` | `{action,request_id,id,expected_version,mode,quantity,reason}` | `{item}` |
| POST `archive` | `{action,request_id,id,expected_version,archived,reason?}` | `{item}` |
| POST `preview_import` | `{action,request_id,items,reason?}` | `{items:normalizedRows,count}`; no writes |
| POST `import` | `{action,request_id,items,reason?}` | `{items}`; all rows commit together |

All successful responses use HTTP 200. `update.item` accepts any nonempty subset
of editable metadata fields, **excluding quantity**. Quantity changes use `adjust`:

- `set`: replace with the physically counted nonnegative quantity, including zero.
- `add`: add a positive whole number to a previously counted quantity.
- `remove`: subtract a positive whole number without permitting a negative result.

An unknown quantity can only become known through `set`. Archived items must be
restored before quantity adjustments. Metadata can be corrected while archived.
Every adjustment requires a reason of 1–500 characters. Other reasons are optional.
No-op metadata/archive changes retain the current version and do not fabricate an
event, but their request replay receipt is retained. A deliberate `set` count is
recorded even when it confirms the existing quantity.

## Import and pagination

Imports add **new rows only**, never update or overwrite existing rows. A preview
checks validation, duplicates within the file, and existing SKUs (including archived
ones). The atomic import rechecks current database state because another admin tab
may have changed it after preview. A failure leaves no partial rows or events.

Maximum import: 500 rows. Maximum inventory: 5,000 rows including archived rows.
GET fetches by a stable ID cursor in batches; if storage ever exceeds the supported
maximum it returns an explicit error rather than silently omitting rows.

CSV columns are `sku,product_name,strength,quantity,unit,minimum,unit_cost,currency,location,notes`.
The browser parses numeric cells as numbers, blank quantity/cost as null, and applies
the documented defaults. CSV export protects spreadsheet-formula-like text.

Activity supports `page_size` 1–100 and offset 0–1,000,000; it sorts by server timestamp
and event ID descending. Events include `id,item_id,action,mode,sku,product_name,
strength,quantity_before,quantity_after,reason,changes,created_at`. `changes` maps each
changed field to `{before,after}`. Event action is `create`, `update`, `adjust`,
`archive`, `restore`, or `import`.

## Errors and concurrency

Errors are `{error:string,code?:string}`. The UI should display the error without
claiming a successful save. Relevant 409 codes are:

- `VERSION_CONFLICT`: another edit won; reload the row and review before submitting a new change.
- `REQUEST_CONFLICT`: the request ID was reused with a different payload.
- `DUPLICATE_SKU`: the SKU already exists or repeats in the import.
- `INVALID_QUANTITY`: unconfirmed starting count, insufficient stock, or overflow.
- `ITEM_ARCHIVED`: restore before changing quantity.
- `LIMIT_EXCEEDED`: supported inventory capacity reached.

Input validation returns 400; not found 404; unauthorized/CSRF 401/403; oversized
body 413; unsupported content type 415; temporary storage failure 503. A temporary
failure has an uncertain outcome: retry the same request ID, not a fresh ID.

## Verification

Backend tests:

```bash
node --test tests/standalone-inventory.test.cjs tests/standalone-inventory-sql.test.cjs
```

The SQL test uses the same PGlite test dependency already used by other SQL tests
in this repository. It verifies a fresh database with no catalog/order/supplier
tables, role restrictions, atomic rollback, optimistic concurrency, idempotency,
null versus zero, count validation, metadata history, and archive/restore.

`tests/fixtures/standalone-inventory-checks.sql` is a post-migration verification
script enclosed in BEGIN/ROLLBACK. Its fixture items, requests, and history do not
persist. It was also executed inside the isolated SQL test to verify rollback.
