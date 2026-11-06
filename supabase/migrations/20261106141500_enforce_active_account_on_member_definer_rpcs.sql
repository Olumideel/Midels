-- Ensure SECURITY DEFINER member RPCs honor the active-account gate.
-- These functions bypass table RLS by design, so they must explicitly enforce
-- the same account-status restriction as the restrictive RLS policies.

CREATE OR REPLACE FUNCTION public.get_assessment_for_student(p_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_active_user() then
    raise exception 'Active account required';
  end if;
  if not exists (
    select 1
    from public.course_assessments a
    join public.courses c on c.id=a.course_id
    join public.enrollments e on e.course_id=c.id
      and e.student_id=auth.uid() and e.revoked_at is null
    where a.id=p_assessment_id and a.is_published and c.is_published
  ) then
    raise exception 'Assessment unavailable or active enrolment required';
  end if;

  select jsonb_build_object(
    'id',a.id,
    'title',a.title,
    'description',a.description,
    'pass_percentage',a.pass_percentage,
    'questions',coalesce((
      select jsonb_agg(
        jsonb_build_object('id',q.id,'prompt',q.prompt,'options',q.options,'position',q.position)
        order by q.position
      )
      from public.assessment_questions q
      where q.assessment_id=a.id
    ),'[]'::jsonb)
  ) into result
  from public.course_assessments a
  where a.id=p_assessment_id;

  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_active_user() then
    raise exception 'Active account required';
  end if;

  update public.notifications
  set is_read=true
  where user_id=auth.uid() and is_read=false;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(notification_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_active_user() then
    raise exception 'Active account required';
  end if;

  update public.notifications
  set is_read=true
  where id=notification_id and user_id=auth.uid();
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_course_assessment(p_assessment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_owner uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_active_user() then
    raise exception 'Active account required';
  end if;

  select c.instructor_id into v_owner
  from public.course_assessments a
  join public.courses c on c.id=a.course_id
  where a.id=p_assessment_id;

  if v_owner is distinct from auth.uid() then
    raise exception 'Only the course instructor can publish this assessment';
  end if;

  select count(*) into v_count
  from public.assessment_questions
  where assessment_id=p_assessment_id;

  if v_count=0 then
    raise exception 'Add at least one question before publishing';
  end if;

  update public.course_assessments
  set is_published=true,updated_at=now()
  where id=p_assessment_id and is_published=false;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.submit_course_assessment(p_assessment_id uuid, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_student uuid := auth.uid();
  v_total integer;
  v_correct integer;
  v_pass integer;
  v_score numeric(5,2);
  v_attempt uuid;
begin
  if v_student is null then
    raise exception 'Authentication required';
  end if;
  if not private.is_active_user() then
    raise exception 'Active account required';
  end if;
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be an object';
  end if;
  if not exists (
    select 1
    from public.course_assessments a
    join public.courses c on c.id=a.course_id
    join public.enrollments e on e.course_id=c.id
      and e.student_id=v_student and e.revoked_at is null
    where a.id=p_assessment_id and a.is_published and c.is_published
  ) then
    raise exception 'Assessment unavailable or active enrolment required';
  end if;

  select count(*), max(a.pass_percentage)
  into v_total,v_pass
  from public.assessment_questions q
  join public.course_assessments a on a.id=q.assessment_id
  where q.assessment_id=p_assessment_id;

  if v_total=0 then
    raise exception 'This assessment has no questions yet';
  end if;

  select count(*) into v_correct
  from public.assessment_questions q
  where q.assessment_id=p_assessment_id
    and p_answers ? q.id::text
    and (p_answers->>q.id::text) ~ '^[0-9]+$'
    and (p_answers->>q.id::text)::integer=q.correct_option;

  v_score := round((v_correct::numeric / v_total::numeric)*100,2);

  insert into public.assessment_attempts(
    assessment_id,student_id,score_percentage,passed,answers
  )
  values(p_assessment_id,v_student,v_score,v_score>=v_pass,p_answers)
  returning id into v_attempt;

  return jsonb_build_object(
    'attempt_id',v_attempt,
    'score_percentage',v_score,
    'passed',v_score>=v_pass,
    'pass_percentage',v_pass,
    'correct',v_correct,
    'total',v_total
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_username text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_cover_url text DEFAULT NULL,
  p_country_code character DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_website_url text DEFAULT NULL,
  p_instagram_url text DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  uid uuid := (select auth.uid());
  result public.profiles;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if not private.is_active_user() then
    raise exception 'Active account required';
  end if;

  update public.profiles
  set full_name=coalesce(p_full_name,full_name),
      display_name=coalesce(p_display_name,display_name),
      username=coalesce(p_username::extensions.citext,username),
      bio=coalesce(p_bio,bio),
      avatar_url=coalesce(p_avatar_url,avatar_url),
      cover_url=coalesce(p_cover_url,cover_url),
      country_code=coalesce(p_country_code,country_code),
      city=coalesce(p_city,city),
      website_url=coalesce(p_website_url,website_url),
      instagram_url=coalesce(p_instagram_url,instagram_url),
      updated_at=now()
  where id=uid
  returning * into result;

  return result;
end;
$function$;

-- CREATE OR REPLACE preserves the existing EXECUTE grants. Assert the intended
-- client access boundary explicitly so a future grant drift is caught here.
REVOKE ALL ON FUNCTION public.get_assessment_for_student(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_notification_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_course_assessment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_course_assessment(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_profile(text,text,text,text,text,text,character,text,text,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_assessment_for_student(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_course_assessment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_course_assessment(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text,text,text,text,text,text,character,text,text,text) TO authenticated, service_role;
