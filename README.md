# Post Credits

Post Credits is a personal film diary built around comparison instead of star ratings.

Log a film, choose a broad verdict, then answer a short run of head-to-head questions. The app places the film in your personal canon and derives a score from that position. Rewatches add to the diary without duplicating the film in the ranking; unfinished films remain diary entries but stay outside the canon.

## Stack

- Next.js App Router, React, and TypeScript
- Vinext and Cloudflare Workers
- Supabase Auth and Postgres with row-level security
- TMDB for film metadata and artwork

## Local development

Post Credits requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000). Supabase is optional for local development; without it, the app uses browser storage. TMDB credentials are required for live film search.

Use either a TMDB read-access token or API key:

```bash
TMDB_API_TOKEN=
# or
TMDB_API_KEY=
```

For hosted accounts and persistence, add the Supabase values documented in [.env.example](./.env.example) and apply the migrations in [`supabase/migrations`](./supabase/migrations).

## Useful commands

```bash
npm run typecheck
npm run lint
npm test
npm run deploy:check
```

`npm test` builds the Worker bundle before running the Node test suite. The tests cover the ranking algorithm, local-state migration and validation, security headers, request limits, authentication templates, and the server-rendered application shell.

## Repository layout

- `app/` — routes, application shell, and UI
- `lib/ranking.ts` — deterministic comparison-ranking engine
- `lib/supabase/` — authenticated persistence layer
- `lib/server/` — request parsing, logging, and response security
- `worker/` — Cloudflare Worker entry point
- `supabase/` — schema migrations and operational setup notes
- `tests/` — domain, rendering, and security tests

## Data and privacy

Personal records are owner-scoped in Postgres. Public profiles read through restricted views rather than exposing base tables, and note visibility defaults to private. TMDB and Supabase administrative credentials are used only by server routes.

Film data and artwork are provided by TMDB. Post Credits uses the TMDB API but is not endorsed or certified by TMDB.
