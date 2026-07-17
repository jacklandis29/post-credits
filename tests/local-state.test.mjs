import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/local-state.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const localState = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
);

const empty = { diary: [], ranked: [], watchlist: [], movieCache: [], committedRankingSessionIds: [] };

test("migrates legacy local snapshots into the versioned format", () => {
  const parsed = localState.parseLocalState(JSON.stringify(empty));
  assert.deepEqual(parsed.diary, []);
  const serialized = JSON.parse(localState.serializeLocalState(parsed));
  assert.equal(serialized.version, 1);
});

test("bounds caches and committed-session history", () => {
  const compacted = localState.compactLocalState({
    ...empty,
    movieCache: Array.from({ length: 400 }, (_, id) => ({ id })),
    committedRankingSessionIds: Array.from({ length: 300 }, (_, id) => String(id)),
  });
  assert.equal(compacted.movieCache.length, 250);
  assert.equal(compacted.committedRankingSessionIds.length, 200);
  assert.equal(compacted.committedRankingSessionIds[0], "100");
});

test("reports quota failures without destroying the current state", () => {
  const storage = { setItem() { throw new DOMException("full", "QuotaExceededError"); } };
  const result = localState.safelyWriteLocalState(storage, "key", empty);
  assert.match(result.error, /out of storage space/i);
  assert.deepEqual(result.state.diary, []);
});

test("rejects malformed nested local snapshots", () => {
  const malformedDiary = {
    ...empty,
    diary: [{ movieId: "not-a-number" }],
  };
  assert.equal(localState.parseLocalState(JSON.stringify(malformedDiary)), null);

  const malformedMovie = {
    ...empty,
    movieCache: [{ id: 1, title: "Missing required fields" }],
  };
  assert.equal(localState.parseLocalState(JSON.stringify(malformedMovie)), null);
  assert.equal(localState.parseLocalState("{not json"), null);
});

test("round-trips likes, favorites, spoiler flags, and diary tags", () => {
  const state = {
    ...empty,
    likedMovieIds: [42],
    favorites: [{ movieId: 42, position: 1, addedAt: "2026-07-17T12:00:00.000Z" }],
    diary: [{
      id: "watch-42",
      movieId: 42,
      watchedOn: "2026-07-17",
      note: "The ending works.",
      containsSpoilers: true,
      tags: ["with-mom", "summer-marathon"],
      visibility: "private",
      completionStatus: "completed",
      rankingStatus: "complete",
      isRewatch: false,
      createdAt: "2026-07-17T12:00:00.000Z",
    }],
  };
  const parsed = localState.parseLocalState(localState.serializeLocalState(state));
  assert.deepEqual(parsed.likedMovieIds, [42]);
  assert.equal(parsed.favorites[0].position, 1);
  assert.equal(parsed.diary[0].containsSpoilers, true);
  assert.deepEqual(parsed.diary[0].tags, ["with-mom", "summer-marathon"]);
});
