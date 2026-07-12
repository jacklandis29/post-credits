-- Post Credits v1 schema
-- Target: Supabase Postgres 15+

begin;

create schema if not exists extensions;
create schema if not exists private;
create extension if not exists citext with schema extensions;

revoke all on schema private from public, anon, authenticated, service_role;

create type public.note_visibility as enum ('inherit', 'private', 'public');
create type public.watch_completion_status as enum ('completed', 'dnf');
create type public.watch_ranking_status as enum (
  'pending',
  'in_progress',
  'complete',
  'not_applicable'
);
create type public.verdict as enum ('liked', 'fine', 'disliked');
create type public.placement_confidence as enum ('exact', 'provisional');
create type public.ranking_reason as enum ('initial_log', 'rewatch', 'manual_rerank');
create type public.ranking_session_status as enum ('active', 'committed', 'abandoned');

create function public.is_valid_timezone(p_timezone text)
returns boolean
language sql
stable
parallel safe
set search_path = pg_catalog
as $$
  select exists (
    select 1
    from pg_catalog.pg_timezone_names
    where name = p_timezone
  );
$$;

create function public.is_valid_hex_color(p_color text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select p_color ~ '^#[0-9A-Fa-f]{6}$';
$$;

create function public.is_valid_swatch_array(p_swatches jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when pg_catalog.jsonb_typeof(p_swatches) = 'array' then
      pg_catalog.jsonb_array_length(p_swatches) = 5
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements_text(p_swatches) as swatch(color)
        where color is null or color !~ '^#[0-9A-Fa-f]{6}$'
      )
    else false
  end;
$$;

create function public.verdict_priority(p_verdict public.verdict)
returns smallint
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case p_verdict
    when 'liked'::public.verdict then 1::smallint
    when 'fine'::public.verdict then 2::smallint
    when 'disliked'::public.verdict then 3::smallint
  end;
$$;

create function public.derived_score(
  p_verdict public.verdict,
  p_bucket_rank bigint,
  p_bucket_size bigint,
  p_total_ranked bigint
)
returns numeric
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_total_ranked < 5 then null
    when p_bucket_rank < 1
      or p_bucket_size < 1
      or p_bucket_rank > p_bucket_size then null
    when p_bucket_size = 1 then
      case p_verdict
        when 'liked'::public.verdict then 8.5
        when 'fine'::public.verdict then 5.5
        when 'disliked'::public.verdict then 2.0
      end
    else round(
      case p_verdict
        when 'liked'::public.verdict then
          7.0 + 3.0 * ((p_bucket_size - p_bucket_rank)::numeric / (p_bucket_size - 1))
        when 'fine'::public.verdict then
          4.0 + 2.9 * ((p_bucket_size - p_bucket_rank)::numeric / (p_bucket_size - 1))
        when 'disliked'::public.verdict then
          0.0 + 3.9 * ((p_bucket_size - p_bucket_rank)::numeric / (p_bucket_size - 1))
      end,
      1
    )
  end;
$$;

create function public.fractional_midpoint(
  p_lower_bound numeric,
  p_upper_bound numeric
)
returns numeric
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when p_lower_bound is null and p_upper_bound is null then 1024::numeric
    when p_lower_bound is null then p_upper_bound / 2
    when p_upper_bound is null then p_lower_bound + 1024
    else (p_lower_bound + p_upper_bound) / 2
  end;
$$;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext not null,
  display_name text not null,
  avatar_url text,
  bio text,
  timezone text not null default 'UTC',
  is_public boolean not null default false,
  is_discoverable boolean not null default false,
  -- Server-controlled release gate; users cannot grant this column to themselves.
  public_access_approved boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint profiles_username_unique unique (username),
  constraint profiles_username_length check (pg_catalog.char_length(username::text) between 3 and 30),
  constraint profiles_username_format check (
    username::text = pg_catalog.lower(username::text)
    and username::text ~ '^[a-z0-9][a-z0-9_]*[a-z0-9]$'
  ),
  constraint profiles_display_name_length check (
    pg_catalog.char_length(pg_catalog.btrim(display_name)) between 1 and 80
  ),
  constraint profiles_avatar_url_length check (
    avatar_url is null or pg_catalog.char_length(avatar_url) <= 2048
  ),
  constraint profiles_bio_length check (bio is null or pg_catalog.char_length(bio) <= 300),
  constraint profiles_timezone_valid check (public.is_valid_timezone(timezone)),
  constraint profiles_discoverability_requires_public check (not is_discoverable or is_public),
  constraint profiles_public_access_requires_approval check (
    not is_public or public_access_approved
  )
);

-- Operational cache-miss budget. This schema is not exposed through PostgREST;
-- callers can consume only through the fixed-policy RPC below.
create table private.tmdb_cache_budgets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count smallint not null,
  constraint tmdb_cache_budgets_count_range check (request_count between 1 and 20)
);

alter table private.tmdb_cache_budgets enable row level security;
alter table private.tmdb_cache_budgets force row level security;

revoke all on table private.tmdb_cache_budgets
  from public, anon, authenticated, service_role;

create table public.movies (
  tmdb_id bigint primary key,
  title text not null,
  original_title text not null,
  overview text not null default '',
  release_date date,
  runtime_minutes integer,
  poster_path text,
  backdrop_path text,
  genres jsonb not null default '[]'::jsonb,
  original_language text,
  production_countries jsonb not null default '[]'::jsonb,
  director jsonb,
  principal_cast jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  is_adult boolean not null default false,
  metadata_refreshed_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint movies_tmdb_id_positive check (tmdb_id > 0),
  constraint movies_title_present check (pg_catalog.char_length(pg_catalog.btrim(title)) > 0),
  constraint movies_original_title_present check (
    pg_catalog.char_length(pg_catalog.btrim(original_title)) > 0
  ),
  constraint movies_runtime_positive check (runtime_minutes is null or runtime_minutes > 0),
  constraint movies_genres_array check (pg_catalog.jsonb_typeof(genres) = 'array'),
  constraint movies_countries_array check (pg_catalog.jsonb_typeof(production_countries) = 'array'),
  constraint movies_cast_array check (pg_catalog.jsonb_typeof(principal_cast) = 'array'),
  constraint movies_keywords_array check (pg_catalog.jsonb_typeof(keywords) = 'array'),
  constraint movies_v1_excludes_adult check (not is_adult)
);

create table public.movie_palettes (
  tmdb_id bigint primary key references public.movies(tmdb_id) on delete cascade,
  swatches jsonb not null,
  dominant_color text not null,
  secondary_color text not null,
  accent_color text not null,
  foreground_color text not null,
  source_backdrop_path text,
  algorithm_version text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint movie_palettes_swatches_valid check (public.is_valid_swatch_array(swatches)),
  constraint movie_palettes_dominant_valid check (public.is_valid_hex_color(dominant_color)),
  constraint movie_palettes_secondary_valid check (public.is_valid_hex_color(secondary_color)),
  constraint movie_palettes_accent_valid check (public.is_valid_hex_color(accent_color)),
  constraint movie_palettes_foreground_valid check (public.is_valid_hex_color(foreground_color)),
  constraint movie_palettes_algorithm_present check (
    pg_catalog.char_length(pg_catalog.btrim(algorithm_version)) > 0
  )
);

create table public.watch_entries (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  -- Intentionally no default: the app must send the user's chosen local calendar date.
  watched_on date not null,
  completion_status public.watch_completion_status not null,
  ranking_status public.watch_ranking_status not null,
  note text,
  visibility public.note_visibility not null default 'inherit',
  is_rewatch boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint watch_entries_owner_movie_unique unique (id, user_id, tmdb_id),
  constraint watch_entries_note_length check (note is null or pg_catalog.char_length(note) <= 2000),
  constraint watch_entries_state_valid check (
    (completion_status = 'dnf'::public.watch_completion_status
      and ranking_status = 'not_applicable'::public.watch_ranking_status
      and not is_rewatch)
    or
    (completion_status = 'completed'::public.watch_completion_status
      and ranking_status in (
        'pending'::public.watch_ranking_status,
        'in_progress'::public.watch_ranking_status,
        'complete'::public.watch_ranking_status
      ))
  )
);

create table public.watchlist_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tmdb_id bigint not null references public.movies(tmdb_id) on delete cascade,
  added_at timestamptz not null default pg_catalog.now(),
  constraint watchlist_items_user_movie_unique unique (user_id, tmdb_id)
);

create table public.ranking_sessions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  watch_entry_id uuid references public.watch_entries(id) on delete set null,
  reason public.ranking_reason not null,
  status public.ranking_session_status not null default 'active',
  target_verdict public.verdict not null,
  original_verdict public.verdict,
  original_sort_position numeric(30, 15),
  original_rank_snapshot integer,
  lower_bound_position numeric(30, 15),
  upper_bound_position numeric(30, 15),
  current_provisional_position numeric(30, 15) not null,
  skip_count smallint not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  last_activity_at timestamptz not null default pg_catalog.now(),
  committed_at timestamptz,
  constraint ranking_sessions_owner_subject_unique unique (id, user_id, subject_tmdb_id),
  constraint ranking_sessions_skip_limit check (skip_count between 0 and 2),
  constraint ranking_sessions_original_rank_positive check (
    original_rank_snapshot is null or original_rank_snapshot > 0
  ),
  constraint ranking_sessions_original_snapshot_valid check (
    (reason = 'initial_log'::public.ranking_reason
      and original_verdict is null
      and original_sort_position is null
      and original_rank_snapshot is null)
    or
    (reason in ('rewatch'::public.ranking_reason, 'manual_rerank'::public.ranking_reason)
      and original_verdict is not null
      and original_sort_position is not null
      and original_rank_snapshot is not null)
  ),
  constraint ranking_sessions_bounds_ordered check (
    lower_bound_position is null
    or upper_bound_position is null
    or lower_bound_position <= upper_bound_position
  ),
  constraint ranking_sessions_position_positive check (current_provisional_position > 0),
  constraint ranking_sessions_position_in_bounds check (
    (lower_bound_position is null or current_provisional_position >= lower_bound_position)
    and (upper_bound_position is null or current_provisional_position <= upper_bound_position)
  ),
  constraint ranking_sessions_commit_timestamp_valid check (
    (status = 'committed'::public.ranking_session_status) = (committed_at is not null)
  )
);

create unique index ranking_sessions_one_unresolved_per_user
  on public.ranking_sessions (user_id)
  where status in (
    'active'::public.ranking_session_status,
    'abandoned'::public.ranking_session_status
  );

create table public.ranked_films (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  verdict public.verdict not null,
  -- Lower positions sort first within a verdict bucket. Gaps are intentionally fractional.
  sort_position numeric(30, 15) not null,
  placement_confidence public.placement_confidence not null,
  comparison_count smallint not null default 0,
  active_ranking_session_id uuid,
  first_ranked_at timestamptz not null default pg_catalog.now(),
  last_ranked_at timestamptz not null default pg_catalog.now(),
  constraint ranked_films_user_movie_unique unique (user_id, tmdb_id),
  constraint ranked_films_unique_position
    unique (user_id, verdict, sort_position) deferrable initially immediate,
  constraint ranked_films_active_session_unique unique (active_ranking_session_id),
  constraint ranked_films_sort_position_positive check (sort_position > 0),
  constraint ranked_films_comparison_limit check (comparison_count between 0 and 5),
  constraint ranked_films_active_is_provisional check (
    active_ranking_session_id is null
    or placement_confidence = 'provisional'::public.placement_confidence
  ),
  constraint ranked_films_timestamps_ordered check (last_ranked_at >= first_ranked_at),
  constraint ranked_films_active_session_fk
    foreign key (active_ranking_session_id, user_id, tmdb_id)
    references public.ranking_sessions(id, user_id, subject_tmdb_id)
    on delete cascade
);

create table public.ranking_session_answers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  session_id uuid not null references public.ranking_sessions(id) on delete cascade,
  opponent_tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  winner_tmdb_id bigint references public.movies(tmdb_id) on delete restrict,
  sequence_number smallint not null,
  bounds_before jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint ranking_session_answers_sequence_unique unique (session_id, sequence_number),
  constraint ranking_session_answers_opponent_unique unique (session_id, opponent_tmdb_id),
  constraint ranking_session_answers_sequence_range check (sequence_number between 1 and 7),
  constraint ranking_session_answers_bounds_object check (
    pg_catalog.jsonb_typeof(bounds_before) = 'object'
    and bounds_before ?& array[
      'lower_bound_position',
      'upper_bound_position',
      'current_provisional_position'
    ]
  )
);

create table public.comparisons (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  opponent_tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  winner_tmdb_id bigint references public.movies(tmdb_id) on delete restrict,
  session_id uuid not null,
  sequence_number smallint not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint comparisons_session_sequence_unique unique (session_id, sequence_number),
  constraint comparisons_distinct_films check (subject_tmdb_id <> opponent_tmdb_id),
  constraint comparisons_winner_is_participant check (
    winner_tmdb_id is null
    or winner_tmdb_id = subject_tmdb_id
    or winner_tmdb_id = opponent_tmdb_id
  ),
  constraint comparisons_session_owner_subject_fk
    foreign key (session_id, user_id, subject_tmdb_id)
    references public.ranking_sessions(id, user_id, subject_tmdb_id)
    on delete cascade
);

create table public.rank_history (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tmdb_id bigint not null references public.movies(tmdb_id) on delete restrict,
  session_id uuid not null unique references public.ranking_sessions(id) on delete cascade,
  rank_before integer,
  rank_after integer not null,
  verdict_before public.verdict,
  verdict_after public.verdict not null,
  reason public.ranking_reason not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint rank_history_rank_before_positive check (rank_before is null or rank_before > 0),
  constraint rank_history_rank_after_positive check (rank_after > 0),
  constraint rank_history_initial_before_null check (
    reason <> 'initial_log'::public.ranking_reason
    or (rank_before is null and verdict_before is null)
  )
);

create index watch_entries_user_date_idx
  on public.watch_entries (user_id, watched_on desc, created_at desc);
create index watch_entries_user_movie_idx
  on public.watch_entries (user_id, tmdb_id, watched_on desc, created_at desc);
create index watch_entries_completed_stats_idx
  on public.watch_entries (user_id, watched_on, tmdb_id)
  where completion_status = 'completed'::public.watch_completion_status;
create index watchlist_items_user_added_idx
  on public.watchlist_items (user_id, added_at desc);
create index ranking_sessions_user_activity_idx
  on public.ranking_sessions (user_id, last_activity_at desc);
create index ranking_sessions_subject_idx
  on public.ranking_sessions (user_id, subject_tmdb_id, created_at desc);
create index ranked_films_canon_order_idx
  on public.ranked_films (user_id, verdict, sort_position);
create index comparisons_user_subject_idx
  on public.comparisons (user_id, subject_tmdb_id, created_at desc);
create index rank_history_user_movie_idx
  on public.rank_history (user_id, tmdb_id, created_at desc);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger movies_set_updated_at
before update on public.movies
for each row execute function public.set_updated_at();

create trigger movie_palettes_set_updated_at
before update on public.movie_palettes
for each row execute function public.set_updated_at();

create trigger watch_entries_set_updated_at
before update on public.watch_entries
for each row execute function public.set_updated_at();

-- Rewatch derivation is a cross-row invariant. Transaction-scoped advisory
-- locks serialize every mutation of the same user/movie pair, including two
-- simultaneous first completed inserts. Pair changes lock both keys in stable
-- numeric order to avoid lock-order deadlocks.
create function public.lock_watch_entry_pair()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_old_key bigint;
  v_new_key bigint;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_key := pg_catalog.hashtextextended(old.user_id::text || ':' || old.tmdb_id::text, 0);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new_key := pg_catalog.hashtextextended(new.user_id::text || ':' || new.tmdb_id::text, 0);
  end if;

  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(v_new_key);
  elsif tg_op = 'DELETE' then
    perform pg_catalog.pg_advisory_xact_lock(v_old_key);
  elsif v_old_key = v_new_key then
    perform pg_catalog.pg_advisory_xact_lock(v_old_key);
  else
    perform pg_catalog.pg_advisory_xact_lock(least(v_old_key, v_new_key));
    perform pg_catalog.pg_advisory_xact_lock(greatest(v_old_key, v_new_key));
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger watch_entries_00_lock_pair
before insert or update or delete on public.watch_entries
for each row execute function public.lock_watch_entry_pair();

-- Clients choose only completed versus DNF at insert time. Ranking state is
-- derived here so a row cannot claim to be ranked before a canon row exists.
create function public.normalize_new_watch_entry_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.completion_status = 'dnf'::public.watch_completion_status then
    new.ranking_status := 'not_applicable'::public.watch_ranking_status;
  elsif exists (
    select 1
    from public.ranked_films
    where user_id = new.user_id
      and tmdb_id = new.tmdb_id
  ) then
    -- A completed rewatch keeps the existing canon unless the user opts in to
    -- a new session, at which point begin_ranking_session sets in_progress.
    new.ranking_status := 'complete'::public.watch_ranking_status;
  else
    new.ranking_status := 'pending'::public.watch_ranking_status;
  end if;
  return new;
end;
$$;

create trigger watch_entries_normalize_new_state
before insert on public.watch_entries
for each row execute function public.normalize_new_watch_entry_state();

-- Rewatch state is derived from completed entries in local-date order. A prior
-- DNF never makes a later completion a rewatch. The AFTER triggers also repair
-- later rows when an older viewing is backfilled or its date is edited.
create function public.set_watch_entry_rewatch_flag()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  new.is_rewatch :=
    new.completion_status = 'completed'::public.watch_completion_status
    and exists (
      select 1
      from public.watch_entries as prior
      where prior.user_id = new.user_id
        and prior.tmdb_id = new.tmdb_id
        and prior.id <> new.id
        and prior.completion_status = 'completed'::public.watch_completion_status
        and (prior.watched_on, prior.created_at, prior.id)
          < (new.watched_on, new.created_at, new.id)
    );
  return new;
end;
$$;

create trigger watch_entries_derive_rewatch
before insert or update on public.watch_entries
for each row execute function public.set_watch_entry_rewatch_flag();

create function public.recompute_rewatch_flags_for_pair(p_user_id uuid, p_tmdb_id bigint)
returns void
language sql
security definer
set search_path = pg_catalog
as $$
  update public.watch_entries as target
  set is_rewatch = (
    target.completion_status = 'completed'::public.watch_completion_status
    and exists (
      select 1
      from public.watch_entries as prior
      where prior.user_id = target.user_id
        and prior.tmdb_id = target.tmdb_id
        and prior.id <> target.id
        and prior.completion_status = 'completed'::public.watch_completion_status
        and (prior.watched_on, prior.created_at, prior.id)
          < (target.watched_on, target.created_at, target.id)
    )
  )
  where target.user_id = p_user_id
    and target.tmdb_id = p_tmdb_id;
$$;

create function public.recompute_rewatch_flags_after_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_rewatch_flags_for_pair(old.user_id, old.tmdb_id);
  elsif tg_op = 'INSERT' then
    perform public.recompute_rewatch_flags_for_pair(new.user_id, new.tmdb_id);
  else
    if (new.user_id, new.tmdb_id) is distinct from (old.user_id, old.tmdb_id) then
      perform public.recompute_rewatch_flags_for_pair(old.user_id, old.tmdb_id);
    end if;
    perform public.recompute_rewatch_flags_for_pair(new.user_id, new.tmdb_id);
  end if;

  return null;
end;
$$;

create trigger watch_entries_recompute_rewatch_after_insert
after insert on public.watch_entries
for each row execute function public.recompute_rewatch_flags_after_change();

create trigger watch_entries_recompute_rewatch_after_delete
after delete on public.watch_entries
for each row execute function public.recompute_rewatch_flags_after_change();

create trigger watch_entries_recompute_rewatch_after_material_update
after update of user_id, tmdb_id, watched_on, completion_status, created_at
on public.watch_entries
for each row execute function public.recompute_rewatch_flags_after_change();

-- A completed log removes the private watchlist item in the same transaction.
-- A DNF deliberately leaves it alone.
create function public.remove_completed_watch_from_watchlist()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.completion_status = 'completed'::public.watch_completion_status
    and (
      tg_op = 'INSERT'
      or old.completion_status is distinct from new.completion_status
      or old.tmdb_id is distinct from new.tmdb_id
      or old.user_id is distinct from new.user_id
    ) then
    delete from public.watchlist_items
    where user_id = new.user_id
      and tmdb_id = new.tmdb_id;
  end if;
  return null;
end;
$$;

create trigger watch_entries_remove_completed_watchlist_item
after insert or update on public.watch_entries
for each row execute function public.remove_completed_watch_from_watchlist();

-- Match the v1 UI rule at the database boundary: Watchlist is for films not yet
-- completed. The shared advisory pair lock serializes this check with watch
-- insert/conversion triggers, preventing a completed-watch/Watchlist race.
create function public.reject_completed_watchlist_item()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from new.user_id then
    raise exception 'Cannot add a Watchlist item for another user'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || new.tmdb_id::text, 0)
  );

  if exists (
    select 1
    from public.watch_entries
    where user_id = new.user_id
      and tmdb_id = new.tmdb_id
      and completion_status = 'completed'::public.watch_completion_status
  ) or exists (
    select 1
    from public.ranked_films
    where user_id = new.user_id
      and tmdb_id = new.tmdb_id
  ) then
    raise exception 'A completed or canon film cannot be added to the Watchlist'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger watchlist_items_reject_completed
before insert on public.watchlist_items
for each row execute function public.reject_completed_watchlist_item();

create function public.convert_dnf_to_completed(p_watch_entry_id uuid)
returns public.watch_entries
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry public.watch_entries%rowtype;
  v_has_canon boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_entry
  from public.watch_entries
  where id = p_watch_entry_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Watch entry not found' using errcode = '42501';
  end if;
  if v_entry.completion_status <> 'dnf'::public.watch_completion_status then
    raise exception 'Only a DNF entry can be converted to completed'
      using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.ranked_films
    where user_id = v_user_id
      and tmdb_id = v_entry.tmdb_id
  ) into v_has_canon;

  update public.watch_entries
  set completion_status = 'completed'::public.watch_completion_status,
    ranking_status = case
      when v_has_canon then 'complete'::public.watch_ranking_status
      else 'pending'::public.watch_ranking_status
    end
  where id = p_watch_entry_id
  returning * into v_entry;

  return v_entry;
end;
$$;

-- The authenticated application server uses its service-role client to cache a
-- selected TMDB result so logging and Watchlist inserts can satisfy their movie
-- foreign keys. This RPC trusts only service_role; the route authenticates the
-- initiating user before calling it. On conflict it fills missing fields but
-- never overwrites established global metadata.
create function public.cache_tmdb_movie(
  p_tmdb_id bigint,
  p_title text,
  p_original_title text,
  p_overview text,
  p_release_date date,
  p_runtime_minutes integer,
  p_poster_path text,
  p_backdrop_path text,
  p_genres jsonb,
  p_director jsonb,
  p_original_language text default null,
  p_production_countries jsonb default '[]'::jsonb,
  p_principal_cast jsonb default '[]'::jsonb,
  p_keywords jsonb default '[]'::jsonb
)
returns public.movies
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_movie public.movies%rowtype;
  v_original_language text := nullif(pg_catalog.btrim(p_original_language), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if p_tmdb_id is null or p_tmdb_id <= 0 then
    raise exception 'TMDB ID must be a positive integer' using errcode = '22023';
  end if;
  if p_title is null
    or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 500 then
    raise exception 'Movie title must contain 1 to 500 characters'
      using errcode = '22023';
  end if;
  if p_original_title is null
    or pg_catalog.char_length(pg_catalog.btrim(p_original_title)) not between 1 and 500 then
    raise exception 'Original title must contain 1 to 500 characters'
      using errcode = '22023';
  end if;
  if pg_catalog.char_length(coalesce(p_overview, '')) > 20000 then
    raise exception 'Overview exceeds 20,000 characters' using errcode = '22023';
  end if;
  if p_release_date is not null
    and (p_release_date < date '1870-01-01' or p_release_date > current_date + 7305) then
    raise exception 'Release date is outside the supported range' using errcode = '22023';
  end if;
  if p_runtime_minutes is not null
    and (p_runtime_minutes < 1 or p_runtime_minutes > 1440) then
    raise exception 'Runtime must be between 1 and 1,440 minutes'
      using errcode = '22023';
  end if;
  if p_poster_path is not null
    and (
      pg_catalog.char_length(p_poster_path) > 512
      or p_poster_path !~ '^/[A-Za-z0-9_./-]+$'
      or p_poster_path ~ '\.\.'
    ) then
    raise exception 'Poster path must be a safe TMDB-relative path'
      using errcode = '22023';
  end if;
  if p_backdrop_path is not null
    and (
      pg_catalog.char_length(p_backdrop_path) > 512
      or p_backdrop_path !~ '^/[A-Za-z0-9_./-]+$'
      or p_backdrop_path ~ '\.\.'
    ) then
    raise exception 'Backdrop path must be a safe TMDB-relative path'
      using errcode = '22023';
  end if;

  if p_genres is null or pg_catalog.jsonb_typeof(p_genres) <> 'array' then
    raise exception 'Genres must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_genres) > 32
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_genres) as genre(value)
      where pg_catalog.jsonb_typeof(value) <> 'string'
        or pg_catalog.char_length(pg_catalog.btrim(value #>> '{}')) not between 1 and 100
    ) then
    raise exception 'Genres must contain at most 32 non-empty string values'
      using errcode = '22023';
  end if;

  if p_director is null or pg_catalog.jsonb_typeof(p_director) <> 'array' then
    raise exception 'Director must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_director) > 16
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_director) as director_name(value)
      where pg_catalog.jsonb_typeof(value) <> 'string'
        or pg_catalog.char_length(pg_catalog.btrim(value #>> '{}')) not between 1 and 200
    ) then
    raise exception 'Director must contain at most 16 non-empty string values'
      using errcode = '22023';
  end if;

  if v_original_language is not null
    and (
      pg_catalog.char_length(v_original_language) > 16
      or v_original_language <> pg_catalog.lower(v_original_language)
      or v_original_language !~ '^[a-z][a-z0-9-]*$'
    ) then
    raise exception 'Original language must be a lowercase language identifier up to 16 characters'
      using errcode = '22023';
  end if;

  if p_production_countries is null
    or pg_catalog.jsonb_typeof(p_production_countries) <> 'array' then
    raise exception 'Production countries must be a JSON array'
      using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_production_countries) > 32
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_production_countries) as country(value)
      where pg_catalog.jsonb_typeof(value) <> 'object'
        or not (value ?& array['iso_3166_1', 'name'])
        or pg_catalog.jsonb_typeof(value -> 'iso_3166_1') <> 'string'
        or (value ->> 'iso_3166_1') !~ '^[A-Z]{2}$'
        or pg_catalog.jsonb_typeof(value -> 'name') <> 'string'
        or pg_catalog.char_length(pg_catalog.btrim(value ->> 'name')) not between 1 and 200
    ) then
    raise exception 'Production countries must contain at most 32 ISO country objects'
      using errcode = '22023';
  end if;

  if p_principal_cast is null or pg_catalog.jsonb_typeof(p_principal_cast) <> 'array' then
    raise exception 'Principal cast must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_principal_cast) > 12
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_principal_cast) as cast_member(value)
      where pg_catalog.jsonb_typeof(value) <> 'object'
        or not (value ?& array['tmdb_id', 'name', 'character', 'order'])
        or pg_catalog.jsonb_typeof(value -> 'tmdb_id') <> 'number'
        or (value ->> 'tmdb_id') !~ '^[1-9][0-9]{0,9}$'
        or pg_catalog.jsonb_typeof(value -> 'name') <> 'string'
        or pg_catalog.char_length(pg_catalog.btrim(value ->> 'name')) not between 1 and 200
        or pg_catalog.jsonb_typeof(value -> 'character') not in ('string', 'null')
        or (
          pg_catalog.jsonb_typeof(value -> 'character') = 'string'
          and pg_catalog.char_length(value ->> 'character') > 300
        )
        or pg_catalog.jsonb_typeof(value -> 'order') <> 'number'
        or (value ->> 'order') !~ '^(0|[1-9][0-9]{0,4})$'
    ) then
    raise exception 'Principal cast must contain at most 12 bounded cast objects'
      using errcode = '22023';
  end if;

  if p_keywords is null or pg_catalog.jsonb_typeof(p_keywords) <> 'array' then
    raise exception 'Keywords must be a JSON array' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_keywords) > 40
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_keywords) as keyword(value)
      where pg_catalog.jsonb_typeof(value) <> 'object'
        or not (value ?& array['tmdb_id', 'name'])
        or pg_catalog.jsonb_typeof(value -> 'tmdb_id') <> 'number'
        or (value ->> 'tmdb_id') !~ '^[1-9][0-9]{0,9}$'
        or pg_catalog.jsonb_typeof(value -> 'name') <> 'string'
        or pg_catalog.char_length(pg_catalog.btrim(value ->> 'name')) not between 1 and 200
    ) then
    raise exception 'Keywords must contain at most 40 bounded keyword objects'
      using errcode = '22023';
  end if;

  insert into public.movies (
    tmdb_id,
    title,
    original_title,
    overview,
    release_date,
    runtime_minutes,
    poster_path,
    backdrop_path,
    genres,
    original_language,
    production_countries,
    director,
    principal_cast,
    keywords,
    metadata_refreshed_at
  )
  values (
    p_tmdb_id,
    pg_catalog.btrim(p_title),
    pg_catalog.btrim(p_original_title),
    coalesce(p_overview, ''),
    p_release_date,
    p_runtime_minutes,
    p_poster_path,
    p_backdrop_path,
    p_genres,
    v_original_language,
    p_production_countries,
    p_director,
    p_principal_cast,
    p_keywords,
    pg_catalog.now()
  )
  on conflict (tmdb_id) do nothing
  returning * into v_movie;

  if not found then
    update public.movies as cached
    set overview = case
        when cached.overview = '' and coalesce(p_overview, '') <> ''
          then p_overview
        else cached.overview
      end,
      release_date = coalesce(cached.release_date, p_release_date),
      runtime_minutes = coalesce(cached.runtime_minutes, p_runtime_minutes),
      poster_path = coalesce(cached.poster_path, p_poster_path),
      backdrop_path = coalesce(cached.backdrop_path, p_backdrop_path),
      genres = case
        when cached.genres = '[]'::jsonb and pg_catalog.jsonb_array_length(p_genres) > 0
          then p_genres
        else cached.genres
      end,
      original_language = case
        when (
          cached.original_language is null
          or cached.original_language = ''
        ) and v_original_language is not null
          then v_original_language
        else cached.original_language
      end,
      production_countries = case
        when cached.production_countries = '[]'::jsonb
          and pg_catalog.jsonb_array_length(p_production_countries) > 0
          then p_production_countries
        else cached.production_countries
      end,
      director = case
        when (
          cached.director is null
          or cached.director = '[]'::jsonb
        ) and pg_catalog.jsonb_array_length(p_director) > 0
          then p_director
        else cached.director
      end,
      principal_cast = case
        when cached.principal_cast = '[]'::jsonb
          and pg_catalog.jsonb_array_length(p_principal_cast) > 0
          then p_principal_cast
        else cached.principal_cast
      end,
      keywords = case
        when cached.keywords = '[]'::jsonb
          and pg_catalog.jsonb_array_length(p_keywords) > 0
          then p_keywords
        else cached.keywords
      end,
      metadata_refreshed_at = pg_catalog.now()
    where cached.tmdb_id = p_tmdb_id
      and (
        (cached.overview = '' and coalesce(p_overview, '') <> '')
        or (cached.release_date is null and p_release_date is not null)
        or (cached.runtime_minutes is null and p_runtime_minutes is not null)
        or (cached.poster_path is null and p_poster_path is not null)
        or (cached.backdrop_path is null and p_backdrop_path is not null)
        or (
          cached.genres = '[]'::jsonb
          and pg_catalog.jsonb_array_length(p_genres) > 0
        )
        or (
          (cached.original_language is null or cached.original_language = '')
          and v_original_language is not null
        )
        or (
          cached.production_countries = '[]'::jsonb
          and pg_catalog.jsonb_array_length(p_production_countries) > 0
        )
        or (
          (cached.director is null or cached.director = '[]'::jsonb)
          and pg_catalog.jsonb_array_length(p_director) > 0
        )
        or (
          cached.principal_cast = '[]'::jsonb
          and pg_catalog.jsonb_array_length(p_principal_cast) > 0
        )
        or (
          cached.keywords = '[]'::jsonb
          and pg_catalog.jsonb_array_length(p_keywords) > 0
        )
      )
    returning * into v_movie;

    if not found then
      select * into v_movie
      from public.movies
      where tmdb_id = p_tmdb_id;
      if not found then
        raise exception 'Movie cache changed concurrently; retry the request'
          using errcode = '40001';
      end if;
    end if;
  end if;

  return v_movie;
end;
$$;

-- Atomically consume one authenticated user's global TMDB cache-miss budget.
-- Policy is intentionally parameterless and fixed at 20 attempts per one-minute
-- window so callers cannot choose their own identity, limit, or reset time.
create function public.consume_tmdb_cache_budget()
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_budget private.tmdb_cache_budgets%rowtype;
  v_now timestamptz;
begin
  if v_user_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Hold the profile key while consuming so account deletion cannot race the
  -- profile-owned operational row or leave an orphan budget behind.
  perform 1
  from public.profiles
  where id = v_user_id
  for key share;
  if not found then
    raise exception 'Complete profile setup before requesting TMDB metadata'
      using errcode = '42501';
  end if;

  loop
    select * into v_budget
    from private.tmdb_cache_budgets
    where user_id = v_user_id
    for update;

    if found then
      v_now := pg_catalog.clock_timestamp();

      if v_budget.window_started_at <= v_now - interval '1 minute' then
        update private.tmdb_cache_budgets
        set window_started_at = v_now,
          request_count = 1
        where user_id = v_user_id;
        return true;
      end if;

      if v_budget.request_count >= 20 then
        return false;
      end if;

      update private.tmdb_cache_budgets
      set request_count = request_count + 1
      where user_id = v_user_id;
      return true;
    end if;

    v_now := pg_catalog.clock_timestamp();
    insert into private.tmdb_cache_budgets (
      user_id,
      window_started_at,
      request_count
    )
    values (v_user_id, v_now, 1)
    on conflict (user_id) do nothing;

    if found then
      return true;
    end if;
    -- Another transaction created the row first. Loop, lock it, and consume
    -- against the same globally coherent window.
  end loop;
end;
$$;

-- Session answers are an append/undo stack while active. This trigger enforces
-- a maximum of five decisive answers plus two skips, and prevents editing any
-- answer after a session has left the active state.
create function public.validate_ranking_session_answer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session public.ranking_sessions%rowtype;
  v_session_id uuid;
  v_latest integer;
  v_decisive integer;
  v_skips integer;
begin
  v_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;

  select *
  into v_session
  from public.ranking_sessions
  where id = v_session_id
  for update;

  if not found then
    raise exception 'Ranking session % does not exist', v_session_id
      using errcode = '23503';
  end if;

  if v_session.status <> 'active'::public.ranking_session_status then
    raise exception 'Answers may only change while ranking session % is active', v_session_id
      using errcode = '55000';
  end if;

  select coalesce(pg_catalog.max(sequence_number), 0)
  into v_latest
  from public.ranking_session_answers
  where session_id = v_session_id;

  if tg_op = 'INSERT' then
    if new.sequence_number <> v_latest + 1 then
      raise exception 'Answer sequence must append at %, received %', v_latest + 1, new.sequence_number
        using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.session_id <> old.session_id
      or new.sequence_number <> old.sequence_number
      or new.opponent_tmdb_id <> old.opponent_tmdb_id then
      raise exception 'Session, sequence, and opponent are immutable on an answer'
        using errcode = '55000';
    end if;
    if old.sequence_number <> v_latest then
      raise exception 'Only the most recent answer may be edited'
        using errcode = '55000';
    end if;
  elsif old.sequence_number <> v_latest then
    raise exception 'Undo must remove the most recent answer first'
      using errcode = '55000';
  end if;

  if tg_op <> 'DELETE' then
    if new.opponent_tmdb_id = v_session.subject_tmdb_id then
      raise exception 'A film cannot be compared with itself'
        using errcode = '23514';
    end if;
    if new.winner_tmdb_id is not null
      and new.winner_tmdb_id not in (v_session.subject_tmdb_id, new.opponent_tmdb_id) then
      raise exception 'Winner must be the subject or opponent'
        using errcode = '23514';
    end if;
  end if;

  select
    pg_catalog.count(*) filter (where winner_tmdb_id is not null),
    pg_catalog.count(*) filter (where winner_tmdb_id is null)
  into v_decisive, v_skips
  from public.ranking_session_answers
  where session_id = v_session_id
    and (tg_op <> 'UPDATE' or id <> old.id);

  if tg_op in ('INSERT', 'UPDATE') then
    v_decisive := v_decisive + case when new.winner_tmdb_id is null then 0 else 1 end;
    v_skips := v_skips + case when new.winner_tmdb_id is null then 1 else 0 end;
  end if;

  if v_decisive > 5 then
    raise exception 'A ranking session may contain at most five decisive answers'
      using errcode = '23514';
  end if;
  if v_skips > 2 then
    raise exception 'A ranking session may contain at most two skips'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger ranking_session_answers_validate
before insert or update or delete on public.ranking_session_answers
for each row execute function public.validate_ranking_session_answer();

create function public.sync_ranking_session_answer_counts()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
begin
  v_session_id := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  update public.ranking_sessions
  set skip_count = (
      select pg_catalog.count(*)
      from public.ranking_session_answers
      where session_id = v_session_id
        and winner_tmdb_id is null
    ),
    last_activity_at = pg_catalog.now()
  where id = v_session_id;
  return null;
end;
$$;

create trigger ranking_session_answers_sync_parent
after insert or update or delete on public.ranking_session_answers
for each row execute function public.sync_ranking_session_answer_counts();

-- Only a committed session answer can become a permanent comparison event.
create function public.validate_comparison_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session public.ranking_sessions%rowtype;
  v_answer public.ranking_session_answers%rowtype;
begin
  select * into v_session
  from public.ranking_sessions
  where id = new.session_id;

  if not found or v_session.status <> 'committed'::public.ranking_session_status then
    raise exception 'Comparisons may only be created from a committed ranking session'
      using errcode = '55000';
  end if;

  select * into v_answer
  from public.ranking_session_answers
  where session_id = new.session_id
    and sequence_number = new.sequence_number;

  if not found
    or new.user_id <> v_session.user_id
    or new.subject_tmdb_id <> v_session.subject_tmdb_id
    or new.opponent_tmdb_id <> v_answer.opponent_tmdb_id
    or new.winner_tmdb_id is distinct from v_answer.winner_tmdb_id then
    raise exception 'Comparison must exactly match its committed session answer'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger comparisons_validate_insert
before insert on public.comparisons
for each row execute function public.validate_comparison_insert();

create function public.protect_append_only_user_record()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  -- During a real profile/account FK cascade the parent profile is already
  -- absent. Requiring both that fact and nested-trigger context prevents a
  -- direct or unrelated nested statement from erasing append-only history.
  if tg_op = 'DELETE'
    and pg_catalog.pg_trigger_depth() > 1
    and not exists (
      select 1 from public.profiles where id = old.user_id
    ) then
    return old;
  end if;

  raise exception '% rows are append-only', tg_table_name
    using errcode = '55000';
end;
$$;

create trigger comparisons_are_immutable
before update or delete on public.comparisons
for each row execute function public.protect_append_only_user_record();

create trigger rank_history_is_immutable
before update or delete on public.rank_history
for each row execute function public.protect_append_only_user_record();

create function public.prevent_deleting_active_ranked_film()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if pg_catalog.pg_trigger_depth() > 1
    and not exists (
      select 1 from public.profiles where id = old.user_id
    ) then
    return old;
  end if;

  -- Join the same per-user mutex used by every canon RPC. A direct DELETE may
  -- deadlock-and-retry against an in-flight RPC, but it cannot invalidate its
  -- persisted comparator bounds.
  perform 1 from public.profiles where id = old.user_id for update;

  if exists (
    select 1
    from public.ranking_sessions
    where user_id = old.user_id
      and status in (
        'active'::public.ranking_session_status,
        'abandoned'::public.ranking_session_status
      )
  ) then
    raise exception 'Resolve the ranking session before removing any canon film'
      using errcode = '55000';
  end if;
  return old;
end;
$$;

create trigger ranked_films_no_delete_during_session
before delete on public.ranked_films
for each row execute function public.prevent_deleting_active_ranked_film();

-- Start/move the provisional ranked row and open the one unresolved session in
-- one transaction. PostgreSQL derives full-bucket bounds and a collision-free
-- midpoint; the client never supplies an arbitrary canon position.
create function public.begin_ranking_session(
  p_subject_tmdb_id bigint,
  p_watch_entry_id uuid,
  p_reason public.ranking_reason,
  p_target_verdict public.verdict
)
returns public.ranking_sessions
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.ranked_films%rowtype;
  v_session public.ranking_sessions%rowtype;
  v_rank_before integer;
  v_watch public.watch_entries%rowtype;
  v_bucket_count bigint;
  v_lower_bound numeric;
  v_upper_bound numeric;
  v_provisional_position numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- The profile row is the per-user canon mutex. Unlike locking ranked rows it
  -- also serializes an empty canon and all ranking RPCs use the same lock order.
  perform 1 from public.profiles where id = v_user_id for update;

  -- Serialize all canon changes for this user. The unresolved-session unique
  -- index remains the final race-proof guard.
  perform 1
  from public.ranked_films
  where user_id = v_user_id
  for update;

  if exists (
    select 1
    from public.ranking_sessions
    where user_id = v_user_id
      and status in (
        'active'::public.ranking_session_status,
        'abandoned'::public.ranking_session_status
      )
  ) then
    raise exception 'Resolve the existing ranking session before starting another'
      using errcode = '23505';
  end if;

  if p_reason = 'manual_rerank'::public.ranking_reason then
    if p_watch_entry_id is not null then
      raise exception 'Manual re-rank sessions must not create or attach a watch entry'
        using errcode = '22023';
    end if;
  else
    if p_watch_entry_id is null then
      raise exception 'Initial and rewatch ranking sessions require a watch entry'
        using errcode = '22023';
    end if;

    select * into v_watch
    from public.watch_entries
    where id = p_watch_entry_id
    for update;

    if not found
      or v_watch.user_id <> v_user_id
      or v_watch.tmdb_id <> p_subject_tmdb_id
      or v_watch.completion_status <> 'completed'::public.watch_completion_status then
      raise exception 'Watch entry must be a completed entry owned by the current user for this movie'
        using errcode = '23514';
    end if;
  end if;

  select * into v_existing
  from public.ranked_films
  where user_id = v_user_id
    and tmdb_id = p_subject_tmdb_id
  for update;

  if p_reason = 'initial_log'::public.ranking_reason and found then
    raise exception 'This film already has a canon placement; use rewatch or manual re-rank'
      using errcode = '23505';
  elsif p_reason <> 'initial_log'::public.ranking_reason and not found then
    raise exception 'Re-ranking requires an existing canon placement'
      using errcode = '23514';
  end if;

  -- Own the initial interval in the database. Bounds contain the full target
  -- bucket (excluding the subject during a re-rank), and the provisional row is
  -- placed at a deterministic collision-free midpoint.
  select
    pg_catalog.count(*),
    pg_catalog.min(candidate.sort_position),
    pg_catalog.max(candidate.sort_position)
  into v_bucket_count, v_lower_bound, v_upper_bound
  from public.ranked_films as candidate
  where candidate.user_id = v_user_id
    and candidate.tmdb_id <> p_subject_tmdb_id
    and candidate.verdict = p_target_verdict;

  if v_bucket_count = 0 then
    v_lower_bound := 1024;
    v_upper_bound := 1024;
    v_provisional_position := 1024;
  else
    v_lower_bound := v_lower_bound / 2;
    v_upper_bound := v_upper_bound + 1024;
    v_provisional_position := public.fractional_midpoint(v_lower_bound, v_upper_bound);

    while exists (
      select 1
      from public.ranked_films
      where user_id = v_user_id
        and tmdb_id <> p_subject_tmdb_id
        and verdict = p_target_verdict
        and sort_position = v_provisional_position
    ) loop
      v_upper_bound := v_upper_bound + 1024;
      v_provisional_position := public.fractional_midpoint(v_lower_bound, v_upper_bound);
    end loop;
  end if;

  if p_reason <> 'initial_log'::public.ranking_reason then
    select (1 + pg_catalog.count(*))::integer
    into v_rank_before
    from public.ranked_films as candidate
    where candidate.user_id = v_user_id
      and (
        public.verdict_priority(candidate.verdict) < public.verdict_priority(v_existing.verdict)
        or (
          candidate.verdict = v_existing.verdict
          and candidate.sort_position < v_existing.sort_position
        )
      );
  end if;

  insert into public.ranking_sessions (
    user_id,
    subject_tmdb_id,
    watch_entry_id,
    reason,
    target_verdict,
    original_verdict,
    original_sort_position,
    original_rank_snapshot,
    lower_bound_position,
    upper_bound_position,
    current_provisional_position
  )
  values (
    v_user_id,
    p_subject_tmdb_id,
    p_watch_entry_id,
    p_reason,
    p_target_verdict,
    case when p_reason = 'initial_log'::public.ranking_reason then null else v_existing.verdict end,
    case when p_reason = 'initial_log'::public.ranking_reason then null else v_existing.sort_position end,
    case when p_reason = 'initial_log'::public.ranking_reason then null else v_rank_before end,
    v_lower_bound,
    v_upper_bound,
    v_provisional_position
  )
  returning * into v_session;

  if p_reason = 'initial_log'::public.ranking_reason then
    insert into public.ranked_films (
      user_id,
      tmdb_id,
      verdict,
      sort_position,
      placement_confidence,
      active_ranking_session_id
    )
    values (
      v_user_id,
      p_subject_tmdb_id,
      p_target_verdict,
      v_provisional_position,
      'provisional'::public.placement_confidence,
      v_session.id
    );
  else
    update public.ranked_films
    set verdict = p_target_verdict,
      sort_position = v_provisional_position,
      placement_confidence = 'provisional'::public.placement_confidence,
      comparison_count = 0,
      active_ranking_session_id = v_session.id
    where id = v_existing.id;
  end if;

  if p_watch_entry_id is not null then
    update public.watch_entries
    set ranking_status = 'in_progress'::public.watch_ranking_status
    where id = p_watch_entry_id;
  end if;

  return v_session;
end;
$$;

-- Persist one answer, the narrowed interval, and the subject's provisional
-- placement atomically. A null winner means "too close to call".
create function public.record_ranking_answer(
  p_session_id uuid,
  p_opponent_tmdb_id bigint,
  p_winner_tmdb_id bigint
)
returns public.ranking_session_answers
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.ranking_sessions%rowtype;
  v_answer public.ranking_session_answers%rowtype;
  v_next_sequence smallint;
  v_opponent_position numeric;
  v_expected_lower numeric;
  v_expected_upper numeric;
  v_expected_position numeric;
  v_candidate_position numeric;
  v_collision_offset integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_session
  from public.ranking_sessions
  where id = p_session_id
  for update;

  if not found or v_session.user_id <> v_user_id then
    raise exception 'Ranking session not found' using errcode = '42501';
  end if;
  if v_session.status <> 'active'::public.ranking_session_status then
    raise exception 'Ranking session is not active' using errcode = '55000';
  end if;

  select sort_position into v_opponent_position
  from public.ranked_films
    where user_id = v_user_id
      and tmdb_id = p_opponent_tmdb_id
      and tmdb_id <> v_session.subject_tmdb_id
      and verdict = v_session.target_verdict;

  if not found then
    raise exception 'Opponent must be another film in the target verdict bucket'
      using errcode = '23514';
  end if;

  if p_winner_tmdb_id is not null
    and p_winner_tmdb_id not in (v_session.subject_tmdb_id, p_opponent_tmdb_id) then
    raise exception 'Winner must be the subject or opponent' using errcode = '23514';
  end if;

  if (v_session.lower_bound_position is not null
      and v_opponent_position < v_session.lower_bound_position)
    or (v_session.upper_bound_position is not null
      and v_opponent_position > v_session.upper_bound_position) then
    raise exception 'Opponent must be inside the unresolved ranking interval'
      using errcode = '23514';
  end if;

  if p_winner_tmdb_id is null then
    -- A skip provides no ordering information.
    v_expected_lower := v_session.lower_bound_position;
    v_expected_upper := v_session.upper_bound_position;
    v_expected_position := v_session.current_provisional_position;
  else
    if p_winner_tmdb_id = v_session.subject_tmdb_id then
      v_expected_lower := v_session.lower_bound_position;
      v_expected_upper := v_opponent_position;
    else
      v_expected_lower := v_opponent_position;
      v_expected_upper := v_session.upper_bound_position;
    end if;

    if v_expected_lower is not distinct from v_session.lower_bound_position
      and v_expected_upper is not distinct from v_session.upper_bound_position then
      raise exception 'Decisive comparator must narrow the unresolved interval'
        using errcode = '23514';
    end if;

    v_expected_position := public.fractional_midpoint(v_expected_lower, v_expected_upper);
  end if;

  -- A numeric midpoint can coincide with an unasked interior film. Preserve
  -- total order by choosing the nearest representable free value around it.
  if exists (
    select 1
    from public.ranked_films
    where user_id = v_user_id
      and tmdb_id <> v_session.subject_tmdb_id
      and verdict = v_session.target_verdict
      and sort_position = v_expected_position
  ) then
    v_collision_offset := 0;
    loop
      v_collision_offset := v_collision_offset + 1;
      if v_collision_offset > 10000 then
        raise exception 'No free fractional position remains; keep this placement, rebalance, then re-rank'
          using errcode = '54000';
      end if;

      v_candidate_position := v_expected_position
        + v_collision_offset * 0.000000000000001::numeric;
      if (v_expected_upper is null or v_candidate_position < v_expected_upper)
        and not exists (
          select 1
          from public.ranked_films
          where user_id = v_user_id
            and tmdb_id <> v_session.subject_tmdb_id
            and verdict = v_session.target_verdict
            and sort_position = v_candidate_position
        ) then
        v_expected_position := v_candidate_position;
        exit;
      end if;

      v_candidate_position := v_expected_position
        - v_collision_offset * 0.000000000000001::numeric;
      if (v_expected_lower is null or v_candidate_position > v_expected_lower)
        and v_candidate_position > 0
        and not exists (
          select 1
          from public.ranked_films
          where user_id = v_user_id
            and tmdb_id <> v_session.subject_tmdb_id
            and verdict = v_session.target_verdict
            and sort_position = v_candidate_position
        ) then
        v_expected_position := v_candidate_position;
        exit;
      end if;
    end loop;
  end if;

  select (coalesce(pg_catalog.max(sequence_number), 0) + 1)::smallint
  into v_next_sequence
  from public.ranking_session_answers
  where session_id = p_session_id;

  insert into public.ranking_session_answers (
    session_id,
    opponent_tmdb_id,
    winner_tmdb_id,
    sequence_number,
    bounds_before
  )
  values (
    p_session_id,
    p_opponent_tmdb_id,
    p_winner_tmdb_id,
    v_next_sequence,
    pg_catalog.jsonb_build_object(
      'lower_bound_position', v_session.lower_bound_position,
      'upper_bound_position', v_session.upper_bound_position,
      'current_provisional_position', v_session.current_provisional_position
    )
  )
  returning * into v_answer;

  update public.ranking_sessions
  set lower_bound_position = v_expected_lower,
    upper_bound_position = v_expected_upper,
    current_provisional_position = v_expected_position,
    last_activity_at = pg_catalog.now()
  where id = p_session_id;

  update public.ranked_films
  set sort_position = v_expected_position,
    placement_confidence = 'provisional'::public.placement_confidence
  where user_id = v_user_id
    and tmdb_id = v_session.subject_tmdb_id
    and active_ranking_session_id = p_session_id;

  if not found then
    raise exception 'Session has no matching provisional canon placement'
      using errcode = '55000';
  end if;

  return v_answer;
end;
$$;

create function public.undo_last_ranking_answer(p_session_id uuid)
returns public.ranking_session_answers
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.ranking_sessions%rowtype;
  v_answer public.ranking_session_answers%rowtype;
  v_lower numeric;
  v_upper numeric;
  v_position numeric;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_session
  from public.ranking_sessions
  where id = p_session_id
  for update;

  if not found or v_session.user_id <> v_user_id then
    raise exception 'Ranking session not found' using errcode = '42501';
  end if;
  if v_session.status <> 'active'::public.ranking_session_status then
    raise exception 'Ranking session is not active' using errcode = '55000';
  end if;

  select * into v_answer
  from public.ranking_session_answers
  where session_id = p_session_id
  order by sequence_number desc
  limit 1
  for update;

  if not found then
    return null;
  end if;

  v_lower := (v_answer.bounds_before ->> 'lower_bound_position')::numeric;
  v_upper := (v_answer.bounds_before ->> 'upper_bound_position')::numeric;
  v_position := (v_answer.bounds_before ->> 'current_provisional_position')::numeric;

  delete from public.ranking_session_answers where id = v_answer.id;

  update public.ranking_sessions
  set lower_bound_position = v_lower,
    upper_bound_position = v_upper,
    current_provisional_position = v_position,
    last_activity_at = pg_catalog.now()
  where id = p_session_id;

  update public.ranked_films
  set sort_position = v_position,
    placement_confidence = 'provisional'::public.placement_confidence
  where user_id = v_user_id
    and tmdb_id = v_session.subject_tmdb_id
    and active_ranking_session_id = p_session_id;

  return v_answer;
end;
$$;

-- Commit is the sole write path for comparisons and rank history. Everything
-- below succeeds or rolls back together.
create function public.commit_ranking_session(
  p_session_id uuid,
  p_final_confidence public.placement_confidence default 'provisional'::public.placement_confidence
)
returns public.ranked_films
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.ranking_sessions%rowtype;
  v_ranked public.ranked_films%rowtype;
  v_decisive integer;
  v_skips integer;
  v_rank_after integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_session
  from public.ranking_sessions
  where id = p_session_id
  for update;

  if not found or v_session.user_id <> v_user_id then
    raise exception 'Ranking session not found' using errcode = '42501';
  end if;
  if v_session.status not in (
    'active'::public.ranking_session_status,
    'abandoned'::public.ranking_session_status
  ) then
    raise exception 'Ranking session has already been committed' using errcode = '55000';
  end if;

  perform 1
  from public.ranked_films
  where user_id = v_user_id
  for update;

  select * into v_ranked
  from public.ranked_films
  where user_id = v_user_id
    and tmdb_id = v_session.subject_tmdb_id
  for update;

  if not found or v_ranked.active_ranking_session_id is distinct from p_session_id then
    raise exception 'Session has no matching provisional canon placement'
      using errcode = '55000';
  end if;

  select
    pg_catalog.count(*) filter (where winner_tmdb_id is not null),
    pg_catalog.count(*) filter (where winner_tmdb_id is null)
  into v_decisive, v_skips
  from public.ranking_session_answers
  where session_id = p_session_id;

  if v_decisive > 5 or v_skips > 2 or v_skips <> v_session.skip_count then
    raise exception 'Session answer counts are inconsistent' using errcode = '23514';
  end if;

  update public.ranking_sessions
  set status = 'committed'::public.ranking_session_status,
    committed_at = pg_catalog.now(),
    last_activity_at = pg_catalog.now()
  where id = p_session_id;

  insert into public.comparisons (
    user_id,
    subject_tmdb_id,
    opponent_tmdb_id,
    winner_tmdb_id,
    session_id,
    sequence_number
  )
  select
    v_user_id,
    v_session.subject_tmdb_id,
    answer.opponent_tmdb_id,
    answer.winner_tmdb_id,
    p_session_id,
    answer.sequence_number
  from public.ranking_session_answers as answer
  where answer.session_id = p_session_id
  order by answer.sequence_number;

  update public.ranked_films
  set verdict = v_session.target_verdict,
    sort_position = v_session.current_provisional_position,
    placement_confidence = p_final_confidence,
    comparison_count = v_decisive,
    active_ranking_session_id = null,
    last_ranked_at = pg_catalog.now()
  where id = v_ranked.id
  returning * into v_ranked;

  select (1 + pg_catalog.count(*))::integer
  into v_rank_after
  from public.ranked_films as candidate
  where candidate.user_id = v_user_id
    and (
      public.verdict_priority(candidate.verdict) < public.verdict_priority(v_ranked.verdict)
      or (
        candidate.verdict = v_ranked.verdict
        and candidate.sort_position < v_ranked.sort_position
      )
    );

  insert into public.rank_history (
    user_id,
    tmdb_id,
    session_id,
    rank_before,
    rank_after,
    verdict_before,
    verdict_after,
    reason
  )
  values (
    v_user_id,
    v_session.subject_tmdb_id,
    p_session_id,
    v_session.original_rank_snapshot,
    v_rank_after,
    v_session.original_verdict,
    v_session.target_verdict,
    v_session.reason
  );

  -- A user may have logged the same movie again before finishing its first
  -- verdict. Once the one canon placement commits, no completed entry for that
  -- movie should remain stuck in pending/in-progress.
  update public.watch_entries
  set ranking_status = 'complete'::public.watch_ranking_status
  where user_id = v_user_id
    and tmdb_id = v_session.subject_tmdb_id
    and completion_status = 'completed'::public.watch_completion_status
    and ranking_status in (
      'pending'::public.watch_ranking_status,
      'in_progress'::public.watch_ranking_status
    );

  if v_session.reason <> 'manual_rerank'::public.ranking_reason then
    -- Defensive cleanup for watch-backed sessions. A manual re-rank must not
    -- alter an independently re-added Watchlist item.
    delete from public.watchlist_items
    where user_id = v_user_id
      and tmdb_id = v_session.subject_tmdb_id;
  end if;

  return v_ranked;
end;
$$;

-- Re-space one verdict bucket without changing its order. This is useful before
-- choosing a midpoint when adjacent numeric positions become too close.
create function public.rebalance_canon_bucket(p_verdict public.verdict)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;

  if exists (
    select 1
    from public.ranking_sessions
    where user_id = v_user_id
      and status in (
        'active'::public.ranking_session_status,
        'abandoned'::public.ranking_session_status
      )
  ) then
    raise exception 'Resolve the current ranking session before rebalancing its bucket'
      using errcode = '55000';
  end if;

  set constraints public.ranked_films_unique_position deferred;

  perform 1
  from public.ranked_films
  where user_id = v_user_id
    and verdict = p_verdict
  for update;

  with ordered as (
    select id,
      pg_catalog.row_number() over (order by sort_position, id) as ordinal
    from public.ranked_films
    where user_id = v_user_id
      and verdict = p_verdict
  )
  update public.ranked_films as target
  set sort_position = ordered.ordinal * 1024
  from ordered
  where target.id = ordered.id;
end;
$$;

create function public.pause_ranking_session(p_session_id uuid)
returns public.ranking_sessions
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.ranking_sessions%rowtype;
begin
  update public.ranking_sessions
  set status = 'abandoned'::public.ranking_session_status,
    last_activity_at = pg_catalog.now()
  where id = p_session_id
    and user_id = auth.uid()
    and status = 'active'::public.ranking_session_status
  returning * into v_row;
  if not found then
    raise exception 'Active ranking session not found' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

create function public.resume_ranking_session(p_session_id uuid)
returns public.ranking_sessions
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_row public.ranking_sessions%rowtype;
begin
  update public.ranking_sessions
  set status = 'active'::public.ranking_session_status,
    last_activity_at = pg_catalog.now()
  where id = p_session_id
    and user_id = auth.uid()
    and status = 'abandoned'::public.ranking_session_status
  returning * into v_row;
  if not found then
    raise exception 'Abandoned ranking session not found' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- Intended for a trusted scheduled server call. Client sessions cannot abandon
-- another user's stale work, and pg_cron is not assumed to be installed.
create function public.abandon_stale_ranking_sessions()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_affected bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.ranking_sessions
  set status = 'abandoned'::public.ranking_session_status
  where status = 'active'::public.ranking_session_status
    and last_activity_at < pg_catalog.now() - interval '24 hours';

  get diagnostics v_affected = row_count;
  return v_affected;
end;
$$;

create view public.canon
with (security_invoker = true)
as
with positioned as (
  select
    ranked.id,
    ranked.user_id,
    ranked.tmdb_id,
    ranked.verdict,
    ranked.sort_position,
    ranked.placement_confidence,
    ranked.comparison_count,
    ranked.active_ranking_session_id,
    ranked.first_ranked_at,
    ranked.last_ranked_at,
    pg_catalog.row_number() over (
      partition by ranked.user_id
      order by public.verdict_priority(ranked.verdict), ranked.sort_position, ranked.id
    ) as canon_rank,
    pg_catalog.row_number() over (
      partition by ranked.user_id, ranked.verdict
      order by ranked.sort_position, ranked.id
    ) as bucket_rank,
    pg_catalog.count(*) over (
      partition by ranked.user_id, ranked.verdict
    ) as bucket_size,
    pg_catalog.count(*) over (
      partition by ranked.user_id
    ) as total_ranked
  from public.ranked_films as ranked
)
select
  positioned.*,
  public.derived_score(
    positioned.verdict,
    positioned.bucket_rank,
    positioned.bucket_size,
    positioned.total_ranked
  ) as derived_score
from positioned;

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.movies enable row level security;
alter table public.movies force row level security;
alter table public.movie_palettes enable row level security;
alter table public.movie_palettes force row level security;
alter table public.watch_entries enable row level security;
alter table public.watch_entries force row level security;
alter table public.watchlist_items enable row level security;
alter table public.watchlist_items force row level security;
alter table public.ranking_sessions enable row level security;
alter table public.ranking_sessions force row level security;
alter table public.ranked_films enable row level security;
alter table public.ranked_films force row level security;
alter table public.ranking_session_answers enable row level security;
alter table public.ranking_session_answers force row level security;
alter table public.comparisons enable row level security;
alter table public.comparisons force row level security;
alter table public.rank_history enable row level security;
alter table public.rank_history force row level security;

create policy profiles_select_owner
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy profiles_insert_owner
on public.profiles
for insert
to authenticated
with check (id = (select auth.uid()));

create policy profiles_update_owner
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy profiles_delete_owner
on public.profiles
for delete
to authenticated
using (id = (select auth.uid()));

create policy movies_read_globally
on public.movies
for select
to anon, authenticated
using (true);

create policy movie_palettes_read_globally
on public.movie_palettes
for select
to anon, authenticated
using (true);

-- Base watch rows stay owner-only because row-level policies cannot hide a
-- private note column while exposing the rest of the diary entry. Public reads
-- go through public_diary_entries below, which redacts notes.
create policy watch_entries_owner_all
on public.watch_entries
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy watchlist_items_owner_all
on public.watchlist_items
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy ranking_sessions_owner_select
on public.ranking_sessions
for select
to authenticated
using (user_id = (select auth.uid()));

create policy ranking_sessions_owner_insert
on public.ranking_sessions
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy ranking_sessions_owner_update
on public.ranking_sessions
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy ranked_films_select_owner
on public.ranked_films
for select
to authenticated
using (user_id = (select auth.uid()));

create policy ranked_films_insert_owner
on public.ranked_films
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy ranked_films_update_owner
on public.ranked_films
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy ranked_films_delete_owner
on public.ranked_films
for delete
to authenticated
using (user_id = (select auth.uid()));

create policy ranking_session_answers_owner_select
on public.ranking_session_answers
for select
to authenticated
using (
  exists (
    select 1
    from public.ranking_sessions as session
    where session.id = session_id
      and session.user_id = (select auth.uid())
  )
);

create policy ranking_session_answers_owner_mutate_active
on public.ranking_session_answers
for all
to authenticated
using (
  exists (
    select 1
    from public.ranking_sessions as session
    where session.id = session_id
      and session.user_id = (select auth.uid())
      and session.status = 'active'::public.ranking_session_status
  )
)
with check (
  exists (
    select 1
    from public.ranking_sessions as session
    where session.id = session_id
      and session.user_id = (select auth.uid())
      and session.status = 'active'::public.ranking_session_status
  )
);

create policy comparisons_owner_select
on public.comparisons
for select
to authenticated
using (user_id = (select auth.uid()));

create policy rank_history_select_owner
on public.rank_history
for select
to authenticated
using (user_id = (select auth.uid()));

-- Base profile rows include private settings such as timezone and therefore
-- remain owner-only. Public profile pages use this narrow projection.
create view public.public_profiles
with (security_barrier = true)
as
select
  id,
  username,
  display_name,
  avatar_url,
  bio,
  created_at,
  updated_at
from public.profiles
where is_public;

-- Intentionally security-definer: the base table is owner-only. The projection
-- returns rows only for public profiles and nulls private notes. Keep this view
-- owned by the migration owner (normally postgres on Supabase).
create view public.public_diary_entries
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
    when entry.visibility in (
      'inherit'::public.note_visibility,
      'public'::public.note_visibility
    ) then entry.note
    else null
  end as note,
  (
    entry.note is not null
    and entry.visibility in (
      'inherit'::public.note_visibility,
      'public'::public.note_visibility
    )
  ) as note_is_public,
  entry.is_rewatch,
  entry.created_at,
  entry.updated_at
from public.watch_entries as entry
join public.profiles as profile on profile.id = entry.user_id
where profile.is_public;

-- Public canon projection deliberately omits active_ranking_session_id.
create view public.public_canon
with (security_barrier = true)
as
with positioned as (
  select
    ranked.id,
    ranked.user_id,
    ranked.tmdb_id,
    ranked.verdict,
    ranked.sort_position,
    ranked.placement_confidence,
    ranked.comparison_count,
    ranked.first_ranked_at,
    ranked.last_ranked_at,
    pg_catalog.row_number() over (
      partition by ranked.user_id
      order by public.verdict_priority(ranked.verdict), ranked.sort_position, ranked.id
    ) as canon_rank,
    pg_catalog.row_number() over (
      partition by ranked.user_id, ranked.verdict
      order by ranked.sort_position, ranked.id
    ) as bucket_rank,
    pg_catalog.count(*) over (
      partition by ranked.user_id, ranked.verdict
    ) as bucket_size,
    pg_catalog.count(*) over (
      partition by ranked.user_id
    ) as total_ranked
  from public.ranked_films as ranked
  join public.profiles as profile on profile.id = ranked.user_id
  where profile.is_public
)
select
  positioned.*,
  public.derived_score(
    positioned.verdict,
    positioned.bucket_rank,
    positioned.bucket_size,
    positioned.total_ranked
  ) as derived_score
from positioned;

create view public.discoverable_profiles
with (security_barrier = true)
as
select
  id,
  username,
  display_name,
  avatar_url,
  bio,
  created_at,
  updated_at
from public.profiles
where is_public
  and is_discoverable;

-- Read the authenticated owner's complete application state in one statement
-- and therefore one PostgreSQL snapshot. SECURITY INVOKER is intentional: the
-- caller must retain SELECT privileges and every base relation still applies
-- its owner RLS policy.
create function public.get_after_credits_state()
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_state jsonb;
begin
  if v_user_id is null or coalesce(auth.role(), '') <> 'authenticated' then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  with
  watch_rows as materialized (
    select entry.*
    from public.watch_entries as entry
    where entry.user_id = v_user_id
  ),
  watchlist_rows as materialized (
    select item.*
    from public.watchlist_items as item
    where item.user_id = v_user_id
  ),
  canon_rows as materialized (
    select canon_row.*
    from public.canon as canon_row
    where canon_row.user_id = v_user_id
  ),
  history_rows as materialized (
    select history.*
    from public.rank_history as history
    where history.user_id = v_user_id
  ),
  comparison_rows as materialized (
    select comparison.*
    from public.comparisons as comparison
    where comparison.user_id = v_user_id
  ),
  selected_session as materialized (
    select session.*
    from public.ranking_sessions as session
    where session.user_id = v_user_id
      and session.status in (
        'active'::public.ranking_session_status,
        'abandoned'::public.ranking_session_status
      )
    order by session.last_activity_at desc, session.created_at desc, session.id desc
    limit 1
  ),
  answer_rows as materialized (
    select answer.*
    from public.ranking_session_answers as answer
    join selected_session as session on session.id = answer.session_id
  ),
  referenced_movie_ids as materialized (
    select entry.tmdb_id from watch_rows as entry
    union
    select item.tmdb_id from watchlist_rows as item
    union
    select canon_row.tmdb_id from canon_rows as canon_row
    union
    select session.subject_tmdb_id from selected_session as session
    union
    select answer.opponent_tmdb_id from answer_rows as answer
    union
    select answer.winner_tmdb_id
    from answer_rows as answer
    where answer.winner_tmdb_id is not null
  ),
  movie_rows as materialized (
    select movie.*
    from public.movies as movie
    join referenced_movie_ids as reference on reference.tmdb_id = movie.tmdb_id
  ),
  palette_rows as materialized (
    select palette.*
    from public.movie_palettes as palette
    join referenced_movie_ids as reference on reference.tmdb_id = palette.tmdb_id
  )
  select pg_catalog.jsonb_build_object(
    'watch_entries', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(entry)
          order by entry.watched_on desc, entry.created_at desc, entry.id
        ),
        '[]'::jsonb
      )
      from watch_rows as entry
    ),
    'watchlist_items', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(item)
          order by item.added_at desc, item.id
        ),
        '[]'::jsonb
      )
      from watchlist_rows as item
    ),
    'canon', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(canon_row)
          order by canon_row.canon_rank, canon_row.id
        ),
        '[]'::jsonb
      )
      from canon_rows as canon_row
    ),
    'rank_history', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(history)
          order by history.created_at desc, history.id
        ),
        '[]'::jsonb
      )
      from history_rows as history
    ),
    'comparisons', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(comparison)
          order by comparison.created_at, comparison.session_id,
            comparison.sequence_number, comparison.id
        ),
        '[]'::jsonb
      )
      from comparison_rows as comparison
    ),
    'ranking_sessions', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(session)
          order by session.last_activity_at desc, session.id
        ),
        '[]'::jsonb
      )
      from selected_session as session
    ),
    'ranking_session_answers', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(answer)
          order by answer.sequence_number, answer.id
        ),
        '[]'::jsonb
      )
      from answer_rows as answer
    ),
    'movies', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(movie)
          order by movie.tmdb_id
        ),
        '[]'::jsonb
      )
      from movie_rows as movie
    ),
    'movie_palettes', (
      select coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(palette)
          order by palette.tmdb_id
        ),
        '[]'::jsonb
      )
      from palette_rows as palette
    )
  ) into v_state;

  return v_state;
end;
$$;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.movies from anon, authenticated;
revoke all on table public.movie_palettes from anon, authenticated;
revoke all on table public.watch_entries from anon, authenticated;
revoke all on table public.watchlist_items from anon, authenticated;
revoke all on table public.ranking_sessions from anon, authenticated;
revoke all on table public.ranked_films from anon, authenticated;
revoke all on table public.ranking_session_answers from anon, authenticated;
revoke all on table public.comparisons from anon, authenticated;
revoke all on table public.rank_history from anon, authenticated;
revoke all on table public.canon from anon, authenticated;
revoke all on table public.public_profiles from anon, authenticated;
revoke all on table public.public_diary_entries from anon, authenticated;
revoke all on table public.public_canon from anon, authenticated;
revoke all on table public.discoverable_profiles from anon, authenticated;

grant usage on schema public, extensions to anon, authenticated, service_role;
grant select, delete on table public.profiles to authenticated;
grant insert (
  id, username, display_name, avatar_url, bio, timezone, is_public, is_discoverable
) on public.profiles to authenticated;
grant update (
  username, display_name, avatar_url, bio, timezone, is_public, is_discoverable
) on public.profiles to authenticated;
grant select on table public.movies, public.movie_palettes to anon, authenticated;
grant select, insert, update, delete on table public.movies, public.movie_palettes to service_role;
grant update (public_access_approved, is_public, is_discoverable)
  on public.profiles to service_role;
grant select, delete on table public.watch_entries to authenticated;
grant insert (
  user_id, tmdb_id, watched_on, completion_status, note, visibility
) on public.watch_entries to authenticated;
grant update (
  watched_on, note, visibility
) on public.watch_entries to authenticated;
grant select, delete on table public.watchlist_items to authenticated;
grant insert (user_id, tmdb_id) on public.watchlist_items to authenticated;
grant select on table public.ranking_sessions to authenticated;
grant select, delete on table public.ranked_films to authenticated;
grant select on table public.ranking_session_answers to authenticated;
grant select on table public.comparisons to authenticated;
grant select on table public.rank_history to authenticated;
grant select on table public.canon to authenticated;
grant select on table public.public_profiles to anon, authenticated;
grant select on table public.public_diary_entries to anon, authenticated;
grant select on table public.public_canon to anon, authenticated;
grant select on table public.discoverable_profiles to anon, authenticated;

revoke execute on function public.begin_ranking_session(
  bigint, uuid, public.ranking_reason, public.verdict
) from public;
revoke execute on function public.record_ranking_answer(
  uuid, bigint, bigint
) from public;
revoke execute on function public.undo_last_ranking_answer(uuid) from public;
revoke execute on function public.commit_ranking_session(
  uuid, public.placement_confidence
) from public;
revoke execute on function public.rebalance_canon_bucket(public.verdict) from public;
revoke execute on function public.pause_ranking_session(uuid) from public;
revoke execute on function public.resume_ranking_session(uuid) from public;
revoke execute on function public.abandon_stale_ranking_sessions() from public;
revoke execute on function public.convert_dnf_to_completed(uuid) from public;
revoke execute on function public.cache_tmdb_movie(
  bigint, text, text, text, date, integer, text, text, jsonb, jsonb,
  text, jsonb, jsonb, jsonb
) from public, authenticated;
revoke execute on function public.consume_tmdb_cache_budget()
  from public, anon, authenticated, service_role;
revoke execute on function public.get_after_credits_state() from public;

grant execute on function public.begin_ranking_session(
  bigint, uuid, public.ranking_reason, public.verdict
) to authenticated;
grant execute on function public.record_ranking_answer(
  uuid, bigint, bigint
) to authenticated;
grant execute on function public.undo_last_ranking_answer(uuid) to authenticated;
grant execute on function public.commit_ranking_session(
  uuid, public.placement_confidence
) to authenticated;
grant execute on function public.rebalance_canon_bucket(public.verdict) to authenticated;
grant execute on function public.pause_ranking_session(uuid) to authenticated;
grant execute on function public.resume_ranking_session(uuid) to authenticated;
grant execute on function public.abandon_stale_ranking_sessions() to service_role;
grant execute on function public.convert_dnf_to_completed(uuid) to authenticated;
grant execute on function public.cache_tmdb_movie(
  bigint, text, text, text, date, integer, text, text, jsonb, jsonb,
  text, jsonb, jsonb, jsonb
) to service_role;
grant execute on function public.consume_tmdb_cache_budget() to authenticated;
grant execute on function public.get_after_credits_state() to authenticated;

-- Trigger/internal security-definer functions are never public RPC endpoints.
revoke execute on function public.set_watch_entry_rewatch_flag() from public;
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.lock_watch_entry_pair() from public;
revoke execute on function public.normalize_new_watch_entry_state() from public;
revoke execute on function public.recompute_rewatch_flags_for_pair(uuid, bigint) from public;
revoke execute on function public.recompute_rewatch_flags_after_change() from public;
revoke execute on function public.remove_completed_watch_from_watchlist() from public;
revoke execute on function public.reject_completed_watchlist_item() from public;
revoke execute on function public.validate_ranking_session_answer() from public;
revoke execute on function public.sync_ranking_session_answer_counts() from public;
revoke execute on function public.validate_comparison_insert() from public;
revoke execute on function public.protect_append_only_user_record() from public;
revoke execute on function public.prevent_deleting_active_ranked_film() from public;

comment on column public.watch_entries.watched_on is
  'User-chosen local calendar date. Never round-trip through UTC or default from database current_date.';
comment on column public.watch_entries.note is
  'Plain text, at most 2,000 Unicode characters as measured by PostgreSQL char_length.';
comment on table public.comparisons is
  'Append-only events copied from mutable ranking-session answers at atomic commit.';
comment on view public.canon is
  'Deterministic verdict-banded canon. derived_score remains NULL until total_ranked reaches five.';
comment on view public.public_diary_entries is
  'Privacy-safe public diary projection; private note text is always redacted.';
comment on view public.public_canon is
  'Privacy-safe public canon projection; active session identifiers are omitted.';

commit;
