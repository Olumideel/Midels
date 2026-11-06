-- Apply a restrictive active-account gate to every public table that already
-- exposes authenticated access. Existing ownership, enrollment, and visibility
-- policies remain in place and are ANDed with this account-status predicate.

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.account_status = 'active'::public.account_status
  );
$function$;

revoke all on function private.is_active_user() from public, anon;
grant execute on function private.is_active_user() to authenticated;

do $migration$
declare
  target record;
begin
  for target in
    select distinct schemaname, tablename
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and 'authenticated' = any(roles)
  loop
    execute format(
      'create policy account_active_gate on %I.%I as restrictive for all to authenticated using ((select private.is_active_user())) with check ((select private.is_active_user()))',
      target.schemaname,
      target.tablename
    );
  end loop;
end;
$migration$;
