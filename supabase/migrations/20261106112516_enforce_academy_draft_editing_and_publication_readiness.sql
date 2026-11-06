-- Enforce draft-only instructor editing and server-side course publication readiness.
-- Existing draft publishing remains supported. No rows or learner records are modified.

drop policy if exists courses_update_own on public.courses;
create policy courses_update_own
on public.courses
for update
to authenticated
using (
  instructor_id = (select auth.uid())
  and is_published = false
)
with check (
  instructor_id = (select auth.uid())
);

drop policy if exists lessons_update_own on public.course_lessons;
create policy lessons_update_own
on public.course_lessons
for update
to authenticated
using (
  is_published = false
  and exists (
    select 1
    from public.courses c
    where c.id = course_lessons.course_id
      and c.instructor_id = (select auth.uid())
      and c.is_published = false
  )
)
with check (
  exists (
    select 1
    from public.courses c
    where c.id = course_lessons.course_id
      and c.instructor_id = (select auth.uid())
      and c.is_published = false
  )
);

create or replace function public.enforce_course_publication_readiness()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.is_published
     and (tg_op = 'INSERT' or not old.is_published) then
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

drop trigger if exists enforce_course_publication_readiness on public.courses;
create trigger enforce_course_publication_readiness
before insert or update of is_published
on public.courses
for each row
execute function public.enforce_course_publication_readiness();
