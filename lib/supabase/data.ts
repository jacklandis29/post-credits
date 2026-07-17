import type { SupabaseClient } from "@supabase/supabase-js";
import {
  answerComparison,
  getNextComparison,
  startRanking,
  type RankingSession,
} from "@/lib/ranking";
import { cacheMovies } from "@/lib/seed";
import { movieSimilarity } from "@/lib/similarity";
import type {
  AppState,
  ComparisonRecord,
  DiaryEntry,
  FavoriteFilm,
  Movie,
  RankedFilm,
  RankHistoryRecord,
  Review,
  Verdict,
  WatchlistItem,
} from "@/lib/types";

const IMAGE_ORIGIN = "https://image.tmdb.org/t/p";

export type UserProfile = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  isPublic: boolean;
  isDiscoverable: boolean;
  defaultNoteVisibility: "private" | "public";
  bio: string;
  publicAccessApproved: boolean;
};

export type PublicProfile = Pick<
  UserProfile,
  "id" | "username" | "displayName"
> & {
  avatarUrl: string | null;
  bio: string | null;
};

export type PublicProfileState = {
  profile: PublicProfile;
  state: AppState;
};

export type CommunityMovieStats = {
  rankingCount: number;
  averageTopPercent: number | null;
  averageScore: number | null;
  likedPercent: number | null;
};

type DbRow = Record<string, unknown>;

function asRows(value: unknown): DbRow[] {
  return Array.isArray(value) ? (value as DbRow[]) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && "name" in item) {
      const name = (item as { name?: unknown }).name;
      return typeof name === "string" ? [name] : [];
    }
    return [];
  });
}

function namedItems(value: unknown): Array<{ id: number; name: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as DbRow;
    const id = number(row.id ?? row.tmdb_id);
    const name = text(row.name);
    return id > 0 && name ? [{ id, name }] : [];
  });
}

function director(value: unknown): string {
  const names = stringList(value);
  if (names.length) return names.join(" & ");
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "name" in value) {
    return text((value as { name?: unknown }).name, "Unknown director");
  }
  return "Unknown director";
}

function mapMovie(row: DbRow, palette?: DbRow): Movie {
  const posterPath = text(row.poster_path) || null;
  const backdropPath = text(row.backdrop_path) || null;
  const releaseDate = text(row.release_date);
  return {
    id: number(row.tmdb_id),
    title: text(row.title, "Untitled film"),
    originalTitle: text(row.original_title) || undefined,
    year: number(releaseDate.slice(0, 4), new Date().getFullYear()),
    releaseDate: releaseDate || undefined,
    runtime: row.runtime_minutes == null ? null : number(row.runtime_minutes),
    director: director(row.director),
    directors: namedItems(row.director),
    genres: stringList(row.genres),
    genreDetails: namedItems(row.genres),
    cast: stringList(row.principal_cast),
    credits: Array.isArray(row.principal_cast)
      ? row.principal_cast.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const cast = item as DbRow;
          const id = number(cast.id ?? cast.tmdb_id);
          const name = text(cast.name);
          return id > 0 && name
            ? [{ id, name, character: text(cast.character) || null, profile: null }]
            : [];
        })
      : undefined,
    keywords: stringList(row.keywords),
    keywordDetails: namedItems(row.keywords),
    originalLanguage: text(row.original_language) || null,
    productionCountries: stringList(row.production_countries),
    poster: posterPath ? `${IMAGE_ORIGIN}/w500${posterPath}` : null,
    backdrop: backdropPath ? `${IMAGE_ORIGIN}/w1280${backdropPath}` : null,
    overview: text(row.overview),
    palette: {
      dominant: text(palette?.dominant_color, "#443a69"),
      secondary: text(palette?.secondary_color, "#17152b"),
      accent: text(palette?.accent_color, "#9f91e8"),
    },
  };
}

export async function loadProfile(
  client: SupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await client
    .from("profiles")
    .select("id, username, display_name, avatar_url, timezone, is_public, is_discoverable, default_note_visibility, bio, public_access_approved")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as DbRow;
  return {
    id: text(row.id),
    username: text(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url) || null,
    timezone: text(row.timezone, "UTC"),
    isPublic: Boolean(row.is_public),
    isDiscoverable: Boolean(row.is_discoverable),
    defaultNoteVisibility: text(row.default_note_visibility) === "public" ? "public" : "private",
    bio: text(row.bio),
    publicAccessApproved: Boolean(row.public_access_approved),
  };
}

export async function createProfile(
  client: SupabaseClient,
  input: {
    id: string;
    username: string;
    displayName: string;
    timezone: string;
  },
): Promise<void> {
  const { error } = await client.from("profiles").insert({
    id: input.id,
    username: input.username.trim().toLowerCase(),
    display_name: input.displayName.trim(),
    timezone: input.timezone,
    is_public: false,
    is_discoverable: false,
  });
  if (error) throw error;
}

export async function updateProfile(
  client: SupabaseClient,
  input: {
    userId: string;
    displayName: string;
    bio: string;
    isPublic: boolean;
    isDiscoverable: boolean;
    defaultNoteVisibility: "private" | "public";
    avatarUrl: string | null;
  },
): Promise<UserProfile> {
  const { data, error } = await client
    .from("profiles")
    .update({
      display_name: input.displayName.trim(),
      bio: input.bio.trim() || null,
      is_public: input.isPublic,
      is_discoverable: input.isPublic && input.isDiscoverable,
      default_note_visibility: input.defaultNoteVisibility,
      avatar_url: input.avatarUrl,
    })
    .eq("id", input.userId)
    .select("id, username, display_name, avatar_url, timezone, is_public, is_discoverable, default_note_visibility, bio, public_access_approved")
    .single();
  if (error) throw error;
  const row = data as DbRow;
  return {
    id: text(row.id),
    username: text(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url) || null,
    timezone: text(row.timezone, "UTC"),
    isPublic: Boolean(row.is_public),
    isDiscoverable: Boolean(row.is_discoverable),
    defaultNoteVisibility: text(row.default_note_visibility) === "public" ? "public" : "private",
    bio: text(row.bio),
    publicAccessApproved: Boolean(row.public_access_approved),
  };
}

export async function searchPublicProfiles(
  client: SupabaseClient,
  query: string,
): Promise<PublicProfile[]> {
  const normalized = query.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (normalized.length < 2) return [];
  const { data, error } = await client
    .from("discoverable_profiles")
    .select("id, username, display_name, avatar_url, bio")
    .ilike("username", `${normalized}%`)
    .order("username", { ascending: true })
    .limit(8);
  if (error) throw error;
  return asRows(data).map((row) => ({
    id: text(row.id),
    username: text(row.username),
    displayName: text(row.display_name),
    avatarUrl: text(row.avatar_url) || null,
    bio: text(row.bio) || null,
  }));
}

export async function loadCommunityMovieStats(
  client: SupabaseClient,
  movieId: number,
): Promise<CommunityMovieStats> {
  const { data, error } = await client
    .from("public_canon")
    .select("canon_rank, total_ranked, derived_score, verdict")
    .eq("tmdb_id", movieId)
    .limit(500);
  if (error) throw error;
  const rows = asRows(data);
  const percentiles = rows.flatMap((row) => {
    const rank = number(row.canon_rank);
    const total = number(row.total_ranked);
    return rank > 0 && total > 0 ? [rank / total] : [];
  });
  const scores = rows.flatMap((row) =>
    row.derived_score == null ? [] : [number(row.derived_score)],
  );
  const liked = rows.filter((row) => text(row.verdict) === "liked").length;
  return {
    rankingCount: rows.length,
    averageTopPercent: percentiles.length
      ? Math.max(1, Math.round(percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length * 100))
      : null,
    averageScore: scores.length
      ? scores.reduce((sum, value) => sum + value, 0) / scores.length
      : null,
    likedPercent: rows.length ? Math.round(liked / rows.length * 100) : null,
  };
}

export async function loadPublicProfileState(
  client: SupabaseClient,
  profileId: string,
): Promise<PublicProfileState> {
  const [profileResult, diaryResult, canonResult, favoritesResult, reviewsResult] = await Promise.all([
    client.from("public_profiles").select("id, username, display_name, avatar_url, bio").eq("id", profileId).single(),
    client.from("public_diary_entries").select("*").eq("user_id", profileId).order("watched_on", { ascending: false }),
    client.from("public_canon").select("*").eq("user_id", profileId).order("canon_rank", { ascending: true }),
    client.from("public_profile_favorites").select("*").eq("user_id", profileId).order("position", { ascending: true }),
    client.from("public_reviews").select("*").eq("user_id", profileId).order("updated_at", { ascending: false }),
  ]);
  if (profileResult.error) throw profileResult.error;
  if (diaryResult.error) throw diaryResult.error;
  if (canonResult.error) throw canonResult.error;
  if (favoritesResult.error) throw favoritesResult.error;
  if (reviewsResult.error) throw reviewsResult.error;

  const profileRow = profileResult.data as DbRow;
  const diaryRows = asRows(diaryResult.data);
  const canonRows = asRows(canonResult.data);
  const favoriteRows = asRows(favoritesResult.data);
  const reviewRows = asRows(reviewsResult.data);
  const movieIds = [...new Set([
    ...diaryRows.map((row) => number(row.tmdb_id)),
    ...canonRows.map((row) => number(row.tmdb_id)),
    ...favoriteRows.map((row) => number(row.tmdb_id)),
    ...reviewRows.map((row) => number(row.tmdb_id)),
  ])].filter((id) => id > 0);
  let movieRows: DbRow[] = [];
  let paletteRows: DbRow[] = [];
  if (movieIds.length) {
    const [moviesResult, palettesResult] = await Promise.all([
      client.from("movies").select("*").in("tmdb_id", movieIds),
      client.from("movie_palettes").select("*").in("tmdb_id", movieIds),
    ]);
    if (moviesResult.error) throw moviesResult.error;
    if (palettesResult.error) throw palettesResult.error;
    movieRows = asRows(moviesResult.data);
    paletteRows = asRows(palettesResult.data);
  }
  const movieCache = movieRows.map((row) => mapMovie(
    row,
    paletteRows.find((palette) => number(palette.tmdb_id) === number(row.tmdb_id)),
  ));
  cacheMovies(movieCache);

  return {
    profile: {
      id: text(profileRow.id),
      username: text(profileRow.username),
      displayName: text(profileRow.display_name),
      avatarUrl: text(profileRow.avatar_url) || null,
      bio: text(profileRow.bio) || null,
    },
    state: {
      diary: diaryRows.map((row) => ({
        id: text(row.id),
        movieId: number(row.tmdb_id),
        watchedOn: text(row.watched_on),
        note: text(row.note),
        containsSpoilers: Boolean(row.contains_spoilers),
        tags: stringList(row.tags),
        visibility: "public" as const,
        completionStatus: text(row.completion_status, "completed") as DiaryEntry["completionStatus"],
        rankingStatus: text(row.ranking_status, "complete") as DiaryEntry["rankingStatus"],
        isRewatch: Boolean(row.is_rewatch),
        createdAt: text(row.created_at),
      })),
      reviews: reviewRows.map((row) => ({
        id: text(row.id),
        movieId: number(row.tmdb_id),
        body: text(row.body),
        visibility: "public" as const,
        createdAt: text(row.created_at),
        updatedAt: text(row.updated_at),
      })),
      ranked: canonRows.map((row) => ({
        movieId: number(row.tmdb_id),
        verdict: text(row.verdict) as Verdict,
        sortPosition: number(row.sort_position),
        placementConfidence: text(row.placement_confidence, "exact") as RankedFilm["placementConfidence"],
        comparisonCount: number(row.comparison_count),
        firstRankedAt: text(row.first_ranked_at),
        lastRankedAt: text(row.last_ranked_at),
      })),
      watchlist: [],
      likedMovieIds: [],
      favorites: favoriteRows.map((row) => ({
        movieId: number(row.tmdb_id),
        position: number(row.position),
        addedAt: text(row.created_at),
      })),
      movieCache,
      comparisons: [],
      rankHistory: [],
      activeRankingSession: null,
    },
  };
}

export async function loadPublicProfileByUsername(
  client: SupabaseClient,
  username: string,
): Promise<PublicProfileState> {
  const normalized = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!normalized) throw new Error("Invalid profile username.");
  const { data, error } = await client
    .from("public_profiles")
    .select("id")
    .eq("username", normalized)
    .single();
  if (error) throw error;
  return loadPublicProfileState(client, text((data as DbRow).id));
}

export async function loadUserState(
  client: SupabaseClient,
  userId: string,
): Promise<AppState> {
  const [snapshotResult, likesResult, favoritesResult, reviewsResult] = await Promise.all([
    client.rpc("get_after_credits_state"),
    client.from("film_likes").select("user_id, tmdb_id").eq("user_id", userId),
    client.from("profile_favorites").select("user_id, tmdb_id, position, created_at").eq("user_id", userId).order("position", { ascending: true }),
    client.from("reviews").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
  ]);
  if (snapshotResult.error) throw snapshotResult.error;
  if (likesResult.error) throw likesResult.error;
  if (favoritesResult.error) throw favoritesResult.error;
  if (reviewsResult.error) throw reviewsResult.error;
  const data = snapshotResult.data;
  const snapshot = (
    Array.isArray(data) ? data[0] : data
  ) as DbRow | null;
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("Supabase returned an invalid diary snapshot.");
  }

  const watches = asRows(snapshot.watch_entries);
  const watchlistRows = asRows(snapshot.watchlist_items);
  const canonRows = asRows(snapshot.canon);
  const historyRows = asRows(snapshot.rank_history);
  const comparisonRows = asRows(snapshot.comparisons);
  const activeDbSession = asRows(snapshot.ranking_sessions)[0];
  const activeAnswers = asRows(snapshot.ranking_session_answers);
  const movieRows = asRows(snapshot.movies);
  const paletteRows = asRows(snapshot.movie_palettes);
  const likeRows = asRows(likesResult.data);
  const favoriteRows = asRows(favoritesResult.data);
  const reviewRows = asRows(reviewsResult.data);
  if (
    [watches, watchlistRows, canonRows, historyRows, comparisonRows, likeRows, favoriteRows, reviewRows]
      .flat()
      .some((row) => text(row.user_id) !== userId) ||
    (activeDbSession && text(activeDbSession.user_id) !== userId)
  ) {
    throw new Error("Supabase returned another user's data.");
  }

  const extraMovieIds = [...new Set([
    ...likeRows.map((row) => number(row.tmdb_id)),
    ...favoriteRows.map((row) => number(row.tmdb_id)),
    ...reviewRows.map((row) => number(row.tmdb_id)),
  ])].filter((id) => id > 0 && !movieRows.some((row) => number(row.tmdb_id) === id));
  let allMovieRows = movieRows;
  let allPaletteRows = paletteRows;
  if (extraMovieIds.length) {
    const [extraMovies, extraPalettes] = await Promise.all([
      client.from("movies").select("*").in("tmdb_id", extraMovieIds),
      client.from("movie_palettes").select("*").in("tmdb_id", extraMovieIds),
    ]);
    if (extraMovies.error) throw extraMovies.error;
    if (extraPalettes.error) throw extraPalettes.error;
    allMovieRows = [...movieRows, ...asRows(extraMovies.data)];
    allPaletteRows = [...paletteRows, ...asRows(extraPalettes.data)];
  }

  const cachedMovies = allMovieRows.map((row) =>
    mapMovie(
      row,
      allPaletteRows.find((palette) => number(palette.tmdb_id) === number(row.tmdb_id)),
    ),
  );
  cacheMovies(cachedMovies);

  const diary: DiaryEntry[] = watches.map((row) => ({
    id: text(row.id),
    movieId: number(row.tmdb_id),
    watchedOn: text(row.watched_on),
    note: text(row.note),
    containsSpoilers: Boolean(row.contains_spoilers),
    tags: stringList(row.tags),
    visibility: text(row.visibility, "inherit") as DiaryEntry["visibility"],
    completionStatus: text(row.completion_status, "completed") as DiaryEntry["completionStatus"],
    rankingStatus: text(row.ranking_status, "pending") as DiaryEntry["rankingStatus"],
    isRewatch: Boolean(row.is_rewatch),
    createdAt: text(row.created_at),
  }));
  const reviews: Review[] = reviewRows.map((row) => ({
    id: text(row.id),
    movieId: number(row.tmdb_id),
    body: text(row.body),
    visibility: text(row.visibility) === "public" ? "public" : "private",
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }));
  const ranked: RankedFilm[] = canonRows.map((row) => ({
    movieId: number(row.tmdb_id),
    verdict: text(row.verdict) as Verdict,
    sortPosition: number(row.sort_position),
    placementConfidence: text(row.placement_confidence, "provisional") as RankedFilm["placementConfidence"],
    comparisonCount: number(row.comparison_count),
    firstRankedAt: text(row.first_ranked_at),
    lastRankedAt: text(row.last_ranked_at),
  }));
  const watchlist: WatchlistItem[] = watchlistRows.map((row) => ({
    movieId: number(row.tmdb_id),
    addedAt: text(row.added_at),
  }));
  const comparisons: ComparisonRecord[] = comparisonRows.map((row) => ({
    id: text(row.id),
    sessionId: text(row.session_id),
    sessionMovieId: number(row.subject_tmdb_id),
    opponentMovieId: number(row.opponent_tmdb_id),
    winnerMovieId: row.winner_tmdb_id == null ? null : number(row.winner_tmdb_id),
    sequence: number(row.sequence_number),
    createdAt: text(row.created_at),
  }));
  const rankHistory: RankHistoryRecord[] = historyRows.map((row) => ({
    id: text(row.id),
    sessionId: text(row.session_id),
    movieId: number(row.tmdb_id),
    rankBefore: row.rank_before == null ? null : number(row.rank_before),
    rankAfter: number(row.rank_after),
    verdictBefore: row.verdict_before == null ? null : text(row.verdict_before) as Verdict,
    verdictAfter: text(row.verdict_after) as Verdict,
    reason: text(row.reason) as RankHistoryRecord["reason"],
    createdAt: text(row.created_at),
  }));

  let activeRankingSession: RankingSession | null = null;
  let restoredAnswerCount = 0;
  if (activeDbSession) {
    const subjectId = number(activeDbSession.subject_tmdb_id);
    const verdict = text(activeDbSession.target_verdict) as Verdict;
    const subjectMovie = cachedMovies.find((movie) => movie.id === subjectId);
    let restored = startRanking({
      movieId: String(subjectId),
      verdict,
      candidates: canonRows
        .filter((row) => number(row.tmdb_id) !== subjectId && text(row.verdict) === verdict)
        .sort((left, right) => number(left.sort_position) - number(right.sort_position))
        .map((row) => {
          const candidateId = number(row.tmdb_id);
          const candidateMovie = cachedMovies.find((movie) => movie.id === candidateId);
          return {
            movieId: String(candidateId),
            similarity:
              subjectMovie && candidateMovie
                ? movieSimilarity(subjectMovie, candidateMovie)
                : 0,
          };
        }),
    });
    for (const answer of activeAnswers) {
      const next = getNextComparison(restored);
      if (!next || next.comparatorId !== String(number(answer.opponent_tmdb_id))) break;
      const winnerId = answer.winner_tmdb_id == null ? null : number(answer.winner_tmdb_id);
      restored = answerComparison(restored, {
        comparatorId: next.comparatorId,
        outcome:
          winnerId == null
            ? "too_close"
            : winnerId === subjectId
              ? "new_wins"
              : "existing_wins",
      });
      restoredAnswerCount += 1;
    }
    if (restoredAnswerCount !== activeAnswers.length) {
      throw new Error("The active ranking session could not be restored safely.");
    }
    const subjectCanonRow = canonRows.find(
      (row) => number(row.tmdb_id) === subjectId,
    );
    if (!subjectCanonRow) {
      throw new Error("The active ranking placement is missing from the canon.");
    }
    const serverPlacementIndex = Math.max(
      0,
      number(subjectCanonRow.bucket_rank, 1) - 1,
    );
    restored = {
      ...restored,
      placementIndex: serverPlacementIndex,
    };
    activeRankingSession = restored;
  }

  const activeSessionId = activeDbSession ? text(activeDbSession.id) : null;
  const stateIsInconsistent = Boolean(
    (!activeSessionId && diary.some((entry) => entry.rankingStatus === "in_progress")) ||
      (!activeSessionId && canonRows.some((row) => row.active_ranking_session_id)) ||
      (activeSessionId && !canonRows.some(
        (row) => text(row.active_ranking_session_id) === activeSessionId,
      )) ||
      (activeSessionId && rankHistory.some((entry) => entry.sessionId === activeSessionId)),
  );
  if (stateIsInconsistent) {
    throw new Error("Supabase returned an inconsistent diary snapshot.");
  }

  return {
    diary,
    reviews,
    ranked,
    watchlist,
    likedMovieIds: likeRows.map((row) => number(row.tmdb_id)),
    favorites: favoriteRows.map((row): FavoriteFilm => ({
      movieId: number(row.tmdb_id),
      position: number(row.position),
      addedAt: text(row.created_at),
    })),
    movieCache: cachedMovies,
    comparisons,
    rankHistory,
    activeRankingSession,
    activeRankingEntryId: activeDbSession ? text(activeDbSession.watch_entry_id) || null : null,
    activeRankingOriginalRank: activeDbSession?.original_rank_snapshot == null ? null : number(activeDbSession.original_rank_snapshot),
    activeRankingOriginalVerdict: activeDbSession?.original_verdict == null ? null : text(activeDbSession.original_verdict) as Verdict,
    activeRankingLastActivityAt: activeDbSession ? text(activeDbSession.last_activity_at) : null,
    activeRankingSessionId: activeDbSession ? text(activeDbSession.id) : null,
    activeRankingRevision: restoredAnswerCount,
    activeRankingReason: activeDbSession
      ? text(activeDbSession.reason) === "manual_rerank"
        ? "manual"
        : text(activeDbSession.reason) === "rewatch"
          ? "rewatch"
          : "initial"
      : null,
    activeRankingStatus: activeDbSession
      ? text(activeDbSession.status) as "active" | "abandoned"
      : null,
    committedRankingSessionIds: rankHistory.map((entry) => entry.sessionId),
  };
}

export async function cacheMovieRecord(
  client: SupabaseClient,
  movie: Movie,
): Promise<void> {
  if (!Number.isSafeInteger(movie.id) || movie.id <= 0) {
    throw new Error("Invalid TMDB movie id");
  }
  const {
    data: { session },
    error: sessionError,
  } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session?.access_token) throw new Error("Authentication required");

  const response = await fetch("/api/tmdb/cache", {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tmdbId: movie.id }),
  });
  let payload: { error?: unknown; code?: unknown } | null = null;
  try {
    payload = (await response.json()) as { error?: unknown; code?: unknown };
  } catch {
    // The status still determines success when an intermediary strips the body.
  }
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Could not cache film details";
    const routeError = new Error(message) as Error & { code?: string };
    if (typeof payload?.code === "string") routeError.code = payload.code;
    throw routeError;
  }
}

export async function insertWatchEntry(
  client: SupabaseClient,
  input: {
    userId: string;
    movie: Movie;
    watchedOn: string;
    note: string;
    visibility: DiaryEntry["visibility"];
    containsSpoilers: boolean;
    tags: string[];
    dnf: boolean;
    importKey?: string;
  },
): Promise<DiaryEntry> {
  await cacheMovieRecord(client, input.movie);
  const values = {
    user_id: input.userId,
    tmdb_id: input.movie.id,
    watched_on: input.watchedOn,
    completion_status: input.dnf ? "dnf" : "completed",
    note: input.note.trim() || null,
    visibility: input.visibility,
    contains_spoilers: input.containsSpoilers,
    tags: input.tags,
    ...(input.importKey ? { client_import_id: input.importKey } : {}),
  };
  let { data, error } = await client
    .from("watch_entries")
    .insert(values)
    .select("*")
    .single();
  if (error?.code === "23505" && input.importKey) {
    const existing = await client
      .from("watch_entries")
      .select("*")
      .eq("user_id", input.userId)
      .eq("client_import_id", input.importKey)
      .single();
    data = existing.data;
    error = existing.error;
  }
  if (error) throw error;
  const row = data as DbRow;
  return {
    id: text(row.id),
    movieId: number(row.tmdb_id),
    watchedOn: text(row.watched_on),
    note: text(row.note),
    containsSpoilers: Boolean(row.contains_spoilers),
    tags: stringList(row.tags),
    visibility: text(row.visibility, "inherit") as DiaryEntry["visibility"],
    completionStatus: text(row.completion_status) as DiaryEntry["completionStatus"],
    rankingStatus: text(row.ranking_status) as DiaryEntry["rankingStatus"],
    isRewatch: Boolean(row.is_rewatch),
    createdAt: text(row.created_at),
  };
}

export async function setFilmLike(
  client: SupabaseClient,
  input: { userId: string; movie: Movie; shouldLike: boolean },
): Promise<void> {
  if (input.shouldLike) {
    await cacheMovieRecord(client, input.movie);
    const { error } = await client.from("film_likes").insert({
      user_id: input.userId,
      tmdb_id: input.movie.id,
    });
    if (error && error.code !== "23505") throw error;
    return;
  }
  const { error } = await client
    .from("film_likes")
    .delete()
    .eq("user_id", input.userId)
    .eq("tmdb_id", input.movie.id);
  if (error) throw error;
}

export async function setFavoriteFilm(
  client: SupabaseClient,
  input: { userId: string; movie: Movie; position: number | null },
): Promise<void> {
  if (input.position !== null) {
    await cacheMovieRecord(client, input.movie);
    const { error } = await client.from("profile_favorites").insert({
      user_id: input.userId,
      tmdb_id: input.movie.id,
      position: input.position,
    });
    if (error && error.code !== "23505") throw error;
    return;
  }
  const { error } = await client
    .from("profile_favorites")
    .delete()
    .eq("user_id", input.userId)
    .eq("tmdb_id", input.movie.id);
  if (error) throw error;
}

export async function uploadProfileAvatar(
  client: SupabaseClient,
  userId: string,
  file: File,
): Promise<string> {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("Choose a JPG, PNG, or WebP image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Avatar images must be 5 MB or smaller.");
  const path = `${userId}/avatar-${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from("avatars").upload(path, file, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return client.storage.from("avatars").getPublicUrl(path).data.publicUrl;
}

export async function updateWatchEntry(
  client: SupabaseClient,
  input: {
    entryId: string;
    watchedOn: string;
    note: string;
    visibility: DiaryEntry["visibility"];
    containsSpoilers: boolean;
    tags: string[];
  },
): Promise<DiaryEntry> {
  const { data, error } = await client
    .rpc("update_watch_entry", {
      p_watch_entry_id: input.entryId,
      p_watched_on: input.watchedOn,
      p_note: input.note.trim() || null,
      p_visibility: input.visibility,
      p_contains_spoilers: input.containsSpoilers,
      p_tags: input.tags,
    })
    .single();
  if (error) throw error;
  const row = data as DbRow;
  return {
    id: text(row.id),
    movieId: number(row.tmdb_id),
    watchedOn: text(row.watched_on),
    note: text(row.note),
    containsSpoilers: Boolean(row.contains_spoilers),
    tags: stringList(row.tags),
    visibility: text(row.visibility, "inherit") as DiaryEntry["visibility"],
    completionStatus: text(row.completion_status) as DiaryEntry["completionStatus"],
    rankingStatus: text(row.ranking_status) as DiaryEntry["rankingStatus"],
    isRewatch: Boolean(row.is_rewatch),
    createdAt: text(row.created_at),
  };
}

export async function deleteWatchEntry(
  client: SupabaseClient,
  input: { entryId: string; removeFromCanon: boolean },
): Promise<void> {
  const { error } = await client.rpc("delete_watch_entry", {
    p_watch_entry_id: input.entryId,
    p_remove_from_canon: input.removeFromCanon,
  });
  if (error) throw error;
}

export async function saveReviewRecord(
  client: SupabaseClient,
  input: {
    userId: string;
    movie: Movie;
    body: string;
    visibility: Review["visibility"];
  },
): Promise<Review | null> {
  const body = input.body.trim();
  if (!body) {
    const { error } = await client
      .from("reviews")
      .delete()
      .eq("user_id", input.userId)
      .eq("tmdb_id", input.movie.id);
    if (error) throw error;
    return null;
  }
  await cacheMovieRecord(client, input.movie);
  const { data, error } = await client
    .from("reviews")
    .upsert({
      user_id: input.userId,
      tmdb_id: input.movie.id,
      body,
      visibility: input.visibility,
    }, { onConflict: "user_id,tmdb_id" })
    .select("*")
    .single();
  if (error) throw error;
  const row = data as DbRow;
  return {
    id: text(row.id),
    movieId: number(row.tmdb_id),
    body: text(row.body),
    visibility: text(row.visibility) === "public" ? "public" : "private",
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export async function setWatchlistItem(
  client: SupabaseClient,
  input: { userId: string; movie: Movie; shouldAdd: boolean },
): Promise<void> {
  if (input.shouldAdd) {
    await cacheMovieRecord(client, input.movie);
    const { error } = await client.from("watchlist_items").insert({
      user_id: input.userId,
      tmdb_id: input.movie.id,
    });
    if (error && error.code !== "23505") throw error;
    return;
  }
  const { error } = await client
    .from("watchlist_items")
    .delete()
    .eq("user_id", input.userId)
    .eq("tmdb_id", input.movie.id);
  if (error) throw error;
}

export async function beginRankingRecord(
  client: SupabaseClient,
  input: {
    movieId: number;
    watchEntryId: string | null;
    reason: "initial_log" | "rewatch" | "manual_rerank";
    verdict: Verdict;
  },
): Promise<string> {
  const { data, error } = await client
    .rpc("begin_ranking_session", {
      p_subject_tmdb_id: input.movieId,
      p_watch_entry_id: input.watchEntryId,
      p_reason: input.reason,
      p_target_verdict: input.verdict,
    })
    .single();
  if (error) throw error;
  const row = data as DbRow;
  const id = text(row.id);
  if (!id) throw new Error("Ranking session did not return an id");
  return id;
}

export async function recordRankingAnswer(
  client: SupabaseClient,
  input: {
    sessionId: string;
    opponentMovieId: number;
    winnerMovieId: number | null;
  },
): Promise<void> {
  const { error } = await client.rpc("record_ranking_answer", {
    p_session_id: input.sessionId,
    p_opponent_tmdb_id: input.opponentMovieId,
    p_winner_tmdb_id: input.winnerMovieId,
  });
  if (error) throw error;
}

export async function undoRankingAnswer(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client.rpc("undo_last_ranking_answer", {
    p_session_id: sessionId,
  });
  if (error) throw error;
}

export async function resumeRankingRecord(
  client: SupabaseClient,
  sessionId: string,
): Promise<void> {
  const { error } = await client.rpc("resume_ranking_session", {
    p_session_id: sessionId,
  });
  if (error) throw error;
}

export async function commitRankingRecord(
  client: SupabaseClient,
  sessionId: string,
  confidence: "exact" | "provisional",
): Promise<void> {
  const { error } = await client.rpc("commit_ranking_session", {
    p_session_id: sessionId,
    p_final_confidence: confidence,
  });
  if (error) throw error;
}
