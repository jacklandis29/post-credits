create table public.reviews (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  body text not null,
  visibility public.note_visibility not null default 'private',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint reviews_user_movie_unique unique (user_id, tmdb_id),
  constraint reviews_body_present check (pg_catalog.char_length(pg_catalog.btrim(body)) > 0),
  constraint reviews_body_length check (pg_catalog.char_length(body) <= 50000),
  constraint reviews_visibility_explicit check (visibility in ('private'::public.note_visibility, 'public'::public.note_visibility))
);

create index reviews_user_updated_idx on public.reviews (user_id, updated_at desc);
create trigger reviews_set_updated_at before update on public.reviews for each row execute function public.set_updated_at();
alter table public.reviews enable row level security;
alter table public.reviews force row level security;
create policy reviews_owner_all on public.reviews for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create view public.public_reviews with (security_barrier = true) as
select review.id, review.user_id, review.tmdb_id, review.body, review.created_at, review.updated_at
from public.reviews as review
join public.profiles as profile on profile.id = review.user_id
where profile.is_public and review.visibility = 'public'::public.note_visibility;

revoke all on table public.reviews from public, anon, authenticated, service_role;
revoke all on table public.public_reviews from public, anon, authenticated, service_role;
grant select, delete on table public.reviews to authenticated;
grant insert (user_id, tmdb_id, body, visibility) on public.reviews to authenticated;
grant update (body, visibility) on public.reviews to authenticated;
grant select on table public.public_reviews to anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated, service_role;
comment on table public.reviews is 'One revisitable long-form film review per user and film, independent of dated watches.';
