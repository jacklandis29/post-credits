# Post Credits — Production Readiness Audit

Full-codebase deep dive (4 parallel audits: security/RLS, frontend, data layer, infra/ops), spot-verified. Checkboxes = work remaining. File references are current as of this audit.

## Implementation progress — 2026-07-16

Completed in this pass: the existing private Sites deployment was confirmed, production env/release validation was added, local state is versioned/capped/guarded, local imports are resumable and server-idempotent, source deletion now happens only after a successful authoritative refresh, async mutations have a synchronous re-entry guard, film restoration uses a generation guard, local Watchlist writes use the authoritative path, DNF date validation is consistent, security headers and a pinned production metadata origin are supported, import accessibility is included in the dialog focus system, CI and Node pinning exist, local history is bounded, product error pages and web metadata routes exist, and housekeeping drift called out below was corrected.

The Sites deployment now has its production Supabase/TMDB environment, and `postcredits.club` is the selected custom domain. Resend SMTP remains pending while its one-domain free-tier slot is moved from `jacklandis.com` to `auth.postcredits.club`; Google OAuth is intentionally deferred. Legal copy and monitoring provider choices still need owner input. Migration `0002_import_idempotency.sql` was applied to the connected Post Credits Supabase project on 2026-07-12 and its column/index were verified. Remaining unchecked engineering items are still open.

## What's already solid (verified — don't re-litigate)

- RLS is comprehensive and correct: owner-only policies with `force row level security`, base tables revoked from `anon`/`authenticated`, public reads only through `security_barrier` views gated on `is_public`, private notes nulled in the public view, session IDs omitted from public canon.
- No SQL injection surface: parameterized RPCs, pinned `search_path`, no dynamic SQL. `is_public` requires service-role-granted `public_access_approved` (no self-serve escalation).
- Magic-link/OAuth redirects use `window.location.origin` — no open-redirect vector. No backdoors or hardcoded secrets; TMDB + service keys are server-only; `.env` correctly untracked.
- TMDB cache route: server-side JWT validation, strict input validation, race-safe per-user DB budget (20/min), adult-content filtering.
- git hygiene nearly clean (dist/.wrangler/.vinext/.DS_Store all ignored and untracked).
- Ranking engine (`lib/ranking.ts`) well-tested; crash-safe session state machine design is sound.

---

## P0 — Blockers (app cannot responsibly launch without these)

### Deployment
- [x] **Production deploy path selected and verified.** The existing owner-only Sites deployment is the supported Cloudflare-compatible vinext path; `deploy:check` now gates release readiness.
- [x] **`.openai/hosting.json` reviewed as intentional production config.** It remains tracked because Sites is the selected deployment platform; removing it would remove the working deploy path.
- [x] **Production env validation added.** `npm run validate:env`/`deploy:check` require a canonical HTTPS origin, TMDB credentials, and both public/server Supabase credentials before a release.

### Auth has never run end-to-end
- [ ] Prove the real loop on a deployed URL: magic link (per-domain redirect allowlist in Supabase), Google OAuth prod credentials + consent screen, profile setup, sign out/in, **and the local-diary import sheet** (built but never exercised with a real account).
- [ ] Supabase default email sender is rate-limited and spam-prone — configure custom SMTP before real users.

### Data-loss and duplication hazards
- [x] **Import is resumable and idempotent.** Progress persists locally, Watchlist insertion already tolerates uniqueness conflicts, and migration `0002_import_idempotency.sql` adds a per-user import key enforced server-side.
- [x] **Import retains local data until refresh succeeds.** The backup/decision marker/source deletion now happen only after the authoritative state refresh completes.
- [x] **Local storage is guarded and versioned.** Legacy snapshots migrate into a versioned envelope, malformed data is preserved for recovery, quota failures surface visibly, movie cache is capped, and committed session history is bounded.
- [ ] **Double-click races**: `runConnected` guards with async React state (`operationBusy`), so two rapid clicks both pass and fire duplicate `recordRankingAnswer`/`beginRankingRecord`. Guard with a synchronous ref. Server-side, `record_ranking_answer` RPC isn't idempotent (no client answer key) — a retried network call appends a divergent answer.

## P1 — High (fix before public alpha)

### Security hardening
- [x] **Security headers added at the worker boundary:** CSP, HSTS on HTTPS, nosniff, frame denial/frame-ancestors, Referrer-Policy, and Permissions-Policy.
- [ ] **Rate limiting is per-isolate in-memory** (`lib/tmdb/limit.ts`) — resets per Cloudflare isolate, so the unauthenticated TMDB proxy has no real global cap. Back it with a durable store; trust only `cf-connecting-ip`.
- [ ] **Cache route does auth + DB lookups before any IP throttle** — JWT spam drives unbounded Supabase load. Gate earlier.
- [x] **Production metadata origin supports pinned `SITE_URL`.** The release env validator requires it to be an HTTPS origin.
- [ ] **`inherit` note visibility becomes public retroactively** the moment a profile flips public — and there is no profile-level default for it to inherit (UI says "Use profile setting", which doesn't exist). Either add the profile setting or warn at publish time.

### Correctness
- [x] Film-restore race on back/forward is guarded by a monotonic generation counter.
- [ ] `?profile=` URLs don't respond to popstate (film/view do) — back button doesn't reopen/close the profile sheet.
- [ ] `lib/seed.ts` module-level mutable `movies[]`: unbounded growth, shared across SSR requests on the worker, and `movieById` fabricates a fake "Untitled film" on a miss instead of surfacing the problem. Restructure to per-session cache + explicit miss handling.
- [ ] Client `insertionPosition` float midpoints exhaust after ~50 dense inserts (server has collision handling; client doesn't) and the server's own 1e-15 offset dead-ends eventually with no rebalance routine. Add rebalancing.
- [ ] Cross-tab storage sync is last-writer-wins with no `activeRankingRevision` monotonicity check — a stale tab can clobber a live comparison session.
- [ ] One stuck server session hard-fails the entire `loadUserState` ("could not be restored safely") — degrade to abandoning the session instead.
- [x] Local-mode `toggleWatchlist` writes through the authoritative storage path.
- [x] DNF and completed-watch controls share the same date validation.

### Accessibility
- [ ] **Import sheet now has focus trap and Escape; account menu has Escape.** Focus restoration and arrow-key roving for the account menu remain.
- [ ] Contrast audit for small text over posters (`.diary-overlay small`, `.canon-score`) against 4.5:1.
- [ ] `window.scrollTo({behavior:"smooth"})` ignores `prefers-reduced-motion` (CSS handles it; JS calls override).

### Performance
- [ ] **Full-state refetch after every mutation** (`refreshConnectedState` per comparison answer, watchlist toggle, etc.). Move to optimistic updates / delta reconciliation. This is the biggest scale ceiling.
- [ ] `canon` memo keyed on the whole `state` object — recomputes the full derived canon on any unrelated change; `visibleCanon`/`completedDiary` recompute unmemoized every render; Home recommendations + FilmDetail taste-match run `movieSimilarity` over everything per render. Re-key memos on the slices they use.
- [ ] **No image sizing anywhere**: no width/height/aspect-ratio on `<img>`, full-size TMDB URLs regardless of display size → CLS + oversized payloads. Request sized variants (w342 posters, w780 backdrops) and set intrinsic dimensions.
- [ ] O(n²) per-row lookups in Diary/Canon renders (`canon.find`, `sortDiary(filter)` inside map); no virtualization for long lists.

## P2 — Medium (production polish)

- [ ] **Error handling UX**: single global `operationError` string — errors overwrite each other, no retry affordance, no auto-dismiss; `runConnected` silently drops actions while busy. Scope errors per surface; add per-control busy states.
- [ ] Custom `error.tsx` / `global-error.tsx` / `not-found.tsx` pages (framework default renders today).
- [ ] Error monitoring (Sentry) + basic analytics — nothing exists; you're blind post-launch.
- [x] **CI added:** Node 22 is pinned and GitHub Actions runs typecheck, lint, build, and tests on pushes/PRs. Production release has a local `deploy:check` env gate; automated deploy remains intentionally disabled until hosted secrets are configured.
- [ ] Test gaps: zero coverage on `lib/supabase/data.ts` (DbRow mapping, replay logic), the core state machine (`persistSessionProgress`/`commitSession`/`answerLocal`/import), `lib/ui.ts` (`insertionPosition` float bug would've been caught). Add one Playwright E2E smoke (log → verdict → compare → rank) + unit tests for the above.
- [ ] Runtime schema validation at the RPC boundary (DbRow casts + unchecked enum casts silently coerce drift into `0`/`""`/undefined score bands) — zod or hand-rolled validators.
- [x] `committedRankingSessionIds` is capped to the most recent 200 IDs in local storage.
- [ ] Provisional placements from abandoned sessions remain visible in the canon until the session is reopened — filter or expire them.
- [ ] OG image is now referenced and manifest/robots/sitemap routes exist. Image compression and favicon/app icon assets remain.
- [ ] Unsaved log-flow note discarded on close/Escape with no confirmation.
- [ ] Legal: privacy policy + terms (storing emails + viewing history), TMDB attribution (About sheet has it — add to landing footer too), custom domain.

## P3 — Low / housekeeping

- [ ] Naming drift: `AfterCreditsApp.tsx`, `after-credits-*` localStorage keys, `0001_after_credits.sql`, `get_after_credits_state()` all predate the rename. Rename app-level identifiers; leave DB objects unless migrating.
- [x] README now documents `.env`.
- [x] `@supabase/supabase-js` is pinned exactly.
- [x] The custom Sites vite plugin is included in linting.
- [x] `worker/index.ts` is documented as the Post Credits entrypoint.
- [ ] `runWithRankingLock` (navigator.locks) releases immediately after sync work — provides no real serialization; document or remove.
- [ ] Magic constant `>= 5` in `commitSession` duplicates `MIN_CANON_SIZE_FOR_SCORES`.
- [ ] `year` defaults to current year on bad `release_date` — masks bad data.
- [ ] Decorative backdrop `<img alt="">` inconsistently `aria-hidden`; mobile bottom nav omits Watchlist (confirm intended).
- [ ] Google sign-in button can stick on "Redirecting…" if the redirect never happens.
- [ ] `movies`/`movie_palettes` tables are anonymously enumerable (TMDB metadata — fine, but confirm intended).
- [ ] Public profiles expose the full diary/canon existence (only note *text* is redacted) — likely intended; document it as a product decision.

---

**Suggested sequencing:** P0 deployment decision first (everything else hangs off it) → P0 data-safety fixes (import idempotency, storage guards, double-click refs) → auth E2E on staging → security headers + durable rate limiting → CI + Sentry + one Playwright smoke → perf pass (optimistic updates, image sizing, memo keys) → polish and legal.
