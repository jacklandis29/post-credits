"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { formatScore } from "@/lib/ranking";
import { movieById } from "@/lib/seed";
import type { DiaryEntry, Movie } from "@/lib/types";
import { filmStyle, prettyDate, type CanonRow } from "@/lib/ui";
import { PosterArt, VerdictMark } from "./media";

export function HomeView({
  latest,
  movie,
  canonRow,
  diary,
  stats,
  unfinishedMovie,
  onResume,
  onLog,
  onFilm,
  onViewDiary,
}: {
  latest?: DiaryEntry;
  movie: Movie;
  canonRow?: CanonRow;
  diary: DiaryEntry[];
  stats: { films: number; minutes: number; rewatches: number };
  unfinishedMovie?: Movie;
  onResume: () => void;
  onLog: () => void;
  onFilm: (movie: Movie) => void;
  onViewDiary: () => void;
}) {
  if (!latest) {
    return (
      <div className="home-empty content-wrap">
        <div className="home-empty-copy">
          <h1>Your diary starts with one film.</h1>
          <p>
            Log the last thing you watched. A verdict and a few quick
            comparisons will start your all-time ranking — everything after
            that builds itself.
          </p>
          <button className="primary-action" onClick={onLog}>Log your first film</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="home-hero" style={filmStyle(movie)}>
        {movie.backdrop ? <img className="hero-backdrop" src={movie.backdrop} alt="" /> : null}
        <div className="hero-shade" />
        <div className="hero-content content-wrap">
          <p className="watch-date">{prettyDate(latest.watchedOn, { month: "long", day: "numeric", year: "numeric" })}</p>
          <h1>{movie.title}</h1>
          <div className="hero-meta">
            <span>{movie.year}</span><span>{movie.director}</span>{movie.runtime ? <span>{movie.runtime} min</span> : null}
          </div>
          {latest.note ? <blockquote>&ldquo;{latest.note}&rdquo;</blockquote> : null}
          {canonRow ? (
            <div className="hero-outcome">
              <VerdictMark verdict={canonRow.ranked.verdict} />
              <div className="hero-rank"><span>Rank</span><strong>#{canonRow.rank}</strong></div>
              {canonRow.score !== null ? (
                <div
                  className="hero-score"
                  title="Calculated from verdict and canon position"
                  aria-label={`Relative score ${formatScore(canonRow.score)}, calculated from verdict and canon position`}
                >
                  <span>Score</span><strong>{formatScore(canonRow.score)}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="hero-actions">
            <button className="primary-action" onClick={onLog}>Log a film</button>
            <button className="text-action" onClick={() => onFilm(movie)}>View entry</button>
          </div>
        </div>
      </section>

      <div className="content-wrap home-body">
        {unfinishedMovie ? (
          <button className="unfinished-card" onClick={onResume}>
            <span className="unfinished-pulse" aria-hidden="true" />
            <span><small>Ranking incomplete</small><strong>{unfinishedMovie.title}</strong></span>
            <span aria-hidden="true">Continue</span>
          </button>
        ) : null}

        <section className="section-block">
          <div className="section-heading">
            <h2>Recent</h2>
            <button className="text-action" onClick={onViewDiary}>All entries</button>
          </div>
          <div className="poster-rail">
            {diary.slice(0, 6).map((entry) => {
              const item = movieById(entry.movieId);
              return (
                <button className="poster-card" key={entry.id} onClick={() => onFilm(item)}>
                  <PosterArt movie={item} />
                  <span className="poster-card-copy">
                    <strong>{item.title}</strong>
                    <small>{prettyDate(entry.watchedOn, { month: "short", day: "numeric" })}{entry.isRewatch ? " · Rewatch" : ""}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="quiet-stats" aria-label="Watching statistics">
          <div>
            <span><strong>{stats.films}</strong><small>films this year</small></span>
            <span><strong>{stats.minutes.toLocaleString()}</strong><small>minutes</small></span>
            <span><strong>{stats.rewatches}</strong><small>rewatches</small></span>
          </div>
        </section>
      </div>
    </>
  );
}
