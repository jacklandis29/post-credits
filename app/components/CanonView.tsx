"use client";

import { formatScore } from "@/lib/ranking";
import type { DiaryEntry, Movie, Verdict } from "@/lib/types";
import { filmStyle, sortDiary, verdictCopy, type CanonRow } from "@/lib/ui";
import { SearchIcon } from "./icons";
import { PosterArt, VerdictMark } from "./media";

export function CanonView({
  rows,
  total,
  diary,
  query,
  verdict,
  onQuery,
  onVerdict,
  onFilm,
  onLog,
}: {
  rows: CanonRow[];
  total: number;
  diary: DiaryEntry[];
  query: string;
  verdict: "all" | Verdict;
  onQuery: (value: string) => void;
  onVerdict: (value: "all" | Verdict) => void;
  onFilm: (movie: Movie) => void;
  onLog: () => void;
}) {
  return (
    <div className="page content-wrap canon-page">
      <div className="page-heading canon-heading">
        <div>
          <h1>Ranking</h1>
          <p className="page-description">One current position for every film you&rsquo;ve finished, decided by your own comparisons.</p>
        </div>
        <div className="canon-count"><strong>{total}</strong><span>{total === 1 ? "film" : "films"}</span></div>
      </div>
      <div className="canon-tools">
        <label className="search-field"><SearchIcon /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search your ranking" aria-label="Search your ranking" /></label>
        <div className="filter-tabs" aria-label="Filter by verdict">
          {(["all", "liked", "fine", "disliked"] as const).map((item) => (
            <button key={item} className={verdict === item ? "active" : ""} onClick={() => onVerdict(item)}>{item === "all" ? "All" : verdictCopy[item].short}</button>
          ))}
        </div>
      </div>
      <div className="canon-list">
        {rows.map((row) => {
          const note = sortDiary(diary.filter((entry) => entry.movieId === row.movie.id))[0];
          return (
            <button className="canon-row" key={row.movie.id} onClick={() => onFilm(row.movie)} style={filmStyle(row.movie)}>
              <span className="canon-rank">{row.rank}</span>
              <PosterArt movie={row.movie} />
              <span className="canon-title"><strong>{row.movie.title}</strong><small>{row.movie.year} · {row.movie.director}</small>{note?.note ? <em>{note.note}</em> : null}</span>
              <VerdictMark verdict={row.ranked.verdict} />
              <span className="canon-score" title={row.score === null ? "Scores appear after five ranked films" : "Calculated from verdict and canon position"} aria-label={row.score === null ? "Score unavailable until five films are ranked" : `Relative score ${formatScore(row.score)}, calculated from verdict and canon position`}>{row.score === null ? "—" : formatScore(row.score)}</span>
            </button>
          );
        })}
      </div>
      {rows.length === 0 ? (
        total === 0 ? (
          <div className="empty-state">
            <h2>Nothing ranked yet</h2>
            <p>Log a finished film and choose a verdict to place it here.</p>
            <button className="primary-action" onClick={onLog}>Log a film</button>
          </div>
        ) : (
          <div className="empty-state"><h2>No films found</h2><p>Try a different title or verdict.</p></div>
        )
      ) : null}
    </div>
  );
}
