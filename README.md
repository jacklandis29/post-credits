# Post Credits

Post Credits is a film diary with comparison-based ranking.

This repository currently contains a working private alpha:

- Home, Diary, Ranking, Watchlist, People, Profile, and film-detail surfaces
- New-watch, rewatch, DNF, verdict, bounded comparison, skip, Undo, accept-placement, and manual re-rank flows
- Deterministic verdict-banded scores and a pure, tested ranking engine
- Crash-aware UI state: the watch entry is created before ranking, and a provisional placement exists as soon as a verdict is chosen
- Responsive behavior down to 320 px, keyboard-focus treatment, missing-art fallbacks, and reduced-motion support
- Live TMDB title search plus selected-film detail and credits lookup, all proxied server-side
- Debounced queries, bounded 429 retry behavior, per-caller request budgets, and server-side TMDB concurrency limits
- Supabase email/Google authentication, profile setup, persistence adapters, transaction functions, RLS policies, and security-oriented documentation

## Structure

- `app/AfterCreditsApp.tsx` — application core: state machine, persistence orchestration, and shell
- `app/components/` — presentational views (Home, Diary, Ranking, Watchlist, Search, Profile, Landing), the log/ranking flow, film detail, and sheets
- `app/globals.css` — the design system: OLED-black chrome, Fraunces display serif, per-film palette tinting
- `lib/ranking.ts` — pure, tested comparison-ranking engine
- `lib/ui.ts` — shared canon/diary helpers
- `lib/supabase/` — auth-aware persistence layer; `app/api/tmdb/` — server-side TMDB proxy

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

With Supabase configured, the public site and TMDB browsing remain visible while personal diary data and write actions require authentication. Signed-in data uses Supabase as its source of truth. If the public Supabase variables are omitted, the app runs in an explicit local-only fallback mode.

## TMDB

Copy `.env.example` to `.env` and set either:

```bash
TMDB_API_TOKEN=your_read_access_token
```

or:

```bash
TMDB_API_KEY=your_api_key
```

Credentials remain server-side. Search results are fetched from TMDB, and selecting a result performs a second lookup for runtime, director, genres, cast, keywords, overview, and artwork. Cache writes accept only a TMDB ID from the browser and re-fetch authoritative metadata on the server.

## Supabase

The initial migration lives at `supabase/migrations/0001_after_credits.sql`. Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The server-only authoritative movie-cache writer also requires `SUPABASE_SECRET_KEY` (recommended) or the legacy `SUPABASE_SERVICE_ROLE_KEY`; neither may use a `NEXT_PUBLIC_` prefix.

The configured project must have the migration applied before authentication and persistence can load. See `supabase/README.md` for setup and verification.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
node --test tests/*.test.mjs
```

The ranking suite covers score bands, deterministic global rank, bounded binary insertion, similarity tie-breaking, the five-answer ceiling, skips, repeated Undo, accepted provisional placements, and immutable comparison-event drafts.

## Product source

The full product requirements and release sequencing are in [`PRD.md`](./PRD.md). The UI uses live TMDB artwork and metadata, while authentication and hosted persistence are wired through Supabase.

Film data and artwork are provided by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
