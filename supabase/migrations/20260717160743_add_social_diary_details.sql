-- Small personal-expression features: orthogonal likes, hand-picked favorites,
-- spoiler-aware notes, tags, and first-party avatar uploads.

alter table public.watch_entries
  add column contains_spoilers boolean not null default false,
  add column tags text[] not null default '{}'::text[];

alter table public.watch_entries
  add constraint watch_entries_tags_count check (pg_catalog.cardinality(tags) <= 10),
  add constraint watch_entries_tags_format check (
    pg_catalog.cardinality(tags) = 0
    or pg_catalog.array_to_string(tags, ',')
      ~ '^([a-z0-9][a-z0-9-]{0,31})(,[a-z0-9][a-z0-9-]{0,31})*$'
  );

create table public.film_likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tmdb_id bigint not null references public.movies(tmdb_id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, tmdb_id)
);

create table public.profile_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tmdb_id bigint not null references public.movies(tmdb_id) on delete cascade,
  position smallint not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (user_id, tmdb_id),
  unique (user_id, position),
  constraint profile_favorites_position check (position between 1 and 4)
);

alter table public.film_likes enable row level security;
alter table public.film_likes force row level security;
alter table public.profile_favorites enable row level security;
alter table public.profile_favorites force row level security;

create policy film_likes_owner_all
on public.film_likes
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy profile_favorites_owner_all
on public.profile_favorites
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create view public.public_profile_favorites
with (security_barrier = true)
as
select favorite.user_id, favorite.tmdb_id, favorite.position, favorite.created_at
from public.profile_favorites as favorite
join public.profiles as profile on profile.id = favorite.user_id
where profile.is_public;

create or replace view public.public_diary_entries
with (security_barrier = true)
as
select
  entry.id,
  entry.user_id,
  entry.tmdb_id,
  entry.watched_on,
  entry.completion_status,
  entry.ranking_status,
  case
    when entry.visibility = 'public'::public.note_visibility
      or (
        entry.visibility = 'inherit'::public.note_visibility
        and profile.default_note_visibility = 'public'::public.note_visibility
      )
    then entry.note
    else null
  end as note,
  (
    entry.note is not null
    and (
      entry.visibility = 'public'::public.note_visibility
      or (
        entry.visibility = 'inherit'::public.note_visibility
        and profile.default_note_visibility = 'public'::public.note_visibility
      )
    )
  ) as note_is_public,
  entry.contains_spoilers,
  entry.tags,
  entry.is_rewatch,
  entry.created_at,
  entry.updated_at
from public.watch_entries as entry
join public.profiles as profile on profile.id = entry.user_id
where profile.is_public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_insert_own_folder
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy avatars_select_own_folder
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy avatars_delete_own_folder
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

revoke all on table public.film_likes from anon, authenticated;
revoke all on table public.profile_favorites from anon, authenticated;
revoke all on table public.public_profile_favorites from anon, authenticated;

grant select, insert, delete on table public.film_likes to authenticated;
grant select, insert, update, delete on table public.profile_favorites to authenticated;
grant select on table public.public_profile_favorites to anon, authenticated;
grant insert (contains_spoilers, tags) on public.watch_entries to authenticated;
grant update (contains_spoilers, tags) on public.watch_entries to authenticated;

comment on column public.watch_entries.contains_spoilers is
  'Whether the note should be concealed behind a spoiler warning in public UI.';
comment on column public.watch_entries.tags is
  'Up to ten normalized personal retrieval tags.';
