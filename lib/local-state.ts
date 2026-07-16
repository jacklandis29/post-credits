import type { AppState, Movie } from "./types";

const LOCAL_STATE_VERSION = 1;
const MAX_CACHED_MOVIES = 250;
const MAX_COMMITTED_SESSION_IDS = 200;

type StoredState = {
  version: typeof LOCAL_STATE_VERSION;
  state: AppState;
};

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
  const parsed = JSON.parse(value) as StoredState | AppState;
  if (
    parsed &&
    typeof parsed === "object" &&
    "version" in parsed &&
    "state" in parsed
  ) {
    if (parsed.version !== LOCAL_STATE_VERSION) return null;
    return compactLocalState(parsed.state);
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    "diary" in parsed &&
    "ranked" in parsed &&
    "watchlist" in parsed
  ) {
    return compactLocalState(parsed as AppState);
  }
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
