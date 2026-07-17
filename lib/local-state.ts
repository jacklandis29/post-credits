import type { AppState, Movie } from "./types";

const LOCAL_STATE_VERSION = 1;
const MAX_CACHED_MOVIES = 250;
const MAX_COMMITTED_SESSION_IDS = 200;

type StoredState = {
  version: typeof LOCAL_STATE_VERSION;
  state: AppState;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown, minimum = 0): value is number {
  return Number.isInteger(value) && (value as number) >= minimum;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(string);
}

function optional(value: unknown, validator: (candidate: unknown) => boolean): boolean {
  return value === undefined || validator(value);
}

function nullable(value: unknown, validator: (candidate: unknown) => boolean): boolean {
  return value === null || validator(value);
}

const verdicts = new Set(["liked", "fine", "disliked"]);
const noteVisibilities = new Set(["inherit", "private", "public"]);
const completionStatuses = new Set(["completed", "dnf"]);
const rankingStatuses = new Set(["pending", "in_progress", "complete", "not_applicable"]);
const placementConfidences = new Set(["exact", "provisional"]);

function enumValue(value: unknown, values: Set<string>): value is string {
  return string(value) && values.has(value);
}

function validMovie(value: unknown): boolean {
  const movie = record(value);
  const palette = record(movie?.palette);
  if (!movie || !palette) return false;
  return (
    integer(movie.id, 1) &&
    string(movie.title) &&
    integer(movie.year, 0) &&
    (movie.runtime === null || integer(movie.runtime, 1)) &&
    string(movie.director) &&
    stringArray(movie.genres) &&
    nullable(movie.poster, string) &&
    nullable(movie.backdrop, string) &&
    string(movie.overview) &&
    string(palette.dominant) &&
    string(palette.secondary) &&
    string(palette.accent) &&
    optional(movie.originalTitle, string) &&
    optional(movie.releaseDate, string) &&
    optional(movie.cast, stringArray) &&
    optional(movie.keywords, stringArray) &&
    optional(movie.originalLanguage, (candidate) => nullable(candidate, string)) &&
    optional(movie.productionCountries, stringArray) &&
    optional(movie.tagline, (candidate) => nullable(candidate, string)) &&
    optional(movie.trailerUrl, (candidate) => nullable(candidate, string)) &&
    optional(movie.imdbId, (candidate) => nullable(candidate, string)) &&
    optional(movie.credits, (candidate) => Array.isArray(candidate) && candidate.every((item) => {
      const credit = record(item);
      return Boolean(
        credit &&
        string(credit.name) &&
        nullable(credit.character, string) &&
        nullable(credit.profile, string),
      );
    }))
  );
}

function validDiaryEntry(value: unknown): boolean {
  const entry = record(value);
  return Boolean(
    entry &&
    string(entry.id) &&
    integer(entry.movieId, 1) &&
    string(entry.watchedOn) &&
    string(entry.note) &&
    enumValue(entry.visibility, noteVisibilities) &&
    enumValue(entry.completionStatus, completionStatuses) &&
    enumValue(entry.rankingStatus, rankingStatuses) &&
    typeof entry.isRewatch === "boolean" &&
    string(entry.createdAt),
  );
}

function validRankedFilm(value: unknown): boolean {
  const film = record(value);
  return Boolean(
    film &&
    integer(film.movieId, 1) &&
    enumValue(film.verdict, verdicts) &&
    finiteNumber(film.sortPosition) &&
    enumValue(film.placementConfidence, placementConfidences) &&
    integer(film.comparisonCount) &&
    string(film.firstRankedAt) &&
    string(film.lastRankedAt),
  );
}

function validWatchlistItem(value: unknown): boolean {
  const item = record(value);
  return Boolean(item && integer(item.movieId, 1) && string(item.addedAt));
}

function validComparison(value: unknown): boolean {
  const comparison = record(value);
  return Boolean(
    comparison &&
    string(comparison.id) &&
    string(comparison.sessionId) &&
    integer(comparison.sessionMovieId, 1) &&
    integer(comparison.opponentMovieId, 1) &&
    nullable(comparison.winnerMovieId, (candidate) => integer(candidate, 1)) &&
    integer(comparison.sequence) &&
    string(comparison.createdAt),
  );
}

function validRankHistory(value: unknown): boolean {
  const history = record(value);
  return Boolean(
    history &&
    string(history.id) &&
    string(history.sessionId) &&
    integer(history.movieId, 1) &&
    nullable(history.rankBefore, (candidate) => integer(candidate, 1)) &&
    integer(history.rankAfter, 1) &&
    nullable(history.verdictBefore, (candidate) => enumValue(candidate, verdicts)) &&
    enumValue(history.verdictAfter, verdicts) &&
    enumValue(history.reason, new Set(["initial_log", "rewatch", "manual_rerank"])) &&
    string(history.createdAt),
  );
}

function validBounds(value: unknown): boolean {
  const bounds = record(value);
  return Boolean(bounds && integer(bounds.lower) && integer(bounds.upper));
}

function validRankingAnswer(value: unknown): boolean {
  const answer = record(value);
  return Boolean(
    answer &&
    string(answer.comparatorId) &&
    integer(answer.comparatorIndex) &&
    enumValue(answer.outcome, new Set(["new_wins", "existing_wins", "too_close"])) &&
    validBounds(answer.boundsBefore) &&
    validBounds(answer.boundsAfter),
  );
}

function validRankingSnapshot(value: unknown): boolean {
  const snapshot = record(value);
  return Boolean(
    snapshot &&
    validBounds(snapshot.bounds) &&
    integer(snapshot.placementIndex) &&
    integer(snapshot.decisiveAnswers) &&
    integer(snapshot.skips) &&
    stringArray(snapshot.usedComparatorIds) &&
    Array.isArray(snapshot.answers) && snapshot.answers.every(validRankingAnswer) &&
    enumValue(snapshot.status, new Set(["comparing", "complete"])) &&
    enumValue(snapshot.placementConfidence, placementConfidences) &&
    nullable(snapshot.completionReason, (candidate) => enumValue(candidate, new Set([
      "empty_bucket", "exact", "decisive_limit", "skip_limit", "no_comparator", "accepted",
    ]))),
  );
}

function validRankingSession(value: unknown): boolean {
  const session = record(value);
  return Boolean(
    session &&
    string(session.movieId) &&
    enumValue(session.verdict, verdicts) &&
    Array.isArray(session.candidates) && session.candidates.every((value) => {
      const candidate = record(value);
      return Boolean(candidate && string(candidate.movieId) && finiteNumber(candidate.similarity));
    }) &&
    validBounds(session.bounds) &&
    integer(session.placementIndex) &&
    integer(session.decisiveAnswers) &&
    integer(session.skips) &&
    stringArray(session.usedComparatorIds) &&
    Array.isArray(session.answers) && session.answers.every(validRankingAnswer) &&
    Array.isArray(session.snapshots) && session.snapshots.every(validRankingSnapshot) &&
    enumValue(session.status, new Set(["comparing", "complete"])) &&
    enumValue(session.placementConfidence, placementConfidences) &&
    nullable(session.completionReason, (candidate) => enumValue(candidate, new Set([
      "empty_bucket", "exact", "decisive_limit", "skip_limit", "no_comparator", "accepted",
    ]))),
  );
}

function validArray(value: unknown, validator: (candidate: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(validator);
}

function validAppState(value: unknown): value is AppState {
  const state = record(value);
  if (!state) return false;
  return (
    validArray(state.diary, validDiaryEntry) &&
    validArray(state.ranked, validRankedFilm) &&
    validArray(state.watchlist, validWatchlistItem) &&
    optional(state.movieCache, (candidate) => validArray(candidate, validMovie)) &&
    optional(state.comparisons, (candidate) => validArray(candidate, validComparison)) &&
    optional(state.rankHistory, (candidate) => validArray(candidate, validRankHistory)) &&
    optional(state.activeRankingSession, (candidate) => nullable(candidate, validRankingSession)) &&
    optional(state.activeRankingEntryId, (candidate) => nullable(candidate, string)) &&
    optional(state.activeRankingOriginalRank, (candidate) => nullable(candidate, integer)) &&
    optional(state.activeRankingOriginalVerdict, (candidate) => nullable(candidate, (item) => enumValue(item, verdicts))) &&
    optional(state.activeRankingLastActivityAt, (candidate) => nullable(candidate, string)) &&
    optional(state.activeRankingSessionId, (candidate) => nullable(candidate, string)) &&
    optional(state.activeRankingRevision, integer) &&
    optional(state.activeRankingReason, (candidate) => nullable(candidate, (item) => enumValue(item, new Set(["initial", "rewatch", "manual"])))) &&
    optional(state.activeRankingStatus, (candidate) => nullable(candidate, (item) => enumValue(item, new Set(["active", "abandoned"])))) &&
    optional(state.committedRankingSessionIds, stringArray)
  );
}

function compactMovies(state: AppState): Movie[] {
  const referenced = new Set([
    ...state.diary.map((entry) => entry.movieId),
    ...state.ranked.map((film) => film.movieId),
    ...state.watchlist.map((item) => item.movieId),
  ]);
  const cache = state.movieCache ?? [];
  const required = cache.filter((movie) => referenced.has(movie.id));
  const recent = cache
    .filter((movie) => !referenced.has(movie.id))
    .slice(-Math.max(0, MAX_CACHED_MOVIES - required.length));
  return [...required, ...recent].slice(-MAX_CACHED_MOVIES);
}

export function compactLocalState(state: AppState): AppState {
  return {
    ...state,
    movieCache: compactMovies(state),
    committedRankingSessionIds: (state.committedRankingSessionIds ?? []).slice(
      -MAX_COMMITTED_SESSION_IDS,
    ),
  };
}

export function parseLocalState(value: string): AppState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const parsedRecord = record(parsed);
  if (
    parsedRecord &&
    "version" in parsedRecord &&
    "state" in parsedRecord
  ) {
    if (
      parsedRecord.version !== LOCAL_STATE_VERSION ||
      !validAppState(parsedRecord.state)
    ) return null;
    return compactLocalState(parsedRecord.state);
  }
  if (validAppState(parsed)) return compactLocalState(parsed);
  return null;
}

export function serializeLocalState(state: AppState): string {
  return JSON.stringify({
    version: LOCAL_STATE_VERSION,
    state: compactLocalState(state),
  } satisfies StoredState);
}

export function safelyWriteLocalState(
  storage: Storage,
  key: string,
  state: AppState,
): { state: AppState; error: string | null } {
  const compacted = compactLocalState(state);
  try {
    storage.setItem(key, serializeLocalState(compacted));
    return { state: compacted, error: null };
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "QuotaExceededError"
        ? "This browser is out of storage space. Your latest change is still open, but it could not be saved on this device."
        : "Your latest change could not be saved on this device.";
    return { state: compacted, error: message };
  }
}
