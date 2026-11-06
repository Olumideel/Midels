-- Enforce active-account status at privileged Academy and payment-confirmation boundaries.
-- Successful charges for suspended accounts are recorded as paid but do not grant
-- entitlements; metadata flags them for operator refund/reconciliation.

create or replace function public.enroll_free_course(course_uuid uuid)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare uid uuid := (select auth.uid()); eid uuid; price bigint;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not exists(select 1 from public.profiles where id=uid and account_status::text='active')
    then raise exception 'active account required'; end if;
  select price_minor into price from public.courses where id=course_uuid and is_published=true;
  if price is null then raise exception 'course not found'; end if;
  if price<>0 then raise exception 'course requires payment'; end if;
  insert into public.enrollments(course_id,student_id,revoked_at) values(course_uuid,uid,null)
  on conflict(course_id,student_id) do update set revoked_at=null returning id into eid;
  return eid;
end $function$;

create or replace function public.issue_course_certificate(p_enrollment_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_course uuid; v_student uuid:=auth.uid(); v_total integer; v_done integer;
  v_unpassed integer; v_cert public.course_certificates%rowtype;
begin
  if v_student is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles where id=v_student and account_status::text='active')
    then raise exception 'Active account required to issue a certificate'; end if;
  select e.course_id into v_course from public.enrollments e join public.courses c on c.id=e.course_id
  where e.id=p_enrollment_id and e.student_id=v_student and e.revoked_at is null and c.is_published;
  if v_course is null then raise exception 'Active course enrolment not found'; end if;
  select count(*) into v_total from public.course_lessons l where l.course_id=v_course and l.is_published;
  select count(*) into v_done from public.lesson_progress lp join public.course_lessons l on l.id=lp.lesson_id
  where lp.enrollment_id=p_enrollment_id and lp.student_id=v_student and l.course_id=v_course and l.is_published;
  if v_total=0 or v_done<v_total then raise exception 'Complete every published lesson before requesting a certificate'; end if;
  select count(*) into v_unpassed from public.course_assessments a where a.course_id=v_course and a.is_published
  and not exists(select 1 from public.assessment_attempts at where at.assessment_id=a.id and at.student_id=v_student and at.passed);
  if v_unpassed>0 then raise exception 'Pass every published assessment before requesting a certificate'; end if;
  update public.enrollments set completed_at=coalesce(completed_at,now()) where id=p_enrollment_id;
  insert into public.course_certificates(course_id,student_id,enrollment_id,certificate_code)
  values(v_course,v_student,p_enrollment_id,'GCH-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,24)))
  on conflict(course_id,student_id) do update set revoked_at=null returning * into v_cert;
  return jsonb_build_object('id',v_cert.id,'certificate_code',v_cert.certificate_code,'issued_at',v_cert.issued_at);
end $function$;

create or replace function public.confirm_course_payment(p_reference text,p_amount_minor bigint,p_currency text,p_paid_at timestamptz default now())
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare payment_row public.payments%rowtype; course_row public.courses%rowtype; enrollment_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not authorized'; end if;
  select * into payment_row from public.payments where reference=p_reference for update;
  if not found or payment_row.purpose<>'course_enrollment' or payment_row.amount_minor<>p_amount_minor
    or upper(trim(payment_row.currency::text))<>upper(trim(p_currency)) or payment_row.metadata->>'course_id' is null then return false; end if;
  if not exists(select 1 from public.profiles p where p.id=payment_row.user_id and p.account_status::text='active') then
    if payment_row.status='pending' then update public.payments set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('entitlement_blocked_reason','account_not_active','entitlement_blocked_at',now())
      where id=payment_row.id; end if;
    return false;
  end if;
  if payment_row.status='paid' then return exists(select 1 from public.enrollments e where e.course_id::text=payment_row.metadata->>'course_id'
    and e.student_id=payment_row.user_id and e.revoked_at is null); end if;
  if payment_row.status<>'pending' then return false; end if;
  select * into course_row from public.courses where id::text=payment_row.metadata->>'course_id'
    and instructor_id::text=payment_row.metadata->>'instructor_id' and is_published=true;
  if not found or course_row.instructor_id=payment_row.user_id then return false; end if;
  insert into public.enrollments(course_id,student_id,revoked_at) values(course_row.id,payment_row.user_id,null)
  on conflict(course_id,student_id) do update set revoked_at=null returning id into enrollment_id;
  update public.payments set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now() where id=payment_row.id;
  return enrollment_id is not null;
end $function$;

create or replace function public.confirm_product_payment(p_reference text,p_amount_minor bigint,p_currency text,p_paid_at timestamptz default now())
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare payment_row public.payments%rowtype; product_row public.products%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not authorized'; end if;
  select * into payment_row from public.payments where reference=p_reference for update;
  if not found or payment_row.purpose<>'product_purchase' or payment_row.amount_minor<>p_amount_minor
    or upper(trim(payment_row.currency::text))<>upper(trim(p_currency)) or payment_row.metadata->>'product_id' is null then return false; end if;
  if not exists(select 1 from public.profiles p where p.id=payment_row.user_id and p.account_status::text='active') then
    if payment_row.status='pending' then update public.payments set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('entitlement_blocked_reason','account_not_active','entitlement_blocked_at',now())
      where id=payment_row.id; end if;
    return false;
  end if;
  if payment_row.status='paid' then return exists(select 1 from public.product_purchases pp where pp.payment_id=payment_row.id); end if;
  if payment_row.status<>'pending' then return false; end if;
  select * into product_row from public.products where id::text=payment_row.metadata->>'product_id';
  if not found or product_row.seller_id=payment_row.user_id or product_row.file_path is null or product_row.file_path=''
    or product_row.seller_id::text<>payment_row.metadata->>'seller_id' then return false; end if;
  update public.payments set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now() where id=payment_row.id;
  insert into public.product_purchases(product_id,buyer_id,seller_id,payment_id,amount_minor,currency)
  values(product_row.id,payment_row.user_id,product_row.seller_id,payment_row.id,payment_row.amount_minor,product_row.currency)
  on conflict(payment_id) do nothing;
  insert into public.notifications(user_id,actor_id,type,title,body,data)
  values
    (product_row.seller_id,payment_row.user_id,'system','New digital product sale','Your product "'||product_row.title||'" has a verified purchase.',
      jsonb_build_object('product_id',product_row.id,'payment_reference',payment_row.reference)),
    (payment_row.user_id,product_row.seller_id,'system','Purchase confirmed','Your purchase of "'||product_row.title||'" is confirmed. Your download is ready.',
      jsonb_build_object('product_id',product_row.id,'payment_reference',payment_row.reference));
  return true;
end $function$;

create or replace function public.confirm_paystack_payment(p_reference text,p_amount_minor bigint,p_currency text,p_paid_at timestamptz default now())
returns boolean language plpgsql security definer set search_path = ''
as $function$
declare payment_row public.payments%rowtype; plan_code text; billing_interval text;
  period_start timestamptz:=coalesce(p_paid_at,now()); period_end timestamptz;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'')<>'service_role' then raise exception 'not authorized'; end if;
  select * into payment_row from public.payments where reference=p_reference for update;
  if not found or payment_row.purpose<>'subscription' then return false; end if;
  if payment_row.amount_minor<>p_amount_minor or upper(trim(payment_row.currency::text))<>upper(trim(p_currency)) then return false; end if;
  if not exists(select 1 from public.profiles p where p.id=payment_row.user_id and p.account_status::text='active') then
    if payment_row.status='pending' then update public.payments set status='paid',paid_at=period_start,updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('entitlement_blocked_reason','account_not_active','entitlement_blocked_at',now())
      where id=payment_row.id; end if;
    return false;
  end if;
  if payment_row.status='paid' then return true; end if;
  if payment_row.status<>'pending' then return false; end if;
  plan_code:=payment_row.metadata->>'plan_code'; billing_interval:=payment_row.metadata->>'billing_interval';
  if plan_code not in ('pro','school') or billing_interval not in ('monthly','annual') then return false; end if;
  period_end:=case when billing_interval='annual' then period_start+interval '1 year' else period_start+interval '1 month' end;
  update public.payments set status='paid',paid_at=period_start,updated_at=now() where id=payment_row.id;
  insert into public.subscriptions(user_id,plan_code,status,provider,provider_reference,current_period_start,current_period_end,updated_at)
  values(payment_row.user_id,plan_code,'active','paystack',p_reference,period_start,period_end,now())
  on conflict(user_id) where status in ('active','trialing','past_due')
  do update set plan_code=excluded.plan_code,status='active',provider='paystack',provider_reference=excluded.provider_reference,
    current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now();
  return true;
end $function$;
