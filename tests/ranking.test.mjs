import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Keep the production module as native TypeScript while letting this focused
// suite run directly under `node --test` without adding a package script/loader.
const source = await readFile(
  new URL("../lib/ranking.ts", import.meta.url),
  "utf8",
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
assert.deepEqual(
  transpiled.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  ),
  [],
);
const ranking = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`
);

const {
  acceptCurrentPlacement,
  answerComparison,
  comparisonEventDrafts,
  computeRankedCanon,
  currentPlacementRank,
  deriveScore,
  formatScore,
  getNextComparison,
  globalRankFor,
  insertAtPlacement,
  startRanking,
  undoLastAnswer,
} = ranking;

function candidates(count, similarities = {}) {
  return Array.from({ length: count }, (_, index) => ({
    movieId: `film-${index}`,
    similarity: similarities[index] ?? 0,
  }));
}

function answerNext(session, outcome) {
  const next = getNextComparison(session);
  assert.ok(next, "expected another comparator");
  return answerComparison(session, {
    comparatorId: next.comparatorId,
    outcome,
  });
}

test("derived scores stay inside their fixed verdict bands", () => {
  assert.equal(deriveScore("liked", 1, 4), 10);
  assert.equal(deriveScore("liked", 4, 4), 7);
  assert.equal(deriveScore("fine", 1, 4), 6.9);
  assert.equal(deriveScore("fine", 4, 4), 4);
  assert.equal(deriveScore("disliked", 1, 4), 3.9);
  assert.equal(deriveScore("disliked", 4, 4), 0);

  assert.equal(deriveScore("liked", 1, 1), 8.5);
  assert.equal(deriveScore("fine", 1, 1), 5.5);
  assert.equal(deriveScore("disliked", 1, 1), 2);
  assert.equal(formatScore(7), "7.0");
  assert.equal(formatScore(null), null);
});

test("canon ranks are deterministic across verdict bands and hide early scores", () => {
  const early = computeRankedCanon({
    liked: ["a", "b"],
    fine: ["c"],
    disliked: ["d"],
  });
  assert.deepEqual(
    early.map(({ movieId, globalRank, score }) => ({
      movieId,
      globalRank,
      score,
    })),
    [
      { movieId: "a", globalRank: 1, score: null },
      { movieId: "b", globalRank: 2, score: null },
      { movieId: "c", globalRank: 3, score: null },
      { movieId: "d", globalRank: 4, score: null },
    ],
  );

  const eligible = computeRankedCanon({
    liked: ["a", "b"],
    fine: ["c", "e"],
    disliked: ["d"],
  });
  assert.deepEqual(
    eligible.map(({ movieId, globalRank, score }) => ({
      movieId,
      globalRank,
      score,
    })),
    [
      { movieId: "a", globalRank: 1, score: 10 },
      { movieId: "b", globalRank: 2, score: 7 },
      { movieId: "c", globalRank: 3, score: 6.9 },
      { movieId: "e", globalRank: 4, score: 4 },
      { movieId: "d", globalRank: 5, score: 2 },
    ],
  );
  assert.equal(
    globalRankFor("disliked", 1, { liked: 2, fine: 2, disliked: 1 }),
    5,
  );
  assert.throws(
    () =>
      computeRankedCanon({
        liked: ["duplicate"],
        fine: ["duplicate"],
        disliked: [],
      }),
    /Duplicate canon placement/,
  );
});

test("the first film is exact rank one with no comparison", () => {
  const session = startRanking({
    movieId: "new-film",
    verdict: "liked",
    candidates: [],
  });

  assert.equal(session.status, "complete");
  assert.equal(session.completionReason, "empty_bucket");
  assert.equal(session.placementConfidence, "exact");
  assert.deepEqual(session.bounds, { lower: 0, upper: 0 });
  assert.equal(currentPlacementRank(session), 1);
  assert.equal(getNextComparison(session), null);
});

test("binary answers narrow inclusive insertion bounds to an exact slot", () => {
  let session = startRanking({
    movieId: "new-film",
    verdict: "liked",
    candidates: candidates(3),
  });

  assert.deepEqual(session.bounds, { lower: 0, upper: 3 });
  assert.equal(session.placementIndex, 1);
  assert.equal(getNextComparison(session).comparatorIndex, 1);

  session = answerNext(session, "new_wins");
  assert.deepEqual(session.bounds, { lower: 0, upper: 1 });
  assert.equal(session.status, "comparing");

  session = answerNext(session, "existing_wins");
  assert.deepEqual(session.bounds, { lower: 1, upper: 1 });
  assert.equal(session.status, "complete");
  assert.equal(session.completionReason, "exact");
  assert.equal(session.placementConfidence, "exact");
  assert.equal(currentPlacementRank(session), 2);
  assert.deepEqual(
    insertAtPlacement(
      candidates(3).map(({ movieId }) => movieId),
      "new-film",
      session.placementIndex,
    ),
    ["film-0", "new-film", "film-1", "film-2"],
  );
});

test("similarity only breaks equal-information comparator ties", () => {
  const session = startRanking({
    movieId: "new-film",
    verdict: "fine",
    candidates: candidates(4, { 1: 0.2, 2: 0.9 }),
  });

  // Indices 1 and 2 have the same worst-case split for five insertion slots.
  assert.deepEqual(getNextComparison(session), {
    comparatorId: "film-2",
    comparatorIndex: 2,
    similarity: 0.9,
  });
});

test("five decisive answers stop at a deterministic provisional midpoint", () => {
  let session = startRanking({
    movieId: "new-film",
    verdict: "liked",
    candidates: candidates(100),
  });

  for (let answer = 0; answer < 5; answer += 1) {
    session = answerNext(session, "existing_wins");
  }

  assert.equal(session.status, "complete");
  assert.equal(session.completionReason, "decisive_limit");
  assert.equal(session.decisiveAnswers, 5);
  assert.equal(session.skips, 0);
  assert.equal(session.placementConfidence, "provisional");
  assert.ok(session.bounds.lower < session.bounds.upper);
  assert.equal(
    session.placementIndex,
    Math.floor((session.bounds.lower + session.bounds.upper) / 2),
  );
  assert.equal(getNextComparison(session), null);
});

test("skips add no ordering information and the second skip ends provisionally", () => {
  let session = startRanking({
    movieId: "new-film",
    verdict: "fine",
    candidates: candidates(8),
  });
  const originalBounds = session.bounds;
  const firstComparator = getNextComparison(session).comparatorId;

  session = answerNext(session, "too_close");
  assert.deepEqual(session.bounds, originalBounds);
  assert.equal(session.decisiveAnswers, 0);
  assert.equal(session.skips, 1);
  assert.notEqual(getNextComparison(session).comparatorId, firstComparator);

  session = answerNext(session, "too_close");
  assert.equal(session.status, "complete");
  assert.equal(session.completionReason, "skip_limit");
  assert.equal(session.decisiveAnswers, 0);
  assert.equal(session.skips, 2);
  assert.equal(session.placementConfidence, "provisional");
});

test("one skip ends a one-comparator session when no unused option remains", () => {
  let session = startRanking({
    movieId: "new-film",
    verdict: "disliked",
    candidates: candidates(1),
  });
  session = answerNext(session, "too_close");

  assert.equal(session.status, "complete");
  assert.equal(session.completionReason, "no_comparator");
  assert.equal(session.skips, 1);
  assert.equal(session.decisiveAnswers, 0);
  assert.deepEqual(session.bounds, { lower: 0, upper: 1 });
});

test("Undo restores exact snapshots repeatedly, including from a stop state", () => {
  const initial = startRanking({
    movieId: "new-film",
    verdict: "liked",
    candidates: candidates(8),
  });
  let session = answerNext(initial, "new_wins");
  const afterDecisive = session;
  session = answerNext(session, "too_close");
  session = answerNext(session, "too_close");
  assert.equal(session.status, "complete");

  session = undoLastAnswer(session);
  assert.equal(session.status, "comparing");
  assert.equal(session.skips, 1);
  session = undoLastAnswer(session);
  assert.deepEqual(session.bounds, afterDecisive.bounds);
  assert.equal(session.decisiveAnswers, 1);
  assert.equal(session.skips, 0);
  session = undoLastAnswer(session);
  assert.deepEqual(session, initial);
  assert.strictEqual(undoLastAnswer(session), session);
});

test("stale answers are rejected and accepting commits the midpoint", () => {
  let session = startRanking({
    movieId: "new-film",
    verdict: "fine",
    candidates: candidates(6),
  });
  assert.throws(
    () =>
      answerComparison(session, {
        comparatorId: "not-the-current-comparator",
        outcome: "new_wins",
      }),
    /Stale comparator/,
  );

  session = acceptCurrentPlacement(session);
  assert.equal(session.status, "complete");
  assert.equal(session.completionReason, "accepted");
  assert.equal(session.placementConfidence, "provisional");
  assert.deepEqual(comparisonEventDrafts(session), []);
  assert.strictEqual(undoLastAnswer(session), session);
});

test("only surviving decisive answers become immutable event drafts", () => {
  let session = startRanking({
    movieId: "new-film",
    verdict: "liked",
    candidates: candidates(8),
  });
  session = answerNext(session, "new_wins");
  session = answerNext(session, "too_close");
  session = undoLastAnswer(session);
  session = answerNext(session, "existing_wins");
  session = acceptCurrentPlacement(session);

  const events = comparisonEventDrafts(session);
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map(({ sequence, outcome }) => ({ sequence, outcome })),
    [
      { sequence: 1, outcome: "new_wins" },
      { sequence: 2, outcome: "existing_wins" },
    ],
  );
  assert.ok(events.every((event) => event.existingMovieId !== undefined));
});
