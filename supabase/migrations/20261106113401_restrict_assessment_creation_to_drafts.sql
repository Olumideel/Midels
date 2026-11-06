-- Prevent instructors from inserting assessments already marked as published.
-- Publishing remains available through publish_course_assessment(), which checks
-- ownership and requires at least one question.

drop policy if exists course_assessments_insert_own on public.course_assessments;

create policy course_assessments_insert_own
on public.course_assessments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.courses c
    where c.id = course_assessments.course_id
      and c.instructor_id = (select auth.uid())
      and course_assessments.is_published = false
  )
);
