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
