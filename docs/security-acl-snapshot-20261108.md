# Production ACL snapshot — migration 1

Captured read-only from AltaPure Labs production on 2026-11-08, before
migration 1 was prepared. No DDL or privilege changes were performed.

Project ref: `mqtitxfsdphqbsxhwdma`
PostgreSQL: 17.11

The catalog query expanded each table ACL with `aclexplode(COALESCE(relacl,
acldefault('r', relowner)))`, retaining grantee, grantor, privilege type,
and grant-option flag.

## Captured entries

For **each** of the following tables:

- `public.order_status_notifications`
- `public.suppliers`
- `public.supplier_batches`
- `public.supplier_batch_items`

the exact ACL entries for both `anon` and `authenticated` were:

| Grantee | Grantor | Privileges | Grant option |
|---|---|---|---|
| anon | postgres | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | false |
| authenticated | postgres | DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | false |

No other ACL entries for these two grantees were returned for these tables.
All four tables are owned by `postgres`.

## Rollback derivation

The rollback grants precisely the captured privilege set to the two roles.
The migration does not change owner privileges or service_role privileges.
The grant is executed as postgres, matching the captured grantor. No grant
option is restored because none existed in the snapshot.

The `MAINTAIN` privilege is included because the live database runs
PostgreSQL 17.11 and it was present in the captured ACL.
