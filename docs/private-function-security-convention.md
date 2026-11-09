# Private PostgreSQL function migration convention

Migration 2 is intentionally excluded from this review branch. Do not change
global default privileges for functions or revoke global PUBLIC EXECUTE.

For every new application function intended to be callable only by the
verified server-side backend role, the function's own migration must include
an object-specific privilege block after CREATE FUNCTION:

```sql
REVOKE EXECUTE
ON FUNCTION public.example_function(argument_type, ...)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.example_function(argument_type, ...)
TO service_role;
```

Replace the example signature with the exact function signature. Grant only
the backend role verified for that particular call path. Do not automatically
grant service_role if a different narrowly scoped backend role is appropriate.
Keep the function owner and postgres access unchanged unless a separate
approved change explicitly requires otherwise.

For SECURITY DEFINER functions:
- schema-qualify all application relations and functions;
- set a fixed trusted search_path, normally `pg_catalog, pg_temp`;
- validate all caller-controlled inputs;
- add ACL tests proving PUBLIC, anon, and authenticated cannot EXECUTE;
- add a positive test proving the intended backend role can EXECUTE.

This convention is object-specific and does not alter Supabase-managed
functions, extension functions, Auth, Storage, or functions in other schemas.
