/**
 * Pure domain logic for the After Credits canon.
 *
 * Ranking sessions use zero-based insertion slots. For a bucket containing N
 * existing films there are N + 1 possible slots, numbered 0 through N. Both
 * bounds are inclusive, so `{ lower: 0, upper: N }` is the initial interval.
 * Arrays passed to this module are always ordered best-to-worst.
 */

export const VERDICT_ORDER = ["liked", "fine", "disliked"] as const;

export type Verdict = (typeof VERDICT_ORDER)[number];

export const MAX_DECISIVE_ANSWERS = 5;
export const MAX_SKIPS = 2;
export const MIN_CANON_SIZE_FOR_SCORES = 5;

export interface ScoreBand {
  readonly min: number;
  readonly max: number;
  readonly midpoint: number;
}

export const SCORE_BANDS: Readonly<Record<Verdict, ScoreBand>> = {
  liked: { min: 7, max: 10, midpoint: 8.5 },
  fine: { min: 4, max: 6.9, midpoint: 5.5 },
  disliked: { min: 0, max: 3.9, midpoint: 2 },
};

export type BucketSizes = Readonly<Record<Verdict, number>>;

export interface CanonBuckets {
  readonly liked: readonly string[];
  readonly fine: readonly string[];
  readonly disliked: readonly string[];
}

export interface RankedCanonFilm {
  readonly movieId: string;
  readonly verdict: Verdict;
  readonly withinBucketRank: number;
  readonly globalRank: number;
  /** Null until the canon contains at least five ranked films. */
  readonly score: number | null;
}

export interface ComparisonCandidateInput {
  readonly movieId: string;
  /**
   * Optional caller-computed similarity to the new film. It is only used to
   * break ties between comparators with equal information gain.
   */
  readonly similarity?: number;
}

export interface ComparisonCandidate {
  readonly movieId: string;
  readonly similarity: number;
}

export interface InsertionBounds {
  /** Best possible zero-based insertion slot, inclusive. */
  readonly lower: number;
  /** Worst possible zero-based insertion slot, inclusive. */
  readonly upper: number;
}

export type ComparisonOutcome =
  | "new_wins"
  | "existing_wins"
  | "too_close";

export type SessionStatus = "comparing" | "complete";
export type PlacementConfidence = "exact" | "provisional";
export type CompletionReason =
  | "empty_bucket"
  | "exact"
  | "decisive_limit"
  | "skip_limit"
  | "no_comparator"
  | "accepted";

export interface MutableRankingAnswer {
  readonly comparatorId: string;
  readonly comparatorIndex: number;
  readonly outcome: ComparisonOutcome;
  readonly boundsBefore: InsertionBounds;
  readonly boundsAfter: InsertionBounds;
}

/** A non-recursive snapshot saved immediately before each mutable answer. */
export interface RankingSnapshot {
  readonly bounds: InsertionBounds;
  readonly placementIndex: number;
  readonly decisiveAnswers: number;
  readonly skips: number;
  readonly usedComparatorIds: readonly string[];
  readonly answers: readonly MutableRankingAnswer[];
  readonly status: SessionStatus;
  readonly placementConfidence: PlacementConfidence;
  readonly completionReason: CompletionReason | null;
}

export interface RankingSession {
  readonly movieId: string;
  readonly verdict: Verdict;
  /** Existing films in this verdict bucket, ordered best-to-worst. */
  readonly candidates: readonly ComparisonCandidate[];
  readonly bounds: InsertionBounds;
  /** Current zero-based midpoint placement within `bounds`. */
  readonly placementIndex: number;
  readonly decisiveAnswers: number;
  readonly skips: number;
  readonly usedComparatorIds: readonly string[];
  /** Mutable answers that would be committed if this session finishes now. */
  readonly answers: readonly MutableRankingAnswer[];
  readonly snapshots: readonly RankingSnapshot[];
  readonly status: SessionStatus;
  readonly placementConfidence: PlacementConfidence;
  readonly completionReason: CompletionReason | null;
}

export interface StartRankingInput {
  readonly movieId: string;
  readonly verdict: Verdict;
  /** Existing films in the selected verdict bucket, best-to-worst. */
  readonly candidates: readonly ComparisonCandidateInput[];
}

export interface NextComparison {
  readonly comparatorId: string;
  readonly comparatorIndex: number;
  readonly similarity: number;
}

export interface AnswerComparisonInput {
  readonly comparatorId: string;
  readonly outcome: ComparisonOutcome;
}

export interface ComparisonEventDraft {
  readonly sequence: number;
  readonly newMovieId: string;
  readonly existingMovieId: string;
  readonly verdict: Verdict;
  readonly outcome: "new_wins" | "existing_wins";
  readonly winnerId: string;
}

function assertVerdict(verdict: Verdict): void {
  if (!VERDICT_ORDER.includes(verdict)) {
    throw new RangeError(`Unknown verdict: ${String(verdict)}`);
  }
}

function assertNonEmptyId(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertInteger(value: number, name: string, minimum: number): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}`);
  }
}

function assertBucketSizes(bucketSizes: BucketSizes): void {
  for (const verdict of VERDICT_ORDER) {
    assertInteger(bucketSizes[verdict], `${verdict} bucket size`, 0);
  }
}

function midpoint(bounds: InsertionBounds): number {
  return Math.floor((bounds.lower + bounds.upper) / 2);
}

function copyBounds(bounds: InsertionBounds): InsertionBounds {
  return { lower: bounds.lower, upper: bounds.upper };
}

function roundToOneDecimal(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/** Calculate the fixed-band score for a one-based rank inside one bucket. */
export function deriveScore(
  verdict: Verdict,
  withinBucketRank: number,
  bucketSize: number,
): number {
  assertVerdict(verdict);
  assertInteger(bucketSize, "bucketSize", 1);
  assertInteger(withinBucketRank, "withinBucketRank", 1);

  if (withinBucketRank > bucketSize) {
    throw new RangeError("withinBucketRank cannot exceed bucketSize");
  }

  const band = SCORE_BANDS[verdict];
  if (bucketSize === 1) return band.midpoint;

  const percentile = (bucketSize - withinBucketRank) / (bucketSize - 1);
  return roundToOneDecimal(band.min + (band.max - band.min) * percentile);
}

/** Format a derived score for UI without losing the required trailing decimal. */
export function formatScore(score: number | null): string | null {
  if (score === null) return null;
  if (!Number.isFinite(score)) {
    throw new TypeError("score must be finite or null");
  }
  return score.toFixed(1);
}

/** Resolve a film's one-based rank in the complete, verdict-banded canon. */
export function globalRankFor(
  verdict: Verdict,
  withinBucketRank: number,
  bucketSizes: BucketSizes,
): number {
  assertVerdict(verdict);
  assertBucketSizes(bucketSizes);
  assertInteger(withinBucketRank, "withinBucketRank", 1);

  if (withinBucketRank > bucketSizes[verdict]) {
    throw new RangeError("withinBucketRank cannot exceed its verdict bucket size");
  }

  let precedingFilms = 0;
  for (const currentVerdict of VERDICT_ORDER) {
    if (currentVerdict === verdict) break;
    precedingFilms += bucketSizes[currentVerdict];
  }
  return precedingFilms + withinBucketRank;
}

/**
 * Flatten pre-ordered verdict buckets into one deterministic canon. Duplicate
 * movie IDs are rejected because a movie may have only one active placement.
 */
export function computeRankedCanon(
  buckets: CanonBuckets,
): readonly RankedCanonFilm[] {
  const bucketSizes: BucketSizes = {
    liked: buckets.liked.length,
    fine: buckets.fine.length,
    disliked: buckets.disliked.length,
  };
  const totalFilms =
    bucketSizes.liked + bucketSizes.fine + bucketSizes.disliked;
  const scoresAreEligible = totalFilms >= MIN_CANON_SIZE_FOR_SCORES;
  const seen = new Set<string>();
  const result: RankedCanonFilm[] = [];

  for (const verdict of VERDICT_ORDER) {
    buckets[verdict].forEach((movieId, index) => {
      assertNonEmptyId(movieId, "movieId");
      if (seen.has(movieId)) {
        throw new Error(`Duplicate canon placement for movie ${movieId}`);
      }
      seen.add(movieId);

      const withinBucketRank = index + 1;
      result.push({
        movieId,
        verdict,
        withinBucketRank,
        globalRank: globalRankFor(verdict, withinBucketRank, bucketSizes),
        score: scoresAreEligible
          ? deriveScore(verdict, withinBucketRank, bucketSizes[verdict])
          : null,
      });
    });
  }

  return result;
}

/** Return a new best-to-worst bucket with the movie inserted at a session slot. */
export function insertAtPlacement(
  orderedMovieIds: readonly string[],
  movieId: string,
  placementIndex: number,
): readonly string[] {
  assertNonEmptyId(movieId, "movieId");
  assertInteger(placementIndex, "placementIndex", 0);
  if (placementIndex > orderedMovieIds.length) {
    throw new RangeError("placementIndex cannot exceed the bucket length");
  }
  if (orderedMovieIds.includes(movieId)) {
    throw new Error(`Movie ${movieId} already has a placement in this bucket`);
  }

  return [
    ...orderedMovieIds.slice(0, placementIndex),
    movieId,
    ...orderedMovieIds.slice(placementIndex),
  ];
}

/** Create a resumable session with an immediate provisional midpoint placement. */
export function startRanking(input: StartRankingInput): RankingSession {
  assertNonEmptyId(input.movieId, "movieId");
  assertVerdict(input.verdict);

  const seen = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    assertNonEmptyId(candidate.movieId, "candidate movieId");
    if (candidate.movieId === input.movieId) {
      throw new Error("The movie being ranked cannot compare against itself");
    }
    if (seen.has(candidate.movieId)) {
      throw new Error(`Duplicate comparison candidate ${candidate.movieId}`);
    }
    seen.add(candidate.movieId);

    const similarity = candidate.similarity ?? 0;
    if (!Number.isFinite(similarity)) {
      throw new TypeError("candidate similarity must be finite");
    }
    return { movieId: candidate.movieId, similarity };
  });

  const bounds: InsertionBounds = { lower: 0, upper: candidates.length };
  const emptyBucket = candidates.length === 0;

  return {
    movieId: input.movieId,
    verdict: input.verdict,
    candidates,
    bounds,
    placementIndex: midpoint(bounds),
    decisiveAnswers: 0,
    skips: 0,
    usedComparatorIds: [],
    answers: [],
    snapshots: [],
    status: emptyBucket ? "complete" : "comparing",
    placementConfidence: emptyBucket ? "exact" : "provisional",
    completionReason: emptyBucket ? "empty_bucket" : null,
  };
}

/**
 * Pick the unused comparator with the best worst-case split. Similarity breaks
 * equal-information ties, then the better-ranked index makes the result stable.
 */
export function getNextComparison(
  session: RankingSession,
): NextComparison | null {
  if (session.status !== "comparing" || session.bounds.lower === session.bounds.upper) {
    return null;
  }

  const used = new Set(session.usedComparatorIds);
  const choices: Array<NextComparison & { informationCost: number }> = [];

  for (
    let comparatorIndex = session.bounds.lower;
    comparatorIndex < session.bounds.upper;
    comparatorIndex += 1
  ) {
    const candidate = session.candidates[comparatorIndex];
    if (!candidate || used.has(candidate.movieId)) continue;

    const positionsIfNewWins = comparatorIndex - session.bounds.lower + 1;
    const positionsIfExistingWins = session.bounds.upper - comparatorIndex;
    choices.push({
      comparatorId: candidate.movieId,
      comparatorIndex,
      similarity: candidate.similarity,
      informationCost: Math.max(positionsIfNewWins, positionsIfExistingWins),
    });
  }

  choices.sort(
    (left, right) =>
      left.informationCost - right.informationCost ||
      right.similarity - left.similarity ||
      left.comparatorIndex - right.comparatorIndex,
  );

  const choice = choices[0];
  if (!choice) return null;
  return {
    comparatorId: choice.comparatorId,
    comparatorIndex: choice.comparatorIndex,
    similarity: choice.similarity,
  };
}

function snapshotOf(session: RankingSession): RankingSnapshot {
  return {
    bounds: copyBounds(session.bounds),
    placementIndex: session.placementIndex,
    decisiveAnswers: session.decisiveAnswers,
    skips: session.skips,
    usedComparatorIds: [...session.usedComparatorIds],
    answers: [...session.answers],
    status: session.status,
    placementConfidence: session.placementConfidence,
    completionReason: session.completionReason,
  };
}

/** Apply one comparison or skip and return the complete persisted session state. */
export function answerComparison(
  session: RankingSession,
  input: AnswerComparisonInput,
): RankingSession {
  if (session.status !== "comparing") {
    throw new Error("This ranking session is not accepting comparisons");
  }
  if (
    input.outcome !== "new_wins" &&
    input.outcome !== "existing_wins" &&
    input.outcome !== "too_close"
  ) {
    throw new RangeError(`Unknown comparison outcome: ${String(input.outcome)}`);
  }

  const comparison = getNextComparison(session);
  if (!comparison) {
    throw new Error("No unused comparator remains in the unresolved interval");
  }
  if (comparison.comparatorId !== input.comparatorId) {
    throw new Error(
      `Stale comparator ${input.comparatorId}; expected ${comparison.comparatorId}`,
    );
  }

  const boundsBefore = copyBounds(session.bounds);
  let boundsAfter = copyBounds(session.bounds);
  let decisiveAnswers = session.decisiveAnswers;
  let skips = session.skips;

  if (input.outcome === "new_wins") {
    boundsAfter = {
      lower: session.bounds.lower,
      upper: comparison.comparatorIndex,
    };
    decisiveAnswers += 1;
  } else if (input.outcome === "existing_wins") {
    boundsAfter = {
      lower: comparison.comparatorIndex + 1,
      upper: session.bounds.upper,
    };
    decisiveAnswers += 1;
  } else {
    skips += 1;
  }

  const answer: MutableRankingAnswer = {
    comparatorId: comparison.comparatorId,
    comparatorIndex: comparison.comparatorIndex,
    outcome: input.outcome,
    boundsBefore,
    boundsAfter: copyBounds(boundsAfter),
  };

  let updated: RankingSession = {
    ...session,
    bounds: boundsAfter,
    placementIndex: midpoint(boundsAfter),
    decisiveAnswers,
    skips,
    usedComparatorIds: [
      ...session.usedComparatorIds,
      comparison.comparatorId,
    ],
    answers: [...session.answers, answer],
    snapshots: [...session.snapshots, snapshotOf(session)],
    status: "comparing",
    placementConfidence:
      boundsAfter.lower === boundsAfter.upper ? "exact" : "provisional",
    completionReason: null,
  };

  let completionReason: CompletionReason | null = null;
  if (boundsAfter.lower === boundsAfter.upper) {
    completionReason = "exact";
  } else if (decisiveAnswers >= MAX_DECISIVE_ANSWERS) {
    completionReason = "decisive_limit";
  } else if (skips >= MAX_SKIPS) {
    completionReason = "skip_limit";
  } else if (getNextComparison(updated) === null) {
    completionReason = "no_comparator";
  }

  if (completionReason) {
    updated = {
      ...updated,
      status: "complete",
      placementConfidence:
        boundsAfter.lower === boundsAfter.upper ? "exact" : "provisional",
      completionReason,
    };
  }

  return updated;
}

/**
 * Remove the most recent mutable answer and restore its exact pre-answer state.
 * Calling Undo at the start is a harmless no-op. An accepted placement is
 * already a commit boundary and therefore cannot be undone here.
 */
export function undoLastAnswer(session: RankingSession): RankingSession {
  if (session.completionReason === "accepted" || session.snapshots.length === 0) {
    return session;
  }

  const snapshot = session.snapshots[session.snapshots.length - 1];
  return {
    ...session,
    bounds: copyBounds(snapshot.bounds),
    placementIndex: snapshot.placementIndex,
    decisiveAnswers: snapshot.decisiveAnswers,
    skips: snapshot.skips,
    usedComparatorIds: [...snapshot.usedComparatorIds],
    answers: [...snapshot.answers],
    snapshots: session.snapshots.slice(0, -1),
    status: snapshot.status,
    placementConfidence: snapshot.placementConfidence,
    completionReason: snapshot.completionReason,
  };
}

/** Finish immediately at the current midpoint, as “Accept this placement.” */
export function acceptCurrentPlacement(
  session: RankingSession,
): RankingSession {
  if (session.status === "complete") return session;

  return {
    ...session,
    status: "complete",
    placementConfidence:
      session.bounds.lower === session.bounds.upper ? "exact" : "provisional",
    completionReason: "accepted",
  };
}

/** One-based rank for display or persistence next to the zero-based slot. */
export function currentPlacementRank(session: RankingSession): number {
  return session.placementIndex + 1;
}

/**
 * Create only the decisive immutable events for a completed session. Skips and
 * answers removed by Undo are intentionally absent.
 */
export function comparisonEventDrafts(
  session: RankingSession,
): readonly ComparisonEventDraft[] {
  if (session.status !== "complete") {
    throw new Error("Comparison events may only be created for a completed session");
  }

  return session.answers
    .filter(
      (answer): answer is MutableRankingAnswer & {
        outcome: "new_wins" | "existing_wins";
      } => answer.outcome !== "too_close",
    )
    .map((answer, index) => ({
      sequence: index + 1,
      newMovieId: session.movieId,
      existingMovieId: answer.comparatorId,
      verdict: session.verdict,
      outcome: answer.outcome,
      winnerId:
        answer.outcome === "new_wins" ? session.movieId : answer.comparatorId,
    }));
}
