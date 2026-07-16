-- Anonymous Supabase users carry the authenticated Postgres role. Prevent an
-- accidental dashboard toggle from letting them create the root profile row;
-- every other user-owned table ultimately depends on this profile foreign key.
drop policy if exists profiles_insert_owner on public.profiles;

create policy profiles_insert_owner
on public.profiles
for insert
to authenticated
with check (
  id = (select auth.uid())
  and not coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false)
);
