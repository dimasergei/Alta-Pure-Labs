import os, unittest, json
import psycopg
from scripts.export_schema import export_catalog
DSN=os.environ.get("SCHEMA_TEST_DSN")
@unittest.skipUnless(DSN,"Disposable PostgreSQL CI service required")
class CatalogExporterTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls): cls.doc=export_catalog(DSN)
 def test_catalog_sections(self):
  expected={"schemas","relations","columns","constraints","indexes","policies","routines","triggers","types","extensions","roles","memberships","default_privileges","effective_security_definer_execution","dependencies","database_privileges"}
  self.assertTrue(expected.issubset(self.doc["sections"]))
 def test_schema_rls_defaults_constraints_indexes_policies(self):
  s=self.doc["sections"]
  self.assertIn("app_private",[x["schema_name"] for x in s["schemas"]])
  t=next(x for x in s["relations"] if x["object_name"]=="customer_records")
  self.assertTrue(t["row_security_enabled"]); self.assertTrue(t["row_security_forced"])
  cols=[x for x in s["columns"] if x["table_name"]=="customer_records"]
  self.assertIn("email",[x["column_name"] for x in cols])
  self.assertTrue(any(x["default_expression"]=="'fixture@example.invalid'::text" for x in cols))
  self.assertTrue(any(x["constraint_name"]=="customer_status_check" for x in s["constraints"]))
  self.assertTrue(any(x["index_name"]=="customer_records_status_idx" for x in s["indexes"]))
  self.assertTrue(any(x["policy_name"]=="customer_self_policy" for x in s["policies"]))
 def test_effective_definer_execution(self):
  x={r["routine_name"]:r for r in self.doc["sections"]["effective_security_definer_execution"]}
  self.assertTrue(x["reviewed_definer"]["can_execute"]); self.assertFalse(x["private_definer"]["can_execute"])
 def test_export_contains_database_acl_and_no_customer_rows(self):
  self.assertIn('acl',self.doc['sections']['database_privileges'][0])
  self.assertNotIn('PRIVATE_CUSTOMER_ROW_SENTINEL',json.dumps(self.doc))
 def test_no_table_or_column_select(self):
  with psycopg.connect(DSN) as c:
   x=c.execute("""SELECT has_table_privilege(current_user,c.oid,'SELECT'),
   has_column_privilege(current_user,c.oid,a.attnum,'SELECT'),
   has_schema_privilege(current_user,n.oid,'USAGE')
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname='email'
   WHERE n.nspname='app_private' AND c.relname='customer_records'""").fetchone()
  self.assertEqual(x,(False,False,False))
if __name__=="__main__": unittest.main()
