create function public.update_watch_entry(
  p_watch_entry_id uuid,
  p_watched_on date,
  p_note text,
  p_visibility public.note_visibility
)
returns public.watch_entries
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_entry public.watch_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_watched_on is null then
    raise exception 'Watch date is required' using errcode = '22004';
  end if;
  if pg_catalog.char_length(pg_catalog.coalesce(p_note, '')) > 2000 then
    raise exception 'Notes cannot exceed 2000 characters' using errcode = '22001';
  end if;

  update public.watch_entries
  set watched_on = p_watched_on,
    note = pg_catalog.nullif(pg_catalog.btrim(p_note), ''),
    visibility = p_visibility
  where id = p_watch_entry_id
    and user_id = auth.uid()
  returning * into v_entry;

  if not found then
    raise exception 'Diary entry not found' using errcode = '42501';
  end if;
  return v_entry;
end;
$$;

create function public.delete_watch_entry(
  p_watch_entry_id uuid,
  p_remove_from_canon boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry public.watch_entries%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  perform 1 from public.profiles where id = v_user_id for update;
  select * into v_entry
  from public.watch_entries
  where id = p_watch_entry_id and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Diary entry not found' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.ranking_sessions
    where watch_entry_id = v_entry.id
      and status in ('active'::public.ranking_session_status, 'abandoned'::public.ranking_session_status)
  ) then
    raise exception 'Finish this entry''s ranking before deleting it' using errcode = '55000';
  end if;

  delete from public.watch_entries where id = v_entry.id and user_id = v_user_id;
  if p_remove_from_canon then
    delete from public.ranked_films
    where user_id = v_user_id and tmdb_id = v_entry.tmdb_id and active_ranking_session_id is null;
  end if;
end;
$$;

revoke execute on function public.update_watch_entry(uuid, date, text, public.note_visibility)
  from public, anon, authenticated, service_role;
revoke execute on function public.delete_watch_entry(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.update_watch_entry(uuid, date, text, public.note_visibility)
  to authenticated;
grant execute on function public.delete_watch_entry(uuid, boolean) to authenticated;
