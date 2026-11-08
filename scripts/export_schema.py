#!/usr/bin/env python3
"""Fixed-query PostgreSQL catalog exporter; application relation rows are never read."""
import json, os, sys
from pathlib import Path
import psycopg
from psycopg.rows import dict_row

# Static SQL only: no user-supplied SQL, schema identifiers, or query filters.
QUERIES = {
"schemas": """SELECT n.nspname schema_name,pg_get_userbyid(n.nspowner) owner_name,n.nspacl::text acl,
obj_description(n.oid,'pg_namespace') comment FROM pg_namespace n
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1""",
"relations": """SELECT n.nspname schema_name,c.relname object_name,c.relkind,c.relpersistence,
pg_get_userbyid(c.relowner) owner_name,c.relacl::text acl,c.reloptions,
c.relrowsecurity row_security_enabled,c.relforcerowsecurity row_security_forced,
CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END view_definition,
obj_description(c.oid,'pg_class') comment FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' AND c.relkind IN ('r','p','v','m','f','S') ORDER BY 1,2""",
"columns": """SELECT n.nspname schema_name,c.relname table_name,a.attnum ordinal_position,a.attname column_name,
format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull not_null,a.attidentity identity_kind,
a.attgenerated generated_kind,pg_get_expr(ad.adbin,ad.adrelid) default_expression,a.attacl::text column_acl,
col_description(c.oid,a.attnum) comment FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' AND c.relkind IN ('r','p','v','m','f')
AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3""",
"constraints": """SELECT n.nspname schema_name,c.relname table_name,con.conname constraint_name,
con.contype constraint_type,pg_get_constraintdef(con.oid,true) definition,con.convalidated validated,
con.condeferrable deferrable,con.condeferred initially_deferred FROM pg_constraint con
JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1,2,3""",
"indexes": """SELECT n.nspname schema_name,t.relname table_name,i.relname index_name,
pg_get_userbyid(i.relowner) owner_name,i.relacl::text acl,pg_get_indexdef(i.oid) definition,
x.indisunique unique_index,x.indisprimary primary_index,x.indisvalid valid,x.indisready ready
FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname<>'information_schema'
AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1,2,3""",
"policies": """SELECT n.nspname schema_name,c.relname table_name,p.polname policy_name,p.polcmd command,
p.polpermissive permissive,ARRAY(SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END
FROM unnest(p.polroles) r) roles,pg_get_expr(p.polqual,p.polrelid) using_expression,
pg_get_expr(p.polwithcheck,p.polrelid) check_expression FROM pg_policy p
JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1,2,3""",
"routines": """SELECT n.nspname schema_name,p.proname routine_name,p.prokind routine_kind,
pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_userbyid(p.proowner) owner_name,
p.prosecdef security_definer,p.provolatile volatility,p.proparallel parallel_safety,p.proconfig settings,
p.proacl::text acl,has_function_privilege(current_user,p.oid,'EXECUTE') current_role_can_execute,
pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' AND p.prokind IN ('f','p','w') ORDER BY 1,2,3""",
"triggers": """SELECT n.nspname schema_name,c.relname table_name,t.tgname trigger_name,
pg_get_triggerdef(t.oid,true) definition,t.tgenabled enabled_state,t.tgisinternal internal_trigger
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1,2,3""",
"types": """SELECT n.nspname schema_name,t.typname type_name,t.typtype type_kind,
pg_get_userbyid(t.typowner) owner_name,t.typacl::text acl,format_type(t.oid,NULL) formatted_type
FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' AND t.typrelid=0 ORDER BY 1,2""",
"extensions": """SELECT e.extname extension_name,e.extversion version,n.nspname schema_name,
pg_get_userbyid(e.extowner) owner_name FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1""",
"roles": """SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,
rolbypassrls,rolconnlimit FROM pg_roles ORDER BY rolname""",
"memberships": """SELECT g.rolname granted_role,mr.rolname member_role,m.admin_option FROM pg_auth_members m
JOIN pg_roles g ON g.oid=m.roleid JOIN pg_roles mr ON mr.oid=m.member ORDER BY 1,2""",
"default_privileges": """SELECT pg_get_userbyid(d.defaclrole) owner_role,n.nspname schema_name,
d.defaclobjtype object_type,d.defaclacl::text acl FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY 1,2,3""",
"effective_security_definer_execution": """SELECT n.nspname schema_name,p.proname routine_name,
pg_get_function_identity_arguments(p.oid) identity_arguments,pg_get_userbyid(p.proowner) owner_name,
p.proacl::text acl,p.proconfig settings,has_function_privilege(current_user,p.oid,'EXECUTE') can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prosecdef AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_(catalog|toast|temp)(_|$)' ORDER BY 1,2""",
"dependencies": """SELECT pg_describe_object(d.classid,d.objid,d.objsubid) dependent_object,
pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) referenced_object,d.deptype dependency_type
FROM pg_depend d WHERE d.deptype<>'i' ORDER BY 1,2""",
"database_privileges": """SELECT datname database_name,has_database_privilege(current_user,oid,'CONNECT') can_connect,
has_database_privilege(current_user,oid,'CREATE') can_create,has_database_privilege(current_user,oid,'TEMP') can_temp
FROM pg_database ORDER BY datname"""
}

def export_catalog(dsn=""):
    doc={"format":"altapure-postgresql-catalog-v1","scope":"PostgreSQL catalogs only; no application relation rows","sections":{}}
    with psycopg.connect(dsn,connect_timeout=10,row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database() database_name,current_user role_name,version() server_version")
            ident=cur.fetchone()
        doc.update(database=ident["database_name"],current_role=ident["role_name"],server_version=ident["server_version"])
        for name,sql in QUERIES.items():
            with conn.cursor() as cur:
                cur.execute(sql); doc["sections"][name]=cur.fetchall()
    return doc

def main():
    output=os.environ.get("SCHEMA_INSPECTION_OUTPUT")
    if not output:
        print("Required exporter output path is missing.",file=sys.stderr); return 2
    try:
        doc=export_catalog(os.environ.get("SCHEMA_INSPECTION_DSN",""))
        Path(output).write_text(json.dumps(doc,indent=2,sort_keys=True,default=str)+"\n",encoding="utf-8")
        os.chmod(output,0o600)
        print("Catalog metadata export completed."); return 0
    except Exception:
        print("Catalog export failed; diagnostic details suppressed.",file=sys.stderr); return 1

if __name__=="__main__": raise SystemExit(main())
