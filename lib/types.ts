export type Verdict = "liked" | "fine" | "disliked";

export type CompletionStatus = "completed" | "dnf";

export type NoteVisibility = "inherit" | "private" | "public";

export type MoviePalette = {
  dominant: string;
  secondary: string;
  accent: string;
};

export type Movie = {
  id: number;
  title: string;
  originalTitle?: string;
  year: number;
  releaseDate?: string;
  runtime: number | null;
  director: string;
  directors?: Array<{ id: number; name: string }>;
  genres: string[];
  genreDetails?: Array<{ id: number; name: string }>;
  cast?: string[];
  credits?: Array<{
    id?: number;
    name: string;
    character: string | null;
    profile: string | null;
  }>;
  keywords?: string[];
  keywordDetails?: Array<{ id: number; name: string }>;
  watchProviders?: {
    region: string;
    link: string;
    stream: Array<{ id: number; name: string; logo: string | null }>;
    rent: Array<{ id: number; name: string; logo: string | null }>;
    buy: Array<{ id: number; name: string; logo: string | null }>;
  } | null;
  originalLanguage?: string | null;
  productionCountries?: string[];
  poster: string | null;
  backdrop: string | null;
  overview: string;
  tagline?: string | null;
  trailerUrl?: string | null;
  imdbId?: string | null;
  palette: MoviePalette;
};

export type DiaryEntry = {
  id: string;
  movieId: number;
  watchedOn: string;
  note: string;
  containsSpoilers?: boolean;
  tags?: string[];
  visibility: NoteVisibility;
  completionStatus: CompletionStatus;
  rankingStatus: "pending" | "in_progress" | "complete" | "not_applicable";
  isRewatch: boolean;
  createdAt: string;
};

export type FavoriteFilm = {
  movieId: number;
  position: number;
  addedAt: string;
};

export type RankedFilm = {
  movieId: number;
  verdict: Verdict;
  sortPosition: number;
  placementConfidence: "exact" | "provisional";
  comparisonCount: number;
  firstRankedAt: string;
  lastRankedAt: string;
};

export type WatchlistItem = {
  movieId: number;
  addedAt: string;
};

export type ComparisonRecord = {
  id: string;
  sessionId: string;
  sessionMovieId: number;
  opponentMovieId: number;
  winnerMovieId: number | null;
  sequence: number;
  createdAt: string;
};

export type RankHistoryRecord = {
  id: string;
  sessionId: string;
  movieId: number;
  rankBefore: number | null;
  rankAfter: number;
  verdictBefore: Verdict | null;
  verdictAfter: Verdict;
  reason: "initial_log" | "rewatch" | "manual_rerank";
  createdAt: string;
};

export type AppState = {
  diary: DiaryEntry[];
  ranked: RankedFilm[];
  watchlist: WatchlistItem[];
  likedMovieIds?: number[];
  favorites?: FavoriteFilm[];
  movieCache?: Movie[];
  comparisons?: ComparisonRecord[];
  rankHistory?: RankHistoryRecord[];
  activeRankingSession?: RankingSession | null;
  activeRankingEntryId?: string | null;
  activeRankingOriginalRank?: number | null;
  activeRankingOriginalVerdict?: Verdict | null;
  activeRankingLastActivityAt?: string | null;
  activeRankingSessionId?: string | null;
  activeRankingRevision?: number;
  activeRankingReason?: "initial" | "rewatch" | "manual" | null;
  activeRankingStatus?: "active" | "abandoned" | null;
  committedRankingSessionIds?: string[];
};
import type { RankingSession } from "./ranking";
