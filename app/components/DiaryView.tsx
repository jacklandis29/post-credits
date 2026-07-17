"use client";

import { movieById } from "@/lib/seed";
import type { AppState, DiaryEntry, Movie } from "@/lib/types";
import { filmStyle, monthKey, monthTitle, prettyDate, sortDiary, type CanonRow } from "@/lib/ui";
import { useMemo, useState } from "react";
import { DiaryEntrySheet, type DiaryEntryUpdate } from "./DiaryEntrySheet";
import { PosterArt, VerdictMark } from "./media";

export function DiaryView({
  entries,
  state,
  canon,
  busy,
  onFilm,
  onLog,
  onUpdateEntry,
  onDeleteEntry,
}: {
  entries: DiaryEntry[];
  state: AppState;
  canon: CanonRow[];
  busy: boolean;
  onFilm: (movie: Movie) => void;
  onLog: () => void;
  onUpdateEntry: (entry: DiaryEntry, update: DiaryEntryUpdate) => void;
  onDeleteEntry: (entry: DiaryEntry, removeFromCanon: boolean) => void;
}) {
  const years = useMemo(() => [...new Set(entries.map((entry) => entry.watchedOn.slice(0, 4)))].sort((a, b) => b.localeCompare(a)), [entries]);
  const [year, setYear] = useState("all");
  const [sort, setSort] = useState("watched-desc");
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [editingEntry, setEditingEntry] = useState<DiaryEntry | null>(null);
  const visibleEntries = useMemo(() => {
    const next = entries.filter((entry) => year === "all" || entry.watchedOn.startsWith(year));
    if (sort === "watched-asc") next.sort((a, b) => a.watchedOn.localeCompare(b.watchedOn) || a.createdAt.localeCompare(b.createdAt));
    else if (sort === "release-desc") next.sort((a, b) => movieById(b.movieId).year - movieById(a.movieId).year);
    else if (sort === "release-asc") next.sort((a, b) => movieById(a.movieId).year - movieById(b.movieId).year);
    else if (sort === "runtime-asc") next.sort((a, b) => (movieById(a.movieId).runtime ?? Infinity) - (movieById(b.movieId).runtime ?? Infinity));
    else if (sort === "runtime-desc") next.sort((a, b) => (movieById(b.movieId).runtime ?? -1) - (movieById(a.movieId).runtime ?? -1));
    else if (sort === "shuffle") next.sort((a, b) => seededOrder(a.id, shuffleSeed) - seededOrder(b.id, shuffleSeed));
    else return sortDiary(next);
    return next;
  }, [entries, shuffleSeed, sort, year]);
  const groups = useMemo(() => {
    if (!sort.startsWith("watched")) return [["results", visibleEntries] as [string, DiaryEntry[]]];
    const grouped = new Map<string, DiaryEntry[]>();
    visibleEntries.forEach((entry) => { const key = monthKey(entry.watchedOn); grouped.set(key, [...(grouped.get(key) ?? []), entry]); });
    return [...grouped.entries()];
  }, [sort, visibleEntries]);
  return (
    <div className="page content-wrap diary-page">
      <div className="page-heading">
        <div>
          <h1>Diary</h1>
          <p className="page-description">Every watch, in the order it happened.</p>
        </div>
        <button className="primary-action" onClick={onLog}>Log a film</button>
      </div>
      {entries.length ? <div className="collection-tools diary-tools"><div className="year-jump" aria-label="Jump to diary year"><button className={year === "all" ? "active" : ""} type="button" onClick={() => setYear("all")}>All</button>{years.map((item) => <button className={year === item ? "active" : ""} type="button" key={item} onClick={() => setYear(item)}>{item}</button>)}</div><label className="compact-select"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="watched-desc">Newest watched</option><option value="watched-asc">Oldest watched</option><option value="release-desc">Newest release</option><option value="release-asc">Oldest release</option><option value="runtime-asc">Shortest runtime</option><option value="runtime-desc">Longest runtime</option><option value="shuffle">Shuffle</option></select></label>{sort === "shuffle" ? <button className="secondary-action small" type="button" onClick={() => setShuffleSeed((seed) => seed + 1)}>Shuffle again</button> : null}</div> : null}
      {groups.map(([month, entries]) => (
        <section className="diary-month" key={month}>
          <div className="month-heading"><h2>{month === "results" ? `${year === "all" ? "All" : year} watches` : monthTitle(month)}</h2><span>{entries.length} {entries.length === 1 ? "entry" : "entries"}</span></div>
          <div className="poster-wall">
            {entries.map((entry) => {
              const movie = movieById(entry.movieId);
              const row = canon.find((item) => item.movie.id === movie.id);
              return (
                <article className="diary-card" key={entry.id} style={filmStyle(movie)}>
                  <button className="diary-poster" onClick={() => onFilm(movie)} aria-label={`${movie.title} details`}><PosterArt movie={movie} /><span className="diary-overlay">
                    <span>{prettyDate(entry.watchedOn, { month: "short", day: "numeric" })}</span>
                    <strong>{movie.title}</strong>
                    {entry.completionStatus === "dnf" ? <small>Did not finish</small> : row ? <VerdictMark verdict={row.ranked.verdict} /> : <small>Ranking unfinished</small>}
                  </span></button><button className="diary-edit" type="button" onClick={() => setEditingEntry(entry)} aria-label={`Edit ${movie.title} diary entry`}>Edit</button>
                </article>
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
      {entries.length > 0 && visibleEntries.length === 0 ? <div className="empty-state"><h2>No entries in {year}</h2><p>Choose another diary year.</p></div> : null}
      {editingEntry ? <DiaryEntrySheet entry={editingEntry} movie={movieById(editingEntry.movieId)} isOnlyWatch={state.diary.filter((entry) => entry.movieId === editingEntry.movieId).length === 1} isRanked={state.ranked.some((row) => row.movieId === editingEntry.movieId)} busy={busy} onSave={onUpdateEntry} onDelete={onDeleteEntry} onClose={() => setEditingEntry(null)} /> : null}
    </div>
  );
}

function seededOrder(value: string, seed: number): number {
  let hash = seed + 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}
