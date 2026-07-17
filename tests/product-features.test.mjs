import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL("../supabase/migrations/20260717203000_add_film_reviews.sql", import.meta.url),
  "utf8",
);
const exportSource = await readFile(new URL("../lib/export.ts", import.meta.url), "utf8");
const insightsSource = await readFile(new URL("../app/components/InsightsView.tsx", import.meta.url), "utf8");

test("film reviews are portable, bounded, and protected by row-level security", () => {
  assert.match(migration, /create table public\.reviews/i);
  assert.match(migration, /char_length\(body\) <= 50000/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /review\.visibility = 'public'/i);
  assert.match(migration, /grant select on table public\.public_reviews to anon, authenticated/i);
});

test("exports cover every durable user collection in JSON and CSV", () => {
  for (const field of ["diary", "reviews", "canon", "watchlist", "rankHistory", "comparisons"]) {
    assert.match(exportSource, new RegExp(`\\b${field}\\b`));
  }
  assert.match(exportSource, /text\/csv/i);
  assert.match(exportSource, /application\/json/i);
});

test("insights include annual, monthly, taste, and catalog breakdowns", () => {
  for (const signal of ["in review", "Films per month", "Taste drift", "Directors", "Countries", "Decades", "Genres"]) {
    assert.match(insightsSource, new RegExp(signal, "i"));
  }
});
