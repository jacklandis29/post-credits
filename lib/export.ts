import { movieById } from "./seed";
import type { AppState } from "./types";
import { canonFromState } from "./ui";

type ExportProfile = { username?: string; displayName?: string; timezone?: string };

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function exportUserData(profile: ExportProfile | null, state: AppState, format: "json" | "csv") {
  const date = new Date().toISOString().slice(0, 10);
  const slug = profile?.username ? `post-credits-${profile.username}` : "post-credits-diary";
  const canon = canonFromState(state);
  if (format === "json") {
    download(`${slug}-${date}.json`, JSON.stringify({
      exportVersion: 1, exportedAt: new Date().toISOString(), profile,
      diary: state.diary.map((entry) => ({ ...entry, movie: movieById(entry.movieId) })),
      reviews: state.reviews.map((review) => ({ ...review, movie: movieById(review.movieId) })),
      canon: canon.map((row) => ({ rank: row.rank, score: row.score, ...row.ranked, movie: row.movie })),
      watchlist: state.watchlist.map((item) => ({ ...item, movie: movieById(item.movieId) })),
      comparisons: state.comparisons ?? [], rankHistory: state.rankHistory ?? [],
    }, null, 2), "application/json;charset=utf-8");
    return;
  }
  const header = ["record_type", "title", "year", "tmdb_id", "watched_on", "completion_status", "rewatch", "note", "review", "visibility", "rank", "score", "verdict", "added_at", "updated_at"];
  const rows: unknown[][] = [
    ...state.diary.map((entry) => { const movie = movieById(entry.movieId); return ["watch", movie.title, movie.year, movie.id, entry.watchedOn, entry.completionStatus, entry.isRewatch, entry.note, "", entry.visibility, "", "", "", "", entry.createdAt]; }),
    ...state.reviews.map((review) => { const movie = movieById(review.movieId); return ["review", movie.title, movie.year, movie.id, "", "", "", "", review.body, review.visibility, "", "", "", "", review.updatedAt]; }),
    ...canon.map((row) => ["canon", row.movie.title, row.movie.year, row.movie.id, "", "", "", "", "", "", row.rank, row.score, row.ranked.verdict, "", row.ranked.lastRankedAt]),
    ...state.watchlist.map((item) => { const movie = movieById(item.movieId); return ["watchlist", movie.title, movie.year, movie.id, "", "", "", "", "", "", "", "", "", item.addedAt, ""]; }),
  ];
  download(`${slug}-${date}.csv`, [header, ...rows].map((row) => row.map(cell).join(",")).join("\n"), "text/csv;charset=utf-8");
}
