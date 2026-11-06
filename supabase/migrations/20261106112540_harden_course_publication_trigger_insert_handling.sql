-- Avoid referencing OLD during INSERT execution in the publication guard.
create or replace function public.enforce_course_publication_readiness()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  was_published boolean := false;
begin
  if tg_op = 'UPDATE' then
    was_published := old.is_published;
  end if;

  if new.is_published and not was_published then
    if nullif(btrim(new.title), '') is null then
      raise exception using
        errcode = '23514',
        message = 'A course needs a title before publication.';
    end if;

    if new.price_minor < 0 or new.currency <> 'NGN' then
      raise exception using
        errcode = '23514',
        message = 'A course must have a non-negative NGN price before publication.';
    end if;

    if not exists (
      select 1
      from public.course_lessons l
      where l.course_id = new.id
        and l.is_published = true
    ) then
      raise exception using
        errcode = '23514',
        message = 'Publish at least one lesson before publishing the course.';
    end if;
  end if;

  return new;
end;
$$;
