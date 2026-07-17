-- Make inherited-note visibility an explicit profile preference. Existing and
-- future profiles default to private, so making a profile public cannot
-- retroactively expose old notes without a separate opt-in.
alter table public.profiles
add column default_note_visibility public.note_visibility not null default 'private';

comment on column public.profiles.default_note_visibility is
  'Visibility applied to watch-entry notes whose visibility is inherit.';

alter table public.profiles
add constraint profiles_avatar_url_https check (
  avatar_url is null or avatar_url ~ '^https://'
);

grant update (default_note_visibility) on public.profiles to authenticated;

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
  entry.is_rewatch,
  entry.created_at,
  entry.updated_at
from public.watch_entries as entry
join public.profiles as profile on profile.id = entry.user_id
where profile.is_public;
