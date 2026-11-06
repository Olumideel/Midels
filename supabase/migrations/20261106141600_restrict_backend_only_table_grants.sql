-- These tables are backend-controlled. RLS with no policies already denies
-- row access, but broad table ACLs are unnecessary and obscure the boundary.
-- Keep service_role access for trusted server-side workflows only.
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.newsletter_subscribers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;
GRANT ALL ON TABLE public.newsletter_subscribers TO service_role;


DO $migration_assertions$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['public.audit_logs','public.newsletter_subscribers'] LOOP
    IF has_table_privilege('anon', table_name, 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('authenticated', table_name, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Client table grants remain on backend-only table %', table_name;
    END IF;
    IF NOT has_table_privilege('service_role', table_name, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role access missing on backend-only table %', table_name;
    END IF;
  END LOOP;
END;
$migration_assertions$;
