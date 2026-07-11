"use client";

import { movieById } from "@/lib/seed";
import type { AppState, DiaryEntry, Movie } from "@/lib/types";
import { filmStyle, monthTitle, prettyDate, type CanonRow } from "@/lib/ui";
import { PosterArt, VerdictMark } from "./media";

export function DiaryView({
  groups,
  state,
  canon,
  onFilm,
  onLog,
}: {
  groups: [string, DiaryEntry[]][];
  state: AppState;
  canon: CanonRow[];
  onFilm: (movie: Movie) => void;
  onLog: () => void;
}) {
  return (
    <div className="page content-wrap diary-page">
      <div className="page-heading">
        <div>
          <h1>Diary</h1>
          <p className="page-description">Every watch, in the order it happened.</p>
        </div>
        <button className="primary-action" onClick={onLog}>Log a film</button>
      </div>
      {groups.map(([month, entries]) => (
        <section className="diary-month" key={month}>
          <div className="month-heading"><h2>{monthTitle(month)}</h2><span>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span></div>
          <div className="poster-wall">
            {entries.map((entry) => {
              const movie = movieById(entry.movieId);
              const row = canon.find((item) => item.movie.id === movie.id);
              return (
                <button className="diary-poster" key={entry.id} onClick={() => onFilm(movie)} style={filmStyle(movie)}>
                  <PosterArt movie={movie} />
                  <span className="diary-overlay">
                    <span>{prettyDate(entry.watchedOn, { month: "short", day: "numeric" })}</span>
                    <strong>{movie.title}</strong>
                    {entry.completionStatus === "dnf" ? <small>Did not finish</small> : row ? <VerdictMark verdict={row.ranked.verdict} /> : <small>Ranking unfinished</small>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {state.diary.length === 0 ? (
        <div className="empty-state">
          <h2>No entries yet</h2>
          <p>Your viewing history will collect here, month by month.</p>
          <button className="primary-action" onClick={onLog}>Log a film</button>
        </div>
      ) : null}
    </div>
  );
}
