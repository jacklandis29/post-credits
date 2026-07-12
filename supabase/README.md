# Post Credits database

The initial migration in `migrations/0001_after_credits.sql` implements the v1
Supabase data model, transactional ranking primitives, derived canon scores, and
Row Level Security boundaries described in `PRD.md`.

## Apply locally

Install the Supabase CLI, initialize/link the project if needed, then run:

```bash
supabase start
supabase db reset
supabase db lint
supabase gen types typescript --local > lib/database.types.ts
```

For a linked hosted project, review the generated diff before running:

```bash
supabase db push --dry-run
supabase db push
```

Without the CLI, open the hosted project's SQL Editor, paste the complete
`migrations/0001_after_credits.sql` file, and run it once.

The migration targets Supabase Postgres 15 or newer. It expects the standard
Supabase `auth` schema and `anon`, `authenticated`, and `service_role` roles.

## Durable logging and ranking flow

1. Insert `movies` metadata from a server-only path, then insert a
   `watch_entries` row. `watched_on` is required and is a plain SQL `date`; send
   the user's chosen local calendar date as `YYYY-MM-DD`. Do not construct it by
   converting a JavaScript timestamp through UTC.
2. Send only `completion_status` for this state choice. The database derives
   `ranking_status`: a DNF becomes `not_applicable`, a first completed watch
   becomes `pending`, and a completed rewatch of an existing canon film remains
   `complete` unless the user opts to re-rank. A completed insert removes the
   matching Watchlist item in that same database transaction; a DNF does not.
   Convert a later-finished DNF through `convert_dnf_to_completed`, not a direct
   status update.
3. After the verdict is chosen, call `begin_ranking_session`. It creates or
   moves the single provisional `ranked_films` row and opens the user's one
   unresolved session atomically. PostgreSQL derives full-bucket bounds and a
   collision-free fractional midpoint; callers do not supply positions.
4. Call `record_ranking_answer` after each choice. A null winner represents
   "too close to call." Given only session, opponent, and winner IDs, the
   function narrows at the opponent and calculates the next midpoint itself. It
   saves the prior bounds and provisional placement for undo.
   `undo_last_ranking_answer` removes only the newest answer and restores them.
5. Call `commit_ranking_session` (or commit the current placement directly).
   It marks the session committed, copies answers to immutable `comparisons`,
   finalizes placement confidence, appends `rank_history`, updates the linked
   watch entry, and removes any remaining Watchlist item in one transaction.
   Omitted confidence defaults to `provisional`; pass `exact` only when the
   comparison engine has actually exhausted the interval.

`pause_ranking_session` and `resume_ranking_session` implement the abandoned
resume state. The database constrains users to one `active` or `abandoned`
session in total. A scheduled server task should invoke the service-role-only
`abandon_stale_ranking_sessions` RPC; it marks active sessions older than 24
hours abandoned. The migration deliberately does not assume `pg_cron` is enabled.

The comparison engine remains responsible for choosing a useful unused
comparator inside the persisted interval. PostgreSQL owns interval narrowing and
placement. Positions sort ascending within a verdict bucket. Call
`rebalance_canon_bucket` before a new session if adjacent numeric gaps become
too small; it rejects calls while any session is unresolved.

## Read surfaces and privacy

- `get_after_credits_state()` returns the authenticated owner's diary,
  Watchlist, canon, history, comparisons, one unresolved session and its
  answers, plus referenced movie metadata/palettes as one JSON object under one
  PostgreSQL snapshot. It is `SECURITY INVOKER`, so normal owner RLS remains the
  authorization boundary.
- `canon` computes deterministic global rank, within-bucket rank and size, total
  canon size, and the verdict-banded derived score. `derived_score` is null until
  the user has at least five ranked films.
- Owners read their complete diary from `watch_entries`. That base table is
  intentionally owner-only even for a public profile: RLS cannot expose a row
  while hiding just its private `note` column.
- Anonymous and non-owner profile pages must read diary rows from
  `public_diary_entries`. The security-barrier view returns only public profiles
  and replaces private note text with null. Treat its projection as a security
  boundary: do not add a column without a privacy review, and keep the view
  owned by the migration owner (`postgres` in normal Supabase migrations).
- Public profile pages read `public_profiles` and `public_canon`; those
  projections omit private settings and active session identifiers. They return
  rows only when the owning profile is public. The corresponding base tables
  remain owner-only. Rank history, ranking sessions, session answers, comparison
  evidence, and Watchlist rows also remain owner-only.
- Username search should use `discoverable_profiles`. A public but
  non-discoverable profile is still public at a known URL; discoverability is not
  a secrecy control.
- `public_access_approved` is a server-controlled beta gate and defaults false.
  Approve an account with the service role only after the PRD's reporting,
  moderation, and abuse-response prerequisites exist; users may toggle
  `is_public` only after that approval. Revoking approval must set `is_public`
  and `is_discoverable` false in the same server transaction.
- Movie metadata and palettes are globally readable and have no direct client
  write policy. The application sends only a TMDB ID to its authenticated
  server route; that route fetches TMDB itself and invokes the service-role-only
  `cache_tmdb_movie` with validated metadata, including language, production
  countries, principal cast, and comparison keywords. The RPC fills missing
  fields but never overwrites established global metadata. Authoritative
  refreshes and palettes remain service-role work.
- On a true cache miss, the server route calls the no-argument
  `consume_tmdb_cache_budget()` RPC with the user's JWT. It returns a scalar
  boolean from a private, row-locked budget: at most 20 misses per user in each
  one-minute window. Clients cannot choose the user, limit, window, or reset.

## Important invariants

- Usernames are canonical lowercase `citext`, 3-30 characters, and unique
  case-insensitively.
- Notes are plain text with a database-enforced 2,000-character maximum.
- A DNF cannot be marked as a rewatch or enter a ranking state.
- Rewatch flags are derived from completed entries in local-date order and are
  repaired when an earlier watch is backfilled. Pair-level transaction locks
  keep simultaneous inserts deterministic. A prior DNF does not count.
- `(user_id, tmdb_id)` is unique in both `ranked_films` and `watchlist_items`.
- Watchlist inserts reject movies already represented by a completed watch or
  canon row; a movie with DNF entries only remains eligible.
- `(user_id, verdict, sort_position)` is unique, so canon order is total and
  deterministic.
- At most five decisive answers and two skips may exist in a session.
- Committed comparisons and rank-history rows reject update/delete. Deleting the
  owning profile (normally by deleting the `auth.users` row from a trusted
  account-deletion path) is the supported erasure path.

## Verification before deployment

Run the migration in a disposable Supabase project and add integration tests for
all three request identities: owner, authenticated non-owner, and anonymous.
At minimum, verify private/public profiles, inherited/public/private note modes,
Watchlist isolation, cross-user RPC attempts, answer undo, commit rollback, the
five-answer/two-skip limits, and account deletion cascades.

This repository did not initially include a running local Supabase stack, so the
SQL should still be exercised with `supabase db reset` before a hosted push. The
intentional security-definer public diary view deserves special regression tests
whenever its columns or joins change.
