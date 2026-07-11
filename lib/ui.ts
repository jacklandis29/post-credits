import type { CSSProperties } from "react";
import { computeRankedCanon } from "@/lib/ranking";
import { movieById } from "@/lib/seed";
import type { AppState, DiaryEntry, Movie, RankedFilm, Verdict } from "@/lib/types";

export type CanonRow = {
  movie: Movie;
  ranked: RankedFilm;
  rank: number;
  withinBucketRank: number;
  score: number | null;
};

export const verdictPriority: Record<Verdict, number> = {
  liked: 0,
  fine: 1,
  disliked: 2,
};

export const verdictCopy: Record<Verdict, { label: string; short: string }> = {
  liked: { label: "Liked it", short: "Liked" },
  fine: { label: "It was okay", short: "Okay" },
  disliked: { label: "Not for me", short: "Not for me" },
};

export function todayLocal(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function filmStyle(movie: Movie): CSSProperties {
  return {
    "--film-dominant": movie.palette.dominant,
    "--film-secondary": movie.palette.secondary,
    "--film-accent": movie.palette.accent,
  } as CSSProperties;
}

export function sortDiary(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries].sort(
    (left, right) =>
      right.watchedOn.localeCompare(left.watchedOn) ||
      right.createdAt.localeCompare(left.createdAt),
  );
}

export function sortBucket(ranked: RankedFilm[], verdict: Verdict): RankedFilm[] {
  return ranked
    .filter((film) => film.verdict === verdict)
    .sort((left, right) => left.sortPosition - right.sortPosition);
}

export function canonFromState(state: AppState): CanonRow[] {
  const buckets = {
    liked: sortBucket(state.ranked, "liked").map((film) => String(film.movieId)),
    fine: sortBucket(state.ranked, "fine").map((film) => String(film.movieId)),
    disliked: sortBucket(state.ranked, "disliked").map((film) => String(film.movieId)),
  };
  const calculated = computeRankedCanon(buckets);
  return calculated.map((row) => {
    const ranked = state.ranked.find(
      (film) => String(film.movieId) === row.movieId,
    );
    if (!ranked) throw new Error(`Missing ranked film ${row.movieId}`);
    return {
      movie: movieById(Number(row.movieId)),
      ranked,
      rank: row.globalRank,
      withinBucketRank: row.withinBucketRank,
      score: row.score,
    };
  });
}

export function insertionPosition(bucket: RankedFilm[], placementIndex: number): number {
  const previous = bucket[placementIndex - 1]?.sortPosition;
  const next = bucket[placementIndex]?.sortPosition;
  if (previous !== undefined && next !== undefined) return (previous + next) / 2;
  if (previous !== undefined) return previous + 100;
  if (next !== undefined) return next - 100;
  return 100;
}

export function prettyDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", options ?? {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function monthTitle(key: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(`${key}-15T12:00:00`),
  );
}

export function isValidLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isAbandonedSession(lastActivityAt?: string | null): boolean {
  if (!lastActivityAt) return false;
  const lastActivity = new Date(lastActivityAt).getTime();
  return Number.isFinite(lastActivity) && Date.now() - lastActivity >= 24 * 60 * 60 * 1_000;
}

export function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "The request failed.";
}
