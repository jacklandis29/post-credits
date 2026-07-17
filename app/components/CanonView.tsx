"use client";

import { formatScore } from "@/lib/ranking";
import type { DiaryEntry, Movie, Verdict } from "@/lib/types";
import { filmStyle, sortDiary, verdictCopy, type CanonRow } from "@/lib/ui";
import { useMemo, useState } from "react";
import { SearchIcon } from "./icons";
import { PosterArt, VerdictMark } from "./media";

export function CanonView({
  rows,
  diary,
  onFilm,
  onLog,
}: {
  rows: CanonRow[];
  diary: DiaryEntry[];
  onFilm: (movie: Movie) => void;
  onLog: () => void;
}) {
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<"all" | Verdict>("all");
  const [watchedYear, setWatchedYear] = useState("all");
  const [releaseDecade, setReleaseDecade] = useState("all");
  const [genre, setGenre] = useState("all");
  const [rewatched, setRewatched] = useState("all");
  const [sort, setSort] = useState("rank");
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const total = rows.length;
  const watchedYears = useMemo(() => [...new Set(diary.map((entry) => entry.watchedOn.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [diary]);
  const decades = useMemo(() => [...new Set(rows.map((row) => Math.floor(row.movie.year / 10) * 10))].sort((a, b) => b - a), [rows]);
  const genres = useMemo(() => [...new Set(rows.flatMap((row) => row.movie.genres))].sort((a, b) => a.localeCompare(b)), [rows]);
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const next = rows.filter((row) => {
      const watches = diary.filter((entry) => entry.movieId === row.movie.id);
      return (verdict === "all" || row.ranked.verdict === verdict) && (watchedYear === "all" || watches.some((entry) => entry.watchedOn.startsWith(watchedYear))) && (releaseDecade === "all" || Math.floor(row.movie.year / 10) * 10 === Number(releaseDecade)) && (genre === "all" || row.movie.genres.includes(genre)) && (rewatched === "all" || (rewatched === "yes" ? watches.some((entry) => entry.isRewatch) : !watches.some((entry) => entry.isRewatch))) && (!normalized || row.movie.title.toLowerCase().includes(normalized) || row.movie.director.toLowerCase().includes(normalized));
    });
    if (sort === "release-desc") next.sort((a, b) => b.movie.year - a.movie.year || a.rank - b.rank);
    else if (sort === "release-asc") next.sort((a, b) => a.movie.year - b.movie.year || a.rank - b.rank);
    else if (sort === "runtime-asc") next.sort((a, b) => (a.movie.runtime ?? Infinity) - (b.movie.runtime ?? Infinity) || a.rank - b.rank);
    else if (sort === "runtime-desc") next.sort((a, b) => (b.movie.runtime ?? -1) - (a.movie.runtime ?? -1) || a.rank - b.rank);
    else if (sort === "shuffle") next.sort((a, b) => seededOrder(String(a.movie.id), shuffleSeed) - seededOrder(String(b.movie.id), shuffleSeed));
    else next.sort((a, b) => a.rank - b.rank);
    return next;
  }, [diary, genre, query, releaseDecade, rewatched, rows, shuffleSeed, sort, verdict, watchedYear]);
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
        <label className="search-field"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your ranking" aria-label="Search your ranking" /></label>
        <div className="filter-tabs" aria-label="Filter by verdict">
          {(["all", "liked", "fine", "disliked"] as const).map((item) => (
            <button key={item} className={verdict === item ? "active" : ""} onClick={() => setVerdict(item)}>{item === "all" ? "All" : verdictCopy[item].short}</button>
          ))}
        </div>
      </div>
      <div className="canon-filter-grid"><label className="compact-select"><span>Watched</span><select value={watchedYear} onChange={(event) => setWatchedYear(event.target.value)}><option value="all">Any year</option>{watchedYears.map((year) => <option key={year}>{year}</option>)}</select></label><label className="compact-select"><span>Released</span><select value={releaseDecade} onChange={(event) => setReleaseDecade(event.target.value)}><option value="all">Any decade</option>{decades.map((decade) => <option key={decade} value={decade}>{decade}s</option>)}</select></label><label className="compact-select"><span>Genre</span><select value={genre} onChange={(event) => setGenre(event.target.value)}><option value="all">Any genre</option>{genres.map((item) => <option key={item}>{item}</option>)}</select></label><label className="compact-select"><span>Rewatched</span><select value={rewatched} onChange={(event) => setRewatched(event.target.value)}><option value="all">Either</option><option value="yes">Rewatched</option><option value="no">First watches</option></select></label><label className="compact-select"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="rank">Canon rank</option><option value="release-desc">Newest release</option><option value="release-asc">Oldest release</option><option value="runtime-asc">Shortest runtime</option><option value="runtime-desc">Longest runtime</option><option value="shuffle">Shuffle</option></select></label>{sort === "shuffle" ? <button className="secondary-action small" type="button" onClick={() => setShuffleSeed((seed) => seed + 1)}>Shuffle again</button> : null}</div>
      <p className="collection-result-count">Showing {visibleRows.length} of {total} films</p>
      <div className="canon-list">
        {visibleRows.map((row) => {
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
      {visibleRows.length === 0 ? (
        total === 0 ? (
          <div className="empty-state">
            <h2>Nothing ranked yet</h2>
            <p>Log a finished film and choose a verdict to place it here.</p>
            <button className="primary-action" onClick={onLog}>Log a film</button>
          </div>
        ) : (
          <div className="empty-state"><h2>No films found</h2><p>Try clearing one of the ranking filters.</p></div>
        )
      ) : null}
    </div>
  );
}

function seededOrder(value: string, seed: number): number { let hash = seed + 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); return hash >>> 0; }
