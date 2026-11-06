create or replace function public.get_or_create_dm(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  me uuid := (select auth.uid());
  conversation_key text;
  conversation_id uuid;
  sender_is_active boolean;
  other_is_active boolean;
begin
  if me is null or other_user is null or me = other_user then
    raise exception 'invalid conversation';
  end if;

  select exists (
    select 1 from public.profiles
    where id = me and account_status = 'active'::public.account_status
  ) into sender_is_active;

  select exists (
    select 1 from public.profiles
    where id = other_user and account_status = 'active'::public.account_status
  ) into other_is_active;

  if not sender_is_active or not other_is_active
     or private.is_blocked(me, other_user) then
    raise exception 'messaging unavailable';
  end if;

  conversation_key := least(me::text, other_user::text) || ':' || greatest(me::text, other_user::text);

  insert into public.conversations(dm_key, is_group)
  values (conversation_key, false)
  on conflict (dm_key) do update
    set dm_key = excluded.dm_key
  returning id into conversation_id;

  insert into public.conversation_participants(conversation_id, user_id)
  values (conversation_id, me), (conversation_id, other_user)
  on conflict do nothing;

  return conversation_id;
end;
$function$;

revoke all on function public.get_or_create_dm(uuid) from public;
grant execute on function public.get_or_create_dm(uuid) to authenticated;
