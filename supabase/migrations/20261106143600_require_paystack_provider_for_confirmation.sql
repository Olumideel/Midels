-- Ensure each Paystack confirmation RPC only settles payments created by Paystack.
-- This is a second line of defence behind the signed webhook's provider filter.

CREATE OR REPLACE FUNCTION public.confirm_course_payment(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamp with time zone DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  payment_row public.payments%rowtype;
  course_row public.courses%rowtype;
  enrollment_id uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  select * into payment_row
  from public.payments
  where reference=p_reference
  for update;

  if not found
     or payment_row.provider IS DISTINCT FROM 'paystack'
     or payment_row.purpose<>'course_enrollment'
     or payment_row.amount_minor<>p_amount_minor
     or upper(trim(payment_row.currency::text))<>upper(trim(p_currency))
     or payment_row.metadata->>'course_id' is null then
    return false;
  end if;

  if not exists(
    select 1 from public.profiles p
    where p.id=payment_row.user_id and p.account_status::text='active'
  ) then
    if payment_row.status='pending' then
      update public.payments
      set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'entitlement_blocked_reason','account_not_active',
            'entitlement_blocked_at',now())
      where id=payment_row.id;
    end if;
    return false;
  end if;

  if payment_row.status='paid' then
    -- A canonical enrollment alone is insufficient: require at least one
    -- qualifying paid course payment that has not been fully refunded.
    return exists(
      select 1
      from public.enrollments e
      where e.course_id::text=payment_row.metadata->>'course_id'
        and e.student_id=payment_row.user_id
        and e.revoked_at is null
    )
    and exists(
      select 1
      from public.payments qualifying_payment
      where qualifying_payment.user_id=payment_row.user_id
        and qualifying_payment.provider='paystack'
        and qualifying_payment.purpose='course_enrollment'
        and qualifying_payment.status='paid'
        and qualifying_payment.metadata->>'course_id'=payment_row.metadata->>'course_id'
        and coalesce((
          select sum(pr.amount_minor)
          from public.payment_refunds pr
          where pr.payment_id=qualifying_payment.id
            and pr.status='processed'
        ),0) < qualifying_payment.amount_minor
    );
  end if;
  if payment_row.status<>'pending' then return false; end if;

  select * into course_row
  from public.courses
  where id::text=payment_row.metadata->>'course_id'
    and instructor_id::text=payment_row.metadata->>'instructor_id'
    and is_published=true;
  if not found or course_row.instructor_id=payment_row.user_id then return false; end if;

  insert into public.enrollments(course_id,student_id,revoked_at)
  values(course_row.id,payment_row.user_id,null)
  on conflict(course_id,student_id) do update set revoked_at=null
  returning id into enrollment_id;

  update public.payments
  set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now()
  where id=payment_row.id;

  return enrollment_id is not null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_paystack_payment(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamp with time zone DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  payment_row public.payments%rowtype;
  plan_code text;
  billing_interval text;
  period_start timestamptz:=coalesce(p_paid_at,now());
  period_end timestamptz;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  select * into payment_row
  from public.payments
  where reference=p_reference
  for update;

  if not found
     or payment_row.provider IS DISTINCT FROM 'paystack'
     or payment_row.purpose<>'subscription' then
    return false;
  end if;
  if payment_row.amount_minor<>p_amount_minor
     or upper(trim(payment_row.currency::text))<>upper(trim(p_currency)) then
    return false;
  end if;

  if not exists(
    select 1 from public.profiles p
    where p.id=payment_row.user_id and p.account_status::text='active'
  ) then
    if payment_row.status='pending' then
      update public.payments
      set status='paid',paid_at=period_start,updated_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'entitlement_blocked_reason','account_not_active',
            'entitlement_blocked_at',now())
      where id=payment_row.id;
    end if;
    return false;
  end if;

  if payment_row.status='paid' then
    -- A settled payment is not proof that its subscription entitlement still exists.
    -- Keep verification idempotent without reporting success for a missing or mismatched subscription.
    return exists(
      select 1
      from public.subscriptions s
      where s.user_id=payment_row.user_id
        and s.provider='paystack'
        and s.provider_reference=p_reference
        and s.plan_code=payment_row.metadata->>'plan_code'
        and s.status in ('active','trialing','past_due')
        and s.current_period_start is not null
        and s.current_period_end is not null
        and s.current_period_start <= now()
        and s.current_period_end > now()
    );
  end if;
  if payment_row.status<>'pending' then return false; end if;

  plan_code:=payment_row.metadata->>'plan_code';
  billing_interval:=payment_row.metadata->>'billing_interval';
  if plan_code not in ('pro','school') or billing_interval not in ('monthly','annual') then
    return false;
  end if;

  period_end:=case
    when billing_interval='annual' then period_start+interval '1 year'
    else period_start+interval '1 month'
  end;

  update public.payments
  set status='paid',paid_at=period_start,updated_at=now()
  where id=payment_row.id;

  insert into public.subscriptions(
    user_id,plan_code,status,provider,provider_reference,
    current_period_start,current_period_end,updated_at
  )
  values(
    payment_row.user_id,plan_code,'active','paystack',p_reference,
    period_start,period_end,now()
  )
  on conflict(user_id) where status in ('active','trialing','past_due')
  do update set plan_code=excluded.plan_code,status='active',provider='paystack',
    provider_reference=excluded.provider_reference,
    current_period_start=excluded.current_period_start,
    current_period_end=excluded.current_period_end,updated_at=now();

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_product_payment(
  p_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_paid_at timestamp with time zone DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  payment_row public.payments%rowtype;
  product_row public.products%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  select * into payment_row
  from public.payments
  where reference=p_reference
  for update;

  if not found
     or payment_row.provider IS DISTINCT FROM 'paystack'
     or payment_row.purpose<>'product_purchase'
     or payment_row.amount_minor<>p_amount_minor
     or upper(trim(payment_row.currency::text))<>upper(trim(p_currency))
     or payment_row.metadata->>'product_id' is null then
    return false;
  end if;

  if not exists(
    select 1 from public.profiles p
    where p.id=payment_row.user_id and p.account_status::text='active'
  ) then
    if payment_row.status='pending' then
      update public.payments
      set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'entitlement_blocked_reason','account_not_active',
            'entitlement_blocked_at',now())
      where id=payment_row.id;
    end if;
    return false;
  end if;

  if payment_row.status='paid' then
    return exists(
      select 1 from public.product_purchases pp
      where pp.payment_id=payment_row.id
        and pp.product_id::text=payment_row.metadata->>'product_id'
        and pp.seller_id::text=payment_row.metadata->>'seller_id'
        and pp.buyer_id=payment_row.user_id
        and pp.refunded_at is null
    );
  end if;
  if payment_row.status<>'pending' then return false; end if;

  select * into product_row
  from public.products
  where id::text=payment_row.metadata->>'product_id';

  if not found
     or product_row.seller_id=payment_row.user_id
     or product_row.file_path is null
     or product_row.file_path=''
     or product_row.seller_id::text<>payment_row.metadata->>'seller_id' then
    return false;
  end if;

  update public.payments
  set status='paid',paid_at=coalesce(p_paid_at,now()),updated_at=now()
  where id=payment_row.id;

  insert into public.product_purchases(
    product_id,buyer_id,seller_id,payment_id,amount_minor,currency
  )
  values(
    product_row.id,payment_row.user_id,product_row.seller_id,
    payment_row.id,payment_row.amount_minor,product_row.currency
  )
  on conflict(payment_id) do nothing;

  insert into public.notifications(user_id,actor_id,type,title,body,data)
  values
    (product_row.seller_id,payment_row.user_id,'system','New digital product sale',
     'Your product "'||product_row.title||'" has a verified purchase.',
     jsonb_build_object('product_id',product_row.id,'payment_reference',payment_row.reference)),
    (payment_row.user_id,product_row.seller_id,'system','Purchase confirmed',
     'Your purchase of "'||product_row.title||'" is confirmed. Your download is ready.',
     jsonb_build_object('product_id',product_row.id,'payment_reference',payment_row.reference));

  return true;
end;
$function$;

-- Keep these confirmation entry points restricted to trusted server-side calls.
REVOKE ALL ON FUNCTION public.confirm_course_payment(text,bigint,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_paystack_payment(text,bigint,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_product_payment(text,bigint,text,timestamp with time zone) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_course_payment(text,bigint,text,timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_paystack_payment(text,bigint,text,timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_product_payment(text,bigint,text,timestamp with time zone) TO service_role;

DO $migration_assertions$
DECLARE
  signature text;
  function_oid regprocedure;
  function_definition text;
  signatures text[] := ARRAY[
    'public.confirm_course_payment(text,bigint,text,timestamp with time zone)',
    'public.confirm_paystack_payment(text,bigint,text,timestamp with time zone)',
    'public.confirm_product_payment(text,bigint,text,timestamp with time zone)'
  ];
BEGIN
  FOREACH signature IN ARRAY signatures LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Expected Paystack confirmation RPC missing: %', signature;
    END IF;

    SELECT pg_get_functiondef(function_oid::oid)
      INTO function_definition
    FROM pg_proc
    WHERE oid=function_oid::oid;

    IF position('payment_row.provider IS DISTINCT FROM ''paystack''' IN function_definition)=0 THEN
      RAISE EXCEPTION 'Provider binding missing from %', signature;
    END IF;
    IF NOT coalesce((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=function_oid::oid),false) THEN
      RAISE EXCEPTION 'Empty search_path missing from %', signature;
    END IF;
    IF has_function_privilege('anon',function_oid,'EXECUTE')
       OR has_function_privilege('authenticated',function_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'Client EXECUTE unexpectedly granted on %', signature;
    END IF;
    IF NOT has_function_privilege('service_role',function_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'service_role EXECUTE missing on %', signature;
    END IF;
  END LOOP;
END;
$migration_assertions$;
