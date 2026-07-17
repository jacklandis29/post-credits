"use client";

/* eslint-disable @next/next/no-img-element -- Recap artwork uses cached TMDB paths with designed fallbacks. */

import { useMemo, useState } from "react";
import { movieById } from "@/lib/seed";
import type { AppState, DiaryEntry, Movie } from "@/lib/types";
import { filmStyle, prettyDate, sortDiary, type CanonRow } from "@/lib/ui";
import { PosterArt } from "./media";

type Count = { label: string; value: number };

function counts(values: string[], limit = 8): Count[] {
  const tally = new Map<string, number>();
  values.filter(Boolean).forEach((value) => tally.set(value, (tally.get(value) ?? 0) + 1));
  return [...tally.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function Breakdown({ title, rows }: { title: string; rows: Count[] }) {
  const max = rows[0]?.value ?? 1;
  return (
    <section className="stats-breakdown">
      <h2>{title}</h2>
      {rows.length ? <div>{rows.map((row) => (
        <div className="stats-bar" key={row.label}>
          <span><strong>{row.label}</strong><small>{row.value}</small></span>
          <i style={{ width: `${Math.max(6, row.value / max * 100)}%` }} />
        </div>
      ))}</div> : <p className="quiet-copy">Not enough history yet.</p>}
    </section>
  );
}

function moviesFor(entries: DiaryEntry[]): Movie[] {
  return entries.map((entry) => movieById(entry.movieId));
}

export function InsightsView({
  state,
  canon,
  onFilm,
}: {
  state: AppState;
  canon: CanonRow[];
  onFilm: (movie: Movie) => void;
}) {
  const completed = useMemo(() => sortDiary(state.diary.filter((entry) => entry.completionStatus === "completed")), [state.diary]);
  const years = useMemo(() => [...new Set(completed.map((entry) => Number(entry.watchedOn.slice(0, 4))))].sort((a, b) => b - a), [completed]);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(years.includes(currentYear) ? currentYear : years[0] ?? currentYear);
  const yearEntries = completed.filter((entry) => entry.watchedOn.startsWith(String(year)));
  const yearMovies = moviesFor(yearEntries);
  const allMovies = moviesFor(completed);
  const uniqueYearFilms = new Set(yearEntries.map((entry) => entry.movieId)).size;
  const minutes = yearMovies.reduce((sum, movie) => sum + (movie.runtime ?? 0), 0);
  const rewatches = yearEntries.filter((entry) => entry.isRewatch).length;
  const topFilm = canon.find((row) => yearEntries.some((entry) => entry.movieId === row.movie.id));
  const favoriteDirector = counts(yearMovies.flatMap((movie) => movie.director.split(/\s*(?:&|,)\s*/)), 1)[0];
  const favoriteGenre = counts(yearMovies.flatMap((movie) => movie.genres), 1)[0];
  const countries = counts(allMovies.flatMap((movie) => movie.productionCountries ?? []));
  const decades = counts(allMovies.map((movie) => `${Math.floor(movie.year / 10) * 10}s`));
  const months = Array.from({ length: 12 }, (_, month) => ({
    label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(2024, month, 1)),
    value: yearEntries.filter((entry) => Number(entry.watchedOn.slice(5, 7)) === month + 1).length,
  }));
  const monthMax = Math.max(1, ...months.map((month) => month.value));

  const chronological = [...completed].reverse();
  const midpoint = Math.ceil(chronological.length / 2);
  const earlyGenres = counts(moviesFor(chronological.slice(0, midpoint)).flatMap((movie) => movie.genres), 20);
  const lateGenres = counts(moviesFor(chronological.slice(midpoint)).flatMap((movie) => movie.genres), 20);
  const drift = [...new Set([...earlyGenres, ...lateGenres].map((row) => row.label))]
    .map((label) => ({
      label,
      change: (lateGenres.find((row) => row.label === label)?.value ?? 0) - (earlyGenres.find((row) => row.label === label)?.value ?? 0),
    }))
    .sort((left, right) => Math.abs(right.change) - Math.abs(left.change));
  const toward = drift.find((item) => item.change > 0);
  const away = drift.find((item) => item.change < 0);

  const recap = `${year} in film: ${yearEntries.length} watches, ${uniqueYearFilms} films, ${minutes.toLocaleString()} minutes${topFilm ? `, with ${topFilm.movie.title} at the top` : ""}.`;
  const [shareStatus, setShareStatus] = useState("");
  async function shareRecap() {
    const canShare = typeof navigator.share === "function";
    if (canShare) await navigator.share({ title: `${year} in review · Post Credits`, text: recap, url: window.location.href });
    else await navigator.clipboard.writeText(recap);
    setShareStatus(canShare ? "Shared" : "Recap copied");
    window.setTimeout(() => setShareStatus(""), 1800);
  }

  return (
    <div className="page content-wrap insights-page">
      <div className="page-heading insights-heading">
        <div><h1>Stats</h1><p className="page-description">The shape of your watching, not just the count.</p></div>
        {years.length ? <label>Year <select value={year} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item}>{item}</option>)}</select></label> : null}
      </div>

      <section className="year-recap" style={topFilm ? filmStyle(topFilm.movie) : undefined}>
        {topFilm?.movie.backdrop ? <img src={topFilm.movie.backdrop} alt="" /> : null}
        <div className="year-recap-shade" />
        <div className="year-recap-content">
          <span>{year} in review</span>
          <h2>{yearEntries.length ? "A year measured in films." : "Your year is waiting."}</h2>
          <div className="year-recap-numbers"><strong>{yearEntries.length}<small>watches</small></strong><strong>{uniqueYearFilms}<small>films</small></strong><strong>{minutes.toLocaleString()}<small>minutes</small></strong><strong>{rewatches}<small>rewatches</small></strong></div>
          {topFilm ? <button className="year-top-film" onClick={() => onFilm(topFilm.movie)}><PosterArt movie={topFilm.movie} /><span><small>Highest-ranked watch</small><strong>{topFilm.movie.title}</strong><em>#{topFilm.rank} in your canon</em></span></button> : null}
          <div className="year-recap-tells">
            {favoriteDirector ? <span>Most watched director <strong>{favoriteDirector.label}</strong></span> : null}
            {favoriteGenre ? <span>Defining genre <strong>{favoriteGenre.label}</strong></span> : null}
          </div>
          <button className="primary-action" disabled={!yearEntries.length} onClick={() => void shareRecap()}>{shareStatus || "Share my year"}</button>
        </div>
      </section>

      <section className="stats-overview" aria-label="All-time watching totals">
        <div><strong>{completed.length}</strong><span>watches</span></div>
        <div><strong>{new Set(completed.map((entry) => entry.movieId)).size}</strong><span>distinct films</span></div>
        <div><strong>{allMovies.reduce((sum, movie) => sum + (movie.runtime ?? 0), 0).toLocaleString()}</strong><span>minutes</span></div>
        <div><strong>{state.reviews.length}</strong><span>reviews</span></div>
      </section>

      <section className="monthly-chart">
        <div className="section-heading"><h2>Films per month</h2><span className="section-note">{year}</span></div>
        <div>{months.map((month) => <span key={month.label}><i style={{ height: `${Math.max(month.value ? 10 : 2, month.value / monthMax * 100)}%` }} /><strong>{month.value || ""}</strong><small>{month.label}</small></span>)}</div>
      </section>

      <div className="stats-grid">
        <Breakdown title="Directors" rows={counts(allMovies.flatMap((movie) => movie.director.split(/\s*(?:&|,)\s*/)))} />
        <Breakdown title="Genres" rows={counts(allMovies.flatMap((movie) => movie.genres))} />
        <Breakdown title="Countries" rows={countries} />
        <Breakdown title="Decades" rows={decades} />
      </div>

      <section className="taste-drift">
        <span>Taste drift</span>
        <h2>{toward ? `You are moving toward ${toward.label.toLowerCase()}.` : "Your taste is still taking shape."}</h2>
        <p>{away ? `${away.label} has receded while your more recent watches pull elsewhere.` : "Log across a few seasons and the change in your viewing will show up here."}</p>
        {completed[0] ? <small>Based on watches from {prettyDate(chronological[0].watchedOn)} through {prettyDate(completed[0].watchedOn)}.</small> : null}
      </section>
    </div>
  );
}
