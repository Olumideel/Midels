-- Public certificate verification should confirm authenticity without exposing learner identity.
-- The certificate owner's private dashboard continues to render the learner name on the certificate itself.

CREATE OR REPLACE FUNCTION public.verify_course_certificate(p_certificate_code text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'valid', c.revoked_at IS NULL,
    'certificate_code', c.certificate_code,
    'course_title', co.title,
    'issued_at', c.issued_at,
    'revoked_at', c.revoked_at
  )
  FROM public.course_certificates c
  JOIN public.courses co ON co.id = c.course_id
  WHERE c.certificate_code = upper(btrim(p_certificate_code))
$function$;

-- Anonymous verification is an intentional product feature. Make that boundary explicit.
REVOKE ALL ON FUNCTION public.verify_course_certificate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_course_certificate(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_course_certificate(text) TO anon, authenticated, service_role;

DO $migration_assertions$
DECLARE
  function_oid regprocedure := 'public.verify_course_certificate(text)'::regprocedure;
  function_definition text;
  function_config text[];
BEGIN
  SELECT pg_get_functiondef(function_oid::oid), proconfig
    INTO function_definition, function_config
  FROM pg_proc
  WHERE oid = function_oid::oid;

  IF NOT coalesce(function_config @> ARRAY['search_path=""'], false) THEN
    RAISE EXCEPTION 'Certificate verifier must retain an empty search_path';
  END IF;
  IF position('SECURITY DEFINER' IN upper(function_definition)) = 0 THEN
    RAISE EXCEPTION 'Certificate verifier security mode changed unexpectedly';
  END IF;
  IF position('student_name' IN lower(function_definition)) > 0
     OR position('full_name' IN lower(function_definition)) > 0
     OR position('display_name' IN lower(function_definition)) > 0 THEN
    RAISE EXCEPTION 'Public certificate verifier must not expose learner identity fields';
  END IF;
  IF has_function_privilege('anon', function_oid, 'EXECUTE') IS NOT TRUE
     OR has_function_privilege('authenticated', function_oid, 'EXECUTE') IS NOT TRUE THEN
    RAISE EXCEPTION 'Public certificate verification must remain available';
  END IF;
END;
$migration_assertions$;
