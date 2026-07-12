# Post Credits — Product Requirements Document

**Status:** Draft for product alignment  
**Version:** 0.3  
**Date:** July 11, 2026  
**Product:** Responsive web app  
**Stack:** Next.js App Router, TypeScript, Supabase, Tailwind CSS, Vercel, TMDB API

---

## 1. Product summary

Post Credits is a personal film diary built around one opinion that matters: yours.

It lets people log films, write private or public notes, and maintain a living all-time ranking without choosing stars or inventing scores. Each new film starts with a coarse verdict—**liked it**, **fine**, or **didn't like it**—then enters the user's ranked canon through a short series of head-to-head choices. A 0–10 score is derived from the verdict and position within that verdict band rather than assigned directly.

The product should feel more like opening a beautifully kept film journal than entering a social network. Film artwork supplies the color; the interface supplies restraint.

### Project intent

Post Credits is first a product we want to use and a portfolio-quality demonstration of product judgment, interaction design, and full-stack execution. It should be engineered as a real product—secure, resilient, accessible, and capable of supporting outside users—without assuming that growth, monetization, or company formation is the goal. It succeeds if it becomes an excellent personal film diary, even if its long-term active user count is one.

### Product promise

> Log a film in under a minute and leave with a more honest, more useful record of your taste.

### Positioning

Post Credits is the anti-Letterboxd in behavior, not just appearance:

- Personal taste is primary; consensus is never placed beside it.
- Ranking replaces star inflation and rating anxiety.
- The diary is the destination, not an engagement feed.
- Social viewing is intentional and profile-led, not algorithmically pushed.
- No ads, popularity contests, likes, comments, trending lists, or attention traps in v1.

---

## 2. The problem

Existing film trackers are good databases and busy social networks, but often poor personal records.

People face four recurring problems:

1. **Assigned ratings drift.** A 4-star film from three years ago may not mean the same thing as a 4-star film today.
2. **Scores inflate.** Users cluster ratings in a narrow positive range, making their own history less meaningful.
3. **Consensus crowds out reflection.** Community averages, reviews, and popularity signals shape an opinion before a user has recorded their own.
4. **The diary feels transactional.** Logging is optimized, but looking back rarely feels personal, cinematic, or worth returning to.

Post Credits turns logging into an act of curation. Every entry contributes to a living portrait of the user's taste.

---

## 3. Goals and non-goals

### v1 goals

- Let a new user log a first film within two minutes of creating an account.
- Make the 3–5 comparison ranking flow fast, comprehensible, and enjoyable.
- Maintain one deterministic personal ranking across every uniquely logged completed film once a verdict has been chosen; DNF and verdict-pending entries are explicit exceptions.
- Present the diary as a poster-forward, highly visual record grouped by month.
- Make a user's own verdict, rank, and note more prominent than film metadata.
- Support rewatches without duplicating a film in the ranked canon.
- Give users a lightweight Watchlist that does not interact with ranking.
- Let users intentionally visit public profiles and read public notes without importing social proof into their own film experience.
- Establish a reusable palette system that lets each film tint the interface while preserving accessibility.

### Non-goals for v1

- Native iOS or Android apps.
- TV series, episodes, shorts, or podcasts.
- Manual or custom movie records. v1 supports TMDB-backed feature films only; a feature film absent from TMDB cannot be logged until manual entries are added post-v1.
- Following feed, likes, comments, notifications, or direct messages.
- Community averages, aggregate ratings, trending films, or popularity charts.
- Full machine-learning recommendation infrastructure. v1 discovery uses transparent, deterministic signals from the user's canon and TMDB metadata.
- Custom lists beyond the single ranked canon.
- Watch-provider availability, ticketing, or streaming links.
- Data import from Letterboxd or other services. This is a strong post-v1 onboarding feature.
- Full year-in-review experience. v1 should capture the data needed to build it later.
- Automatic palette browsing of the full canon. v1 stores palettes and may include a small proof of concept only.
- Detailed partial-watch tracking such as minutes watched or the point where a film was abandoned. v1 supports a simple DNF diary state only.

---

## 4. Product principles

### 4.1 Yours before theirs

The user's note, verdict, rank, and watch history appear before plot, cast, runtime, or release information. Other people's opinions never appear on the user's home, diary, ranking flow, or personal film page.

### 4.2 Deliberate social, not ambient social

People may visit another person's profile and see entries that person has made public. The product never inserts those opinions into personal surfaces and never shows engagement counts.

### 4.3 Comparative truth over numerical theater

Users answer questions people can answer reliably: “Which did you like more?” The app owns the derived score and explains that it is relative to the user's current canon.

### 4.4 Fast to log, rewarding to revisit

The core flow should take less than one minute for a returning user. The lasting reward is the diary, canon, and changing record of taste.

### 4.5 The film provides the spectacle

The chrome stays quiet. Poster art, backdrops, extracted color, typography, and motion create the emotional register.

---

## 5. Target user and core jobs

### Primary user

A film lover who watches regularly and wants a meaningful private record, but finds star ratings arbitrary and mainstream film platforms noisy or performative.

### Core jobs to be done

- “When I finish a film, help me capture what I thought before outside opinions overwrite it.”
- “Help me place this film relative to movies I already know without making me invent a score.”
- “Let me look back at a beautiful, chronological record of what I watched.”
- “Show me how my taste has changed over time.”
- “When I choose to, let me see a friend's taste in the context of their own canon.”

---

## 6. Experience architecture

### Primary navigation

1. **Home** — film discovery, personalized recommendations, watchlist resurfacing, and recent activity.
2. **Diary** — all watch entries grouped by month.
3. **Canon** — the user's complete ranked list.
4. **Watchlist** — films the user wants to watch.
5. **People** — username search and deliberately opened public profiles.
6. **Profile / Settings** — identity, privacy, timezone, data, account, credits.

The persistent primary action is **Log a film**.

### Key object model

- A **movie** is TMDB-backed metadata shared by all users.
- A **watch entry** records one viewing on one date and may contain a note.
- A **ranked film** is the user's single current placement of a movie in their canon.
- A **comparison** records one head-to-head ranking decision.
- A **verdict** is the film's current coarse bucket: liked, fine, or disliked.
- A **ranking session** is mutable in-progress work; committed comparisons remain immutable.
- A **Watchlist item** is an unranked intent to watch a movie.

A rewatch creates a new watch entry but updates the existing ranked film only when the user chooses to re-rank it.

---

## 7. Core user flows

### 7.1 First-run onboarding

1. User signs in with email magic link or Google.
2. User chooses a unique username and display name.
3. User chooses profile visibility: **Private** by default or Public.
4. A three-panel introduction explains:
   - You do not assign stars.
   - Comparisons place films in your canon.
   - Scores change as your canon changes.
5. User is invited to log a first film.

The onboarding must not ask the user to manually seed a large movie list.

### 7.2 Log a new film

1. User opens **Log a film**.
2. User searches by title; results show poster, title, and release year.
3. User selects a film.
4. User chooses watch date, defaulting to today.
5. User optionally writes a note and chooses note visibility.
6. User confirms the date and note. The watch entry commits immediately.
7. User answers: **Liked it**, **Fine**, or **Didn't like it**.
8. The app immediately creates a provisional midpoint placement in that verdict bucket and opens a ranking session.
9. App runs up to five comparisons: “Which did you like more?”
10. User may select either film, **Too close to call**, or **Undo** the most recent answer.
11. Each answer updates the session's bounds and provisional placement, but does not create an immutable comparison event yet.
12. App commits the final placement and comparison events together, then reveals rank, derived score when eligible, and nearby canon neighbors.
13. User lands on the new diary entry / personal film page.

Target completion time for a returning user: **under 60 seconds**.

### 7.3 Logging and ranking state machine

The flow must remain valid when a tab closes, a device loses connectivity, or a user intentionally leaves.

| State | Persisted state | Canon behavior | Resume behavior |
|---|---|---|---|
| `draft` | Client-only selection and unconfirmed form | No entry or placement | Restart the form |
| `watch_saved` | Watch entry, date, note, visibility | No placement until a verdict exists | Show **Finish ranking** on the entry and Home |
| `ranking_in_progress` | Watch entry, verdict, provisional placement, mutable session answers and bounds | Film occupies the current midpoint of the unresolved interval with `placement_confidence = provisional` | Resume at the next comparison; user may also accept current placement |
| `ranked` | Watch entry, final placement, immutable comparison events, rank history | Exact or bounded-provisional placement is part of the canon | Normal film page |

Rules:

- A user may have at most one unresolved ranking session—active or abandoned—across all films. Starting another ranking flow prompts them to **Continue** or **Keep current placement** for the existing session before proceeding.
- Confirming date and note is the durable logging boundary. A ranking failure can never erase the diary entry.
- Choosing a verdict is the durable canon boundary. The app creates a valid provisional placement before showing the first comparison.
- After every answer, save the mutable session state and updated provisional position transactionally.
- Undo removes only the most recent mutable session answer, restores the previous interval and provisional position, and may be repeated back to the start of the current session.
- Immutable `comparisons` rows are created only when the user finishes or selects **Accept this placement**.
- A session untouched for 24 hours is marked `abandoned`; its current provisional placement remains valid. Returning to the film offers **Continue ranking** or **Keep current placement**.
- **Keep current placement** commits the session's remaining answers and current provisional position without asking another comparison.
- If the user leaves before choosing a verdict, the diary entry remains unranked and is excluded from the canon until they choose **Finish ranking**.

### 7.4 Log a rewatch

1. Selecting an already-ranked film changes the CTA to **Log a rewatch**.
2. User records date and an optional new note.
3. App asks: **Has your opinion changed enough to re-rank it?**
4. If no, the film keeps its verdict and rank.
5. If yes, the user chooses a new coarse verdict; the film immediately moves to a provisional midpoint in that bucket and the normal resumable comparison flow begins.
6. The old rank remains in rank history; the canon shows only the new current placement.

### 7.5 Change a verdict or re-rank without a rewatch

1. On the personal film page, the verdict/rank block includes **Change verdict or re-rank** in its overflow menu.
2. The flow begins with the current coarse verdict and asks the user to confirm or choose a different verdict.
3. Once confirmed, the ranked film moves to a provisional midpoint placement in the selected bucket and a ranking session opens.
4. Comparisons, undo, abandonment, and commit behavior match the state machine in section 7.3.
5. Completion writes rank history with reason `manual_rerank`; it does not create a watch entry.

### 7.6 Log a DNF

- The logging form includes a secondary **Did not finish** option before the verdict step.
- A DNF creates a diary entry with `completion_status = dnf`, date, and optional note.
- A DNF does not receive a verdict, enter the canon, generate a score, or start comparisons.
- DNF entries display a quiet label in the diary and may later be converted into a completed watch, at which point normal ranking begins.
- DNFs are excluded from films-watched, minutes-watched, and rewatch statistics.

### 7.7 Browse the diary

- Entries are grouped by calendar month, newest first.
- Default desktop layout is a dense 2:3 poster wall; mobile uses a two-column poster grid.
- Each poster exposes watch date and verdict on focus, hover, or tap without obscuring the artwork by default.
- Selecting a poster opens the user's personal film page.
- Multiple rewatches appear as separate diary moments but share one current canon rank.
- DNF entries appear chronologically but are visually distinct and have no rank.

### 7.8 Browse the canon

- The canon is a numbered, sortable-by-rank view of unique films.
- Default view emphasizes poster, rank, derived score, title, year, and latest note excerpt.
- Filters: verdict, year watched, release decade, genre, and rewatched.
- Search is scoped to films the user has logged.
- Alternate sorts do not modify canonical order.

### 7.9 Use the Watchlist

- A **Watchlist** control appears on TMDB-backed film detail/search results when the film has not been completed.
- Adding or removing a film is one action and never starts ranking.
- Watchlist defaults to most recently added and supports title search.
- Logging a completed watch removes that movie from the Watchlist in the same transaction.
- Logging a DNF leaves the movie on the Watchlist by default and offers **Remove from Watchlist**.
- Watchlist is private in v1, including for public profiles.

### 7.10 View another person

- User searches for an exact or partial username.
- Public profile shows that person's public diary entries and canon.
- Scores are labeled as relative to that person's canon.
- Private notes and private profiles are never discoverable.
- There are no likes, comments, follower counts, or “popular with friends” modules.
- Another person's opinion never appears on the viewer's personal film page.

---

## 8. Ranking model

### 8.1 Canon invariant

Each user has one total ordering of unique films:

1. All **Liked it** films, ordered best to worst.
2. All **Fine** films, ordered best to worst.
3. All **Didn't like it** films, ordered best to worst.

Changing a coarse verdict moves a film into a different section and triggers re-ranking within that section.

### 8.2 Adaptive insertion

The comparison engine searches only within the selected verdict bucket.

For each question:

1. Select a comparison film near the midpoint of the unresolved rank interval.
2. When several candidates offer similar information gain, prefer the movie most similar by genre, keywords, release era, and runtime.
3. If the new film wins, search the better-ranked half.
4. If the existing film wins, search the lower-ranked half.
5. Stop when the position is exact or five decisive answers have been recorded.

This is a bounded binary insertion, not a promise of exact placement at every list size. Five yes/no answers distinguish at most 32 positions. When more positions remain after the fifth answer, insert at the midpoint of the unresolved interval and mark the placement as **provisional** internally.

Provisional status is not shown as a warning during normal use. In v1, a user may improve an unsatisfying provisional placement through the normal manual re-rank flow; proactive refinement prompts are post-v1.

### 8.3 “Too close to call” behavior

- A skip provides no ordering information and does not count as a decisive answer.
- The engine chooses a different film from the same unresolved interval.
- Allow at most two skips per logging session.
- After two skips, or when no unused comparator remains, place the film at the midpoint of the unresolved interval.
- v1 does not create permanent tied ranks; this avoids unstable score and display behavior.

### 8.4 Small-canon behavior

- Film 1: no comparison; rank 1.
- Films 2–4: compare against as many existing films in the verdict bucket as needed, up to three.
- Derived scores are hidden until the user has at least five ranked films. Before then, show rank and verdict only.

### 8.5 Derived score

Scores use fixed verdict bands so the number always agrees with the user's coarse judgment:

| Verdict | Score band |
|---|---:|
| Liked it | 7.0–10.0 |
| Fine | 4.0–6.9 |
| Didn't like it | 0.0–3.9 |

For a verdict bucket with `B > 1` films and a film at one-based within-bucket rank `b`:

```text
bucket_percentile = (B - b) / (B - 1)

liked_score    = round_to_1_decimal(7.0 + 3.0 × bucket_percentile)
fine_score     = round_to_1_decimal(4.0 + 2.9 × bucket_percentile)
disliked_score = round_to_1_decimal(0.0 + 3.9 × bucket_percentile)
```

When a bucket contains one film, use the band midpoint: 8.5 liked, 5.5 fine, or 2.0 disliked.

Properties:

- A liked film can never display a score that reads as disliked, and adjacent verdict bands never overlap.
- Ranking still prevents manual score inflation: users cannot assign a number, and every film must occupy an ordered position within its verdict.
- A score may change when the film's relative position or the membership of its verdict bucket changes.
- Adding a film to a different verdict bucket does not change this film's score.
- Store verdict and rank position, not score; calculate score when reading.
- Public scores must include accessible explanatory copy: “Derived from this person's verdict and current ranking.”

### 8.6 Ranking integrity

- Answers remain mutable inside an active ranking session so the user can undo mistakes.
- When the session is committed, its decisive answers are copied to immutable comparison events. Undone answers no longer exist in the active session and are never committed.
- The provisional placement is updated after each answer; final placement, comparison events, and rank history commit in one database transaction.
- Duplicate active placements for the same user and movie are prohibited.
- Re-ranking preserves previous placement in rank history.
- Users can manually start **Re-rank this film**, but cannot drag films directly into arbitrary positions in v1.

---

## 9. Functional requirements

### 9.1 Authentication and profiles

- Email magic-link and Google sign-in.
- Unique case-insensitive username.
- Display name, optional avatar, short bio.
- IANA profile timezone, initialized from the browser and editable in Settings.
- Profile visibility: private or public; default private.
- Per-note visibility: inherit profile, private, or public.
- Account deletion removes user-owned records and personal data.

### 9.2 Movie search and metadata

- v1 can create diary, canon, and Watchlist records only for movies with a TMDB ID.
- Search TMDB movie titles with a 250–350 ms debounce.
- Results include poster, localized title, original title when different, and release year.
- Adult results are excluded in v1.
- Cache selected movie metadata locally by TMDB ID.
- Store TMDB image paths rather than copying source artwork.
- Refresh stale metadata opportunistically; a TMDB outage must not break already-logged films.
- Support missing posters and backdrops with designed fallbacks.

Minimum cached fields:

- TMDB movie ID
- title and original title
- overview
- release date
- runtime
- poster path and backdrop path
- genres
- original language and production countries
- director and principal cast subset
- keywords used for comparison similarity
- metadata refresh timestamp

### 9.3 Diary entries and notes

- One movie may have multiple watch entries.
- Watch date is editable and may be in the past.
- `watched_on` is the calendar date local to the user at entry time and is stored as a plain SQL `date`, never converted through UTC.
- “Today” defaults using the profile timezone. The user may change the date when travel or a late-night viewing makes that default wrong.
- Calendar groupings and “this year” statistics use the stored local date and the profile timezone; timestamps such as `created_at` remain UTC instants.
- Note is optional, plain text, and limited to 2,000 characters.
- Notes render in serif italic but use a legible non-italic editing field.
- Users may edit or delete a watch entry.
- Deleting the only watch entry asks whether to also remove the film from the canon.
- Deleting a ranked film re-closes the canon without changing comparison history.
- A completed watch and a DNF are explicit states; only completed watches enter ranking and watched-film statistics.

### 9.4 Watchlist

- One private Watchlist item per user and movie.
- Add/remove actions are available from movie search, movie detail, and the Watchlist itself.
- A completed log removes the matching Watchlist item transactionally.
- Watchlist order is most recently added by default; v1 has no manual ordering or public sharing.
- Watchlist state does not influence ranking, comparison selection, or scores. It may influence discovery and resurfacing on Home.

### 9.5 Personal film page

Information hierarchy:

1. Film title and artwork.
2. User verdict, current rank, derived score, and note.
3. Watch history and rank movement.
4. Quiet film metadata: year, director, runtime, genres, cast, overview.

No TMDB user rating, vote count, popularity, external review, or friend opinion appears.

### 9.6 Home

- Home answers **What should I watch next?** before recapping what the user already watched.
- Signed-out users receive mood-led browsing, recently watched films from public activity, and a clear explanation of how a personal canon improves recommendations. Community scores, rankings, and engagement counts never appear.
- Signed-in users receive one prominent recommendation and focused discovery rails derived from their highest-ranked liked films, TMDB similarity metadata, and watchlist.
- Every recommendation should explain its strongest signal in plain language, such as **Because you loved Arrival**.
- Watchlist resurfacing and a compact recent diary strip follow the discovery content.
- Immediate **Log a film** action remains available without making logging the page's only job.
- Quiet footer stats: films this year, minutes watched, and rewatch count.
- Minutes watched is the sum of cached runtimes for completed watch entries; entries with unknown runtime and DNFs are excluded rather than estimated.
- If an entry or ranking session is unfinished, show one quiet **Finish ranking** card before discovery rails.
- A new signed-in user's empty state offers useful broad discovery while explaining that recommendations sharpen as their canon grows.

### 9.7 Privacy and social access

- Public profile data is readable without authentication; private profile data is owner-only.
- Search returns only public profiles unless the searching user is the profile owner.
- A public profile does not imply every note is public.
- Block reporting, moderation tooling, and abuse response are required before enabling public profiles for outside users, even without comments.
- Search engines should not index private profiles and should respect a public user's discoverability setting.

### 9.8 Credits and attribution

- Include an About / Credits page with an approved TMDB logo and the required notice: “This product uses the TMDB API but is not endorsed or certified by TMDB.”
- Product branding must remain more prominent than TMDB branding.
- Any future commercialization requires confirming the appropriate TMDB license before revenue-generating use.

---

## 10. Design requirements

### 10.1 Visual system

Base tokens:

| Token | Value | Use |
|---|---:|---|
| OLED black | `#070708` | Primary canvas |
| Raised black | `#101012` | Panels and sheets |
| Hairline | `#242428` | Dividers and borders |
| Quiet text | `#929197` | Secondary metadata |
| Primary text | `#F1EEE6` | Cream foreground |

- Use near-colorless chrome; do not create a permanent brand accent color.
- Film palettes may tint backgrounds, focus rings, selection states, gradients, and atmospheric glows.
- Cream remains the stable high-contrast foreground.
- Avoid glassmorphism, dashboard cards, visible gradients unrelated to film art, and excessive rounded rectangles.

### 10.2 Film palette system

- Extract five dominant swatches from the highest-quality available backdrop.
- Store swatches as derived metadata keyed to the movie.
- Also calculate luminance and safe foreground pairings.
- Each film page selects:
  - one dominant atmospheric color,
  - one secondary glow,
  - one restrained interactive accent,
  - two supporting swatches reserved for year-in-review and color browsing.
- Apply a black overlay sufficient to maintain WCAG AA text contrast.
- Reject muddy near-black swatches and cap saturation/luminance to prevent illegible or neon UI.
- Fall back to the purple-blue-jewel house palette when no usable backdrop exists.
- Respect `prefers-reduced-motion` and provide a non-animated treatment.

### 10.3 Typography

- Editorial serif for film titles, major ranks, and hero statements; Fraunces is the initial candidate.
- Quiet grotesk sans for navigation, controls, labels, and metadata.
- Serif italic for rendered personal notes.
- Use optical sizing where supported and limit decorative variable-font effects.

### 10.4 Poster-forward behavior

- Preserve the 2:3 ratio even when source art is missing.
- Artwork is never dimmed merely to expose controls; controls appear in adjacent space or an intentional overlay state.
- Poster grids should not become generic equal-height card grids.
- Use backdrop art for large cinematic moments and poster art for identity and scanning.

### 10.5 Motion

- Motion should resemble a projector waking, a title card resolving, or a cut—not a social app bounce.
- Comparison transitions: 180–240 ms crossfade/slide.
- Page atmosphere: slow, subtle color interpolation only.
- No confetti, streak mechanics, gamified celebrations, or elastic micro-interactions.

### 10.6 Responsive and accessible behavior

- Core logging and comparison flows must work at 320 px width.
- Full keyboard navigation for search, verdict, comparison, and sheets.
- Visible focus treatment adapts to the active film palette while meeting contrast requirements.
- Posters have meaningful alt text; decorative backdrops use empty alt text.
- Never communicate verdict or rank movement through color alone.
- Minimum 44 × 44 px touch targets.

---

## 11. Technical approach

### 11.1 Application architecture

- Next.js App Router with Server Components for read-heavy pages.
- Client Components only for search interaction, logging, comparisons, and optimistic UI.
- Server-side TMDB proxy/cache so API credentials never reach the browser.
- Supabase Postgres for application data, Auth for identity, and Row Level Security for authorization.
- Vercel deployment with server-side functions for TMDB requests and palette extraction.
- Strict remote image allowlist for TMDB's image host in Next.js image configuration.

### 11.2 Proposed data model

#### `profiles`

- `id` UUID, references auth user
- `username` citext, unique
- `display_name`
- `avatar_url`
- `bio`
- `timezone` text, valid IANA identifier
- `is_public` boolean, default false
- `is_discoverable` boolean, default false
- timestamps

#### `movies`

- `tmdb_id` bigint, primary key
- cached metadata fields listed in section 9.2
- `metadata_refreshed_at`

#### `movie_palettes`

- `tmdb_id`, primary/foreign key
- `swatches` JSONB, exactly five validated hex colors
- `dominant_color`, `secondary_color`, `accent_color`
- `foreground_color`
- `source_backdrop_path`
- `algorithm_version`
- timestamps

#### `watch_entries`

- `id` UUID
- `user_id`
- `tmdb_id`
- `watched_on` date
- `completion_status` enum: completed, dnf
- `ranking_status` enum: pending, in_progress, complete, not_applicable
- `note` text
- `visibility` enum: inherit, private, public
- `is_rewatch` derived or set transactionally; true only when the user has an earlier completed watch for the movie, since a prior DNF alone does not make a later completion a rewatch
- timestamps

#### `watchlist_items`

- `id` UUID
- `user_id`
- `tmdb_id`
- `added_at`
- unique `(user_id, tmdb_id)`

#### `ranked_films`

- `id` UUID
- `user_id`
- `tmdb_id`
- `verdict` enum: liked, fine, disliked
- `sort_position` numeric for fractional ordering within verdict
- `placement_confidence` enum: exact, provisional
- `comparison_count`
- `active_ranking_session_id`, nullable
- `first_ranked_at`, `last_ranked_at`
- unique `(user_id, tmdb_id)`

#### `ranking_sessions`

- `id` UUID
- `user_id`
- `subject_tmdb_id`
- `watch_entry_id`, nullable for manual re-rank
- `reason` enum: initial_log, rewatch, manual_rerank
- `status` enum: active, committed, abandoned
- `target_verdict`
- `original_verdict`, `original_sort_position`, and `original_rank_snapshot`, nullable for first ranking
- `lower_bound_position`, `upper_bound_position`
- `current_provisional_position`
- `skip_count`
- `last_activity_at`, `committed_at`
- partial unique index on `user_id` where `status in (active, abandoned)`, enforcing one unresolved ranking session per user

#### `ranking_session_answers`

- `id` UUID
- `session_id`
- `opponent_tmdb_id`
- `winner_tmdb_id`, nullable for skip
- `sequence_number`
- `bounds_before` JSONB
- mutable/deletable only while the parent session is active; unique `(session_id, sequence_number)`

#### `comparisons`

- `id` UUID
- `user_id`
- `subject_tmdb_id`
- `opponent_tmdb_id`
- `winner_tmdb_id`, nullable for skip
- `session_id`
- `sequence_number`
- `created_at`
- rows are inserted only when a ranking session commits and are immutable afterward

#### `rank_history`

- `id` UUID
- `user_id`
- `tmdb_id`
- `rank_before`, nullable
- `rank_after`
- `verdict_before`, nullable
- `verdict_after`
- `reason` enum: initial_log, rewatch, manual_rerank
- `created_at`

### 11.3 Ordering and transactions

- Use fractional positions within each verdict bucket so inserting one film does not rewrite every row.
- A database function owns final insertion, rebalancing positions when gaps become too small.
- Canon rank is computed with `row_number()` across verdict priority and sort position.
- The function locks the user's relevant ranking rows for the short insertion transaction to prevent concurrent corruption.
- Starting a ranking session creates or moves the subject to a valid provisional midpoint placement before comparisons begin.
- Each session answer saves the new search bounds and provisional position atomically. Undo restores the stored `bounds_before` snapshot.
- Committing a session writes immutable comparisons, final placement confidence, rank history, and any Watchlist removal in one transaction.

### 11.4 Row Level Security

- Owners can create, read, update, and delete their own watch, rank, comparison, and history records.
- Owners alone can read or mutate their Watchlist and active ranking sessions.
- Public readers can access only the profile and content permitted by profile and per-entry visibility.
- Movie metadata and palettes are globally readable but server-written.
- Service-role credentials are restricted to server-only metadata and maintenance paths.
- Every table in an exposed schema has RLS enabled and tested.

### 11.5 Caching and resilience

- Cache movie search responses briefly; cache selected movie details long-term in Postgres.
- The app renders cached diary and canon data when TMDB is unavailable.
- Palette extraction is asynchronous from the logging user's perspective; use a house-palette fallback immediately.
- Failed extraction retries with a bounded backoff and never blocks logging.

### 11.6 Authentication email

- Owner-only/local alpha may use Supabase's built-in sender, with Google sign-in available as the low-friction fallback.
- Before inviting non-team testers, choose and configure a custom SMTP provider such as Resend or Postmark; Supabase's built-in sender is not a launch-grade delivery service.
- Phase 2 includes provider selection, sending-domain authentication, branded magic-link templates, deliverability testing, and monitoring failed sends.
- Authentication email contains no user-authored note or movie-history data.

### 11.7 TMDB proxy rate-limit behavior

- All TMDB requests pass through the server proxy; clients never call TMDB with product credentials.
- Cache selected metadata, coalesce identical in-flight requests, and debounce search so normal use produces minimal upstream traffic.
- Apply a server-side concurrency limit and request budget below TMDB's published approximate ceiling.
- On HTTP 429, respect `Retry-After` when present; otherwise use bounded exponential backoff with jitter.
- Never retry indefinitely. Search shows a recoverable unavailable state; previously cached movies continue to render and remain loggable.
- Log aggregate status codes and latency without recording user note text or raw search queries.

### 11.8 Backup, restore, and export

The diary is irreplaceable user data even when the product has only one user.

- During free-tier alpha, create an automated encrypted logical database export daily and store it outside the Supabase project and source repository; retain at least 30 daily and 12 weekly copies.
- Take an additional logical export before destructive migrations or bulk data corrections.
- On a paid Supabase plan, enable platform-managed daily backups; evaluate PITR only if usage and recovery needs justify its additional cost.
- Maintain a portable JSON/CSV user export that includes watch entries, notes, verdicts, current order, rank history, comparisons, Watchlist, and TMDB IDs.
- Document a restore runbook and perform a restore test into a disposable project at least once per quarter and before public beta.
- Define the initial recovery objectives as RPO 24 hours and RTO 1 business day, including for owner-only alpha.
- Deleting the primary Supabase project must require confirming that a recent external logical backup exists.

---

## 12. Analytics and success measures

No third-party ad tracking. Use privacy-conscious product analytics with no note text, search text, or film opinion payloads.

### Success definition

The primary test is personal utility: the owner voluntarily keeps using the diary because logging is pleasant and the record is worth revisiting. A second test is portfolio quality: the finished product demonstrates coherent product strategy, distinctive interaction and visual design, careful data modeling, and production-minded engineering. Outside-user retention is useful evidence if people are invited, not the reason the project exists.

### Activation

- Account created → first film logged.
- Median time from account creation to first log.
- Percentage completing their first comparison flow.

### Engagement quality

- Films logged per active week.
- Percentage of entries with notes.
- Diary and canon revisit rate.
- Rewatch logging and optional re-rank rates.
- Comparison skip rate and abandonment by question number.
- Percentage of abandoned ranking sessions later resumed versus accepted provisionally.
- Percentage of provisional placements later manually re-ranked.

### Guardrail metrics

- Median returning-user log time below 60 seconds.
- 100% of interrupted sessions after watch confirmation retain the diary entry.
- 100% of interrupted sessions after verdict selection retain one valid provisional canon placement.
- No meaningful increase in failed logs when palette extraction or TMDB is degraded.
- Privacy incidents and unauthorized-row test failures: zero.

Avoid optimizing for time-on-site, public profile views, or social engagement volume.

---

## 13. v1 release plan

### Phase 0 — Product and design proof (1–2 weeks)

- Validate the visual language on Home, Diary, Personal Film, and Comparison.
- Prototype ranking with 5, 30, and 300-film canons.
- Use the owner canon to confirm that fixed verdict bands and the score explanation feel right in daily use; outside testing is optional, not a Phase 0 gate.
- Confirm TMDB licensing requirements for the intended personal/portfolio distribution model.

**Exit:** The product feels distinctive with real poster/backdrop data, and users understand why a score changed without assigning it.

### Phase 1 — Private diary alpha (3–4 weeks)

Phase 1 is executed in this order. Lower tiers may move into a short Phase 1.1 rather than consuming time reserved for the product's differentiating experience.

**P0 — cannot slip: identity and feel**

- Real TMDB search, selected-metadata cache, attribution, and designed missing-art states.
- New-film logging with durable watch commit, verdict, crash-safe ranking session, undo, and bounded placement.
- Comparison-flow motion, transitions, responsive behavior, keyboard control, and clear selection feedback.
- Home, poster-wall diary, canon, and personal film page using real artwork.
- Derived verdict-banded scores and comparison history.
- Minimal auth/private profile setup plus RLS policies and owner/non-owner tests required to deploy safely.
- A convincing film-palette treatment; automated extraction may use a simple implementation so long as the visible result works.

**P1 — complete the core utility**

- Rewatch and manual verdict/re-rank flows.
- Private Watchlist.
- Robust palette extraction with fallback and contrast validation.
- TMDB cache degradation and bounded 429 handling.

**P2 — first to move if the timebox slips**

- DNF conversion and its secondary diary states.
- Editable profile timezone and travel/late-night edge-case polish; plain local-date storage remains part of P0 data modeling.
- Automated backup retention, alerts, and restore drills. Until complete, take a manual encrypted export before every migration or bulk edit.
- Expanded operational analytics beyond errors needed to debug the core flow.

**Exit:** A user can build and revisit a private 50-film canon without data or ordering errors.

### Phase 2 — Optional outside-user beta (2 weeks)

- Public/private profile controls.
- Per-note visibility.
- People search and public profile pages.
- Abuse reporting, moderation baseline, and blocking before outside users can publish content.
- Account export and deletion.
- Custom SMTP provider selection and deliverability setup.
- Automated daily-backup posture or equivalent 24-hour RPO, plus a successful restore test.

**Exit:** Public data exposure matches every visibility combination in automated tests.

### Phase 3 — Portfolio and publishable-product polish (1–2 weeks)

- Accessibility audit.
- Mobile and slow-network pass.
- Empty, error, and TMDB-degraded states.
- Performance budgets and image optimization.
- Analytics and operational monitoring.
- About / Credits, privacy policy, and terms.

**Exit:** Core logging is reliable, under-one-minute for returning users, and visually stable across supported devices.

---

## 14. v1 acceptance criteria

The release is complete when:

- A user can authenticate, choose a username, and keep a profile private.
- A user can search TMDB and log a film with a date, verdict, and optional note.
- Confirming date and note persists the diary entry before ranking begins.
- Closing the app during comparisons leaves exactly one valid provisional placement and a resumable session.
- A user can have only one unresolved ranking session; attempting to start another requires resolving the existing session first.
- A user can undo one or more answers within the active comparison session without creating contradictory comparison history.
- The app places a film using no more than five decisive comparisons and safely handles skips.
- Every user has at most one active ranked placement per movie.
- A rewatch creates a new diary entry without creating a duplicate canon item.
- Re-ranking a rewatch updates placement and preserves rank history.
- A user can change verdict and re-rank from the personal film page without logging a rewatch.
- A user can add and remove private Watchlist items; completing a film removes its Watchlist item transactionally.
- A DNF appears in the diary but never receives a verdict, rank, or watched-film statistic.
- Watch dates remain the chosen user-local calendar date, and year-based statistics respect the profile timezone.
- Rank and score are deterministic for the same canon order.
- Scores remain hidden below five ranked films and are explained wherever shown.
- Diary, canon, home, and personal film pages work on mobile and desktop.
- No other user's rating or review appears on a personal surface.
- Public profiles expose only explicitly permitted data.
- RLS tests cover owner, authenticated non-owner, and anonymous access.
- Already-logged films remain usable during a TMDB outage.
- TMDB 429 responses trigger bounded retry behavior and a recoverable search state, never an uncontrolled retry loop.
- Missing art and failed palette extraction have intentional fallbacks.
- Text and controls meet WCAG AA contrast against every generated palette.
- The About / Credits page satisfies TMDB attribution requirements.
- An encrypted external backup exists and the documented restore procedure has succeeded in a disposable environment.
- Before non-team testers use magic links, custom SMTP is configured and a test message is delivered successfully.

---

## 15. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Five comparisons cannot exactly place films in large canons | The central promise can feel mathematically misleading | Describe ranking as adaptive, record confidence, and use the manual re-rank flow when a provisional placement feels wrong |
| A user abandons ranking mid-flow | The diary entry could disappear or the canon could become incomplete | Commit the watch first, create a provisional placement at verdict selection, persist session bounds after every answer, and support resume |
| A comparison misclick corrupts placement | One wrong branch can create a badly wrong rank | Keep session answers mutable and allow repeated undo until commit |
| Two tabs mutate the same canon concurrently | Interleaved provisional insertions are confusing even when row locks preserve database validity | Enforce one unresolved ranking session per user and require it to be continued or accepted before another starts |
| “Similar” comparators reduce binary-search efficiency | A relatable choice may not split the rank interval well | Information gain determines the candidate window; similarity is a tiebreaker |
| Scores feel falsely precise | A one-decimal derived score can imply more certainty than five comparisons provide | Hide scores for small canons and explain that scores are relative products of verdict and rank |
| Coarse verdict becomes inconsistent with rank | A user may prefer a “fine” film over a previously “liked” one | Re-ranking begins with a fresh verdict and the UI explains that verdict defines the canon section |
| Social scope recreates the product being rejected | Public reviews can pull focus toward performance | Keep public profiles intentional and omit feeds, counts, reactions, and consensus |
| Artwork palettes harm readability | Film art varies wildly | Precompute luminance, constrain palette roles, add black overlays, test contrast |
| TMDB outage or metadata change breaks the diary | The lasting record should not depend on a live API | Cache selected metadata and degrade gracefully |
| Midnight and timezone conversion shifts watch dates | Late-night logs and yearly stats become untrustworthy | Store user-chosen local dates as SQL dates and compute calendar stats in the profile timezone |
| Project loss destroys an irreplaceable diary | Platform backups may be unavailable, too old, or removed with the project | Keep encrypted external logical exports, document restore steps, and test restoration regularly |
| Public notes create moderation obligations | Even a quiet network can host abuse | Default private, ship report workflow before broad public release |
| Fractional ordering degrades over time | Repeated inserts can exhaust space between positions | Transactional rebalance per user's verdict bucket |

---

## 16. Decisions recommended now

These recommendations keep the concept coherent and v1 buildable:

1. **Default profiles to private.** Public sharing should be chosen, not assumed.
2. **Keep social content off personal film pages.** Other people's notes belong only on their profiles in v1.
3. **Do not promise exact rank after five comparisons.** Use provisional placement and let manual re-ranking correct placements in v1.
4. **Hide the score until five films.** Early scores imply confidence the system does not yet have.
5. **Treat watch entries and ranked films as separate objects.** This makes rewatches and rank history clean.
6. **Do not ship a feed.** It would immediately weaken the product's differentiation.
7. **Design with real TMDB artwork before wiring every backend path.** The palette, typography, poster density, and transitions are core product behavior, not final polish.
8. **Commit the diary before ranking.** Logging must survive interruption; provisional placement keeps the canon valid.
9. **Ship Watchlist in v1.** It is a small, private utility that completes the film-detail interaction without expanding social scope.
10. **Treat DNF as diary-only.** It records real viewing behavior without forcing an unfinished film into the canon.
11. **Protect data proportionately.** A manual encrypted export before destructive work is the alpha floor; backup automation and restore drills must not displace the design or ranking experience.

---

## 17. Open product questions

These do not block a private alpha, but should be resolved before an optional outside-user beta:

1. Should a public profile expose the entire canon, or let users hide individual ranked films?
2. Should public notes be opt-in per entry even on a public profile, or inherit public by default?
3. Should “Too close to call” eventually create explicit tied groups, or remain a session-only skip forever?
4. Should an obviously wrong placement always require the specified re-ranking session, or should a future direct-move escape hatch exist?
5. Is public identity based on real-name display, pseudonymous usernames, or either?

---

## 18. Post-v1 opportunity map

Prioritize depth of personal reflection over generic social features:

- Letterboxd CSV import followed by a calibration queue.
- Cinematic year in review.
- Browse the canon by extracted color.
- Taste drift: films that climbed, fell, or changed verdict over time.
- Director, decade, country, genre, and color constellations.
- “Unsettled canon” sessions that refine provisional placements.
- Shareable personal title cards with no aggregate score.
- Compare two consenting users' canons without declaring compatibility or winners.
- Private collaborative household diary.
- Personal recommendation layer based on canon structure, only after the diary itself is strong.
- Manual film records for festival, repertory, and other feature films missing from TMDB, with a later reconciliation path if TMDB adds them.

The product should earn the right to add each of these by preserving the original promise: a quiet, beautiful record of one person's taste.

---

## 19. Implementation references

- [TMDB API getting started](https://developer.themoviedb.org/docs/getting-started)
- [TMDB movie search](https://developer.themoviedb.org/reference/search-movie)
- [TMDB similar-movies behavior](https://developer.themoviedb.org/reference/movie-similar)
- [TMDB image URL construction](https://developer.themoviedb.org/docs/image-basics)
- [TMDB attribution and licensing FAQ](https://developer.themoviedb.org/docs/faq)
- [TMDB rate limiting](https://developer.themoviedb.org/docs/rate-limiting)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js remote image configuration](https://nextjs.org/docs/app/api-reference/components/image#remotepatterns)
