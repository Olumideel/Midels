-- Track each completed Paystack refund exactly once and revoke paid access only
-- after cumulative processed refunds cover the original payment amount.
create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  transaction_reference text not null,
  refund_reference text not null unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency character(3) not null,
  status text not null default 'processed' check (status = 'processed'),
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists payment_refunds_payment_id_idx
  on public.payment_refunds(payment_id);

alter table public.payment_refunds enable row level security;
revoke all on table public.payment_refunds from public, anon, authenticated;
grant all on table public.payment_refunds to service_role;

create or replace function public.record_paystack_refund(
  p_transaction_reference text,
  p_refund_reference text,
  p_amount_minor bigint,
  p_currency text,
  p_processed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_row public.payments%rowtype;
  refund_row public.payment_refunds%rowtype;
  refunded_total bigint;
  fully_refunded boolean;
  duplicate_event boolean;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'not authorized';
  end if;

  if nullif(trim(p_transaction_reference), '') is null
     or nullif(trim(p_refund_reference), '') is null
     or p_amount_minor is null or p_amount_minor <= 0
     or char_length(trim(coalesce(p_currency, ''))) <> 3 then
    raise exception 'invalid refund data';
  end if;

  select * into payment_row
  from public.payments
  where reference = p_transaction_reference
    and provider = 'paystack'
  for update;

  if not found or payment_row.status not in ('paid', 'refunded') then
    raise exception 'matching paid Paystack payment not found';
  end if;

  if upper(trim(payment_row.currency::text)) <> upper(trim(p_currency)) then
    raise exception 'refund currency does not match payment';
  end if;

  select exists (
    select 1 from public.payment_refunds
    where refund_reference = p_refund_reference
  ) into duplicate_event;

  insert into public.payment_refunds (
    payment_id, transaction_reference, refund_reference,
    amount_minor, currency, status, processed_at
  )
  values (
    payment_row.id, p_transaction_reference, p_refund_reference,
    p_amount_minor, upper(trim(p_currency))::character(3), 'processed',
    coalesce(p_processed_at, now())
  )
  on conflict (refund_reference) do nothing;

  select * into refund_row
  from public.payment_refunds
  where refund_reference = p_refund_reference
  for update;

  if refund_row.payment_id <> payment_row.id
     or refund_row.transaction_reference <> p_transaction_reference
     or refund_row.amount_minor <> p_amount_minor
     or upper(trim(refund_row.currency::text)) <> upper(trim(p_currency)) then
    raise exception 'refund reference was already used with different details';
  end if;

  select coalesce(sum(amount_minor), 0)
  into refunded_total
  from public.payment_refunds
  where payment_id = payment_row.id
    and status = 'processed';

  if refunded_total > payment_row.amount_minor then
    raise exception 'cumulative refunds exceed original payment amount';
  end if;

  fully_refunded := refunded_total >= payment_row.amount_minor
                    or payment_row.status = 'refunded';

  if fully_refunded then
    update public.payments
    set status = 'refunded', updated_at = now()
    where id = payment_row.id
      and status in ('paid', 'refunded');

    update public.product_purchases
    set refunded_at = coalesce(refunded_at, coalesce(p_processed_at, now()))
    where payment_id = payment_row.id;

    if payment_row.purpose = 'course_enrollment'
       and nullif(payment_row.metadata->>'course_id', '') is not null then
      update public.enrollments
      set revoked_at = coalesce(revoked_at, coalesce(p_processed_at, now()))
      where course_id::text = payment_row.metadata->>'course_id'
        and student_id = payment_row.user_id;

      update public.course_certificates
      set revoked_at = coalesce(revoked_at, coalesce(p_processed_at, now()))
      where course_id::text = payment_row.metadata->>'course_id'
        and student_id = payment_row.user_id;
    end if;

    if payment_row.purpose = 'subscription' then
      update public.subscriptions
      set status = 'cancelled',
          current_period_end = least(coalesce(current_period_end, now()), now()),
          updated_at = now()
      where provider = 'paystack'
        and provider_reference = p_transaction_reference
        and status in ('active', 'trialing', 'past_due');
    end if;
  end if;

  return jsonb_build_object(
    'processed', true,
    'duplicate', duplicate_event,
    'refunded_total_minor', refunded_total,
    'original_amount_minor', payment_row.amount_minor,
    'fully_refunded', fully_refunded
  );
end;
$function$;

revoke all on function public.record_paystack_refund(text, text, bigint, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_paystack_refund(text, text, bigint, text, timestamptz)
  to service_role;
