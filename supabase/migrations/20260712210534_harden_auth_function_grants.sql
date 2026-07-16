-- Supabase grants EXECUTE on newly created functions directly to API roles via
-- default privileges. Revoking only from PUBLIC therefore leaves explicit
-- anon/authenticated/service_role grants in place. Normalize every privileged
-- application function to a deny-by-default allowlist.

revoke execute on function public.begin_ranking_session(
  bigint, uuid, public.ranking_reason, public.verdict
) from public, anon, authenticated, service_role;
revoke execute on function public.record_ranking_answer(uuid, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.undo_last_ranking_answer(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.commit_ranking_session(
  uuid, public.placement_confidence
) from public, anon, authenticated, service_role;
revoke execute on function public.rebalance_canon_bucket(public.verdict)
  from public, anon, authenticated, service_role;
revoke execute on function public.pause_ranking_session(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.resume_ranking_session(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.abandon_stale_ranking_sessions()
  from public, anon, authenticated, service_role;
revoke execute on function public.convert_dnf_to_completed(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.cache_tmdb_movie(
  bigint, text, text, text, date, integer, text, text, jsonb, jsonb,
  text, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke execute on function public.consume_tmdb_cache_budget()
  from public, anon, authenticated, service_role;
revoke execute on function public.get_after_credits_state()
  from public, anon, authenticated, service_role;

revoke execute on function public.set_watch_entry_rewatch_flag()
  from public, anon, authenticated, service_role;
revoke execute on function public.set_updated_at()
  from public, anon, authenticated, service_role;
revoke execute on function public.lock_watch_entry_pair()
  from public, anon, authenticated, service_role;
revoke execute on function public.normalize_new_watch_entry_state()
  from public, anon, authenticated, service_role;
revoke execute on function public.recompute_rewatch_flags_for_pair(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke execute on function public.recompute_rewatch_flags_after_change()
  from public, anon, authenticated, service_role;
revoke execute on function public.remove_completed_watch_from_watchlist()
  from public, anon, authenticated, service_role;
revoke execute on function public.reject_completed_watchlist_item()
  from public, anon, authenticated, service_role;
revoke execute on function public.validate_ranking_session_answer()
  from public, anon, authenticated, service_role;
revoke execute on function public.sync_ranking_session_answer_counts()
  from public, anon, authenticated, service_role;
revoke execute on function public.validate_comparison_insert()
  from public, anon, authenticated, service_role;
revoke execute on function public.protect_append_only_user_record()
  from public, anon, authenticated, service_role;
revoke execute on function public.prevent_deleting_active_ranked_film()
  from public, anon, authenticated, service_role;

grant execute on function public.begin_ranking_session(
  bigint, uuid, public.ranking_reason, public.verdict
) to authenticated;
grant execute on function public.record_ranking_answer(uuid, bigint, bigint)
  to authenticated;
grant execute on function public.undo_last_ranking_answer(uuid) to authenticated;
grant execute on function public.commit_ranking_session(
  uuid, public.placement_confidence
) to authenticated;
grant execute on function public.rebalance_canon_bucket(public.verdict)
  to authenticated;
grant execute on function public.pause_ranking_session(uuid) to authenticated;
grant execute on function public.resume_ranking_session(uuid) to authenticated;
grant execute on function public.convert_dnf_to_completed(uuid) to authenticated;
grant execute on function public.consume_tmdb_cache_budget() to authenticated;
grant execute on function public.get_after_credits_state() to authenticated;

grant execute on function public.abandon_stale_ranking_sessions() to service_role;
grant execute on function public.cache_tmdb_movie(
  bigint, text, text, text, date, integer, text, text, jsonb, jsonb,
  text, jsonb, jsonb, jsonb
) to service_role;
