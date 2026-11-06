-- These tables are backend-controlled. RLS with no policies already denies
-- row access, but broad table ACLs are unnecessary and obscure the boundary.
-- Keep service_role access for trusted server-side workflows only.
REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.newsletter_subscribers FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;
GRANT ALL ON TABLE public.newsletter_subscribers TO service_role;
