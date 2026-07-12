"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { movieById, movies } from "@/lib/seed";
import { movieSimilarity } from "@/lib/similarity";
import type { DiaryEntry, Movie, WatchlistItem } from "@/lib/types";
import { filmStyle, prettyDate, type CanonRow } from "@/lib/ui";
import { PosterArt } from "./media";

function FilmRail({
  movies: items,
  label,
  onFilm,
}: {
  movies: Movie[];
  label: (movie: Movie) => string;
  onFilm: (movie: Movie) => void;
}) {
  return (
    <div className="poster-rail">
      {items.slice(0, 6).map((item) => (
        <button className="poster-card" key={item.id} onClick={() => onFilm(item)}>
          <PosterArt movie={item} />
          <span className="poster-card-copy">
            <strong>{item.title}</strong>
            <small>{label(item)}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

export function HomeView({
  diary,
  canon,
  watchlist,
  stats,
  unfinishedMovie,
  onResume,
  onLog,
  onFilm,
  onViewDiary,
  onViewWatchlist,
}: {
  diary: DiaryEntry[];
  canon: CanonRow[];
  watchlist: WatchlistItem[];
  stats: { films: number; minutes: number; rewatches: number };
  unfinishedMovie?: Movie;
  onResume: () => void;
  onLog: () => void;
  onFilm: (movie: Movie) => void;
  onViewDiary: () => void;
  onViewWatchlist: () => void;
}) {
  const seen = new Set(diary.map((entry) => entry.movieId));
  const liked = canon.filter((row) => row.ranked.verdict === "liked");
  const candidates = movies
    .filter((item) => !seen.has(item.id))
    .map((item) => ({
      movie: item,
      score: liked.reduce(
        (total, row) => total + movieSimilarity(item, row.movie) * Math.max(1, 7 - row.withinBucketRank),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score || right.movie.year - left.movie.year)
    .map(({ movie }) => movie);

  const recommendations = candidates.length ? candidates : movies.filter((item) => !seen.has(item.id));
  const hero = recommendations[0] ?? movies[0];
  const tasteAnchor = liked[0]?.movie;
  const watchlistMovies = watchlist.map((item) => movieById(item.movieId));
  const recent = diary.slice(0, 6).map((entry) => movieById(entry.movieId));

  return (
    <div className="discovery-home">
      <section className="discovery-hero" style={filmStyle(hero)}>
        {hero.backdrop ? <img className="discovery-hero-art" src={hero.backdrop} alt="" /> : null}
        <div className="discovery-hero-shade" />
        <div className="discovery-hero-copy content-wrap">
          <p className="discovery-kicker">{tasteAnchor ? "Picked for your taste" : "A place to start"}</p>
          <h1>{hero.title}</h1>
          <div className="hero-meta">
            <span>{hero.year}</span><span>{hero.director}</span>{hero.runtime ? <span>{hero.runtime} min</span> : null}
          </div>
          <p className="discovery-reason">
            {tasteAnchor
              ? `Because ${tasteAnchor.title} sits near the top of your canon.`
              : "Log and rank a few films and Post Credits will learn what deserves your next evening."}
          </p>
          <div className="hero-actions">
            <button className="primary-action" onClick={() => onFilm(hero)}>View film</button>
            <button className="text-action" onClick={onLog}>Log a film</button>
          </div>
        </div>
      </section>

      <div className="content-wrap discovery-body">
        {unfinishedMovie ? (
          <button className="unfinished-card" onClick={onResume}>
            <span className="unfinished-pulse" aria-hidden="true" />
            <span><small>Ranking incomplete</small><strong>{unfinishedMovie.title}</strong></span>
            <span aria-hidden="true">Continue</span>
          </button>
        ) : null}

        <section className="discovery-intro">
          <div>
            <p className="discovery-kicker">For you</p>
            <h2>Find your next film.</h2>
          </div>
          <p>Your canon becomes the signal. The more honestly you rank, the sharper these picks become.</p>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div><p className="rail-kicker">Based on your canon</p><h2>{tasteAnchor ? `Because you loved ${tasteAnchor.title}` : "Worth discovering"}</h2></div>
          </div>
          <FilmRail movies={recommendations.slice(1, 7)} label={(item) => `${item.year} · ${item.genres[0] ?? "Film"}`} onFilm={onFilm} />
        </section>

        {watchlistMovies.length ? (
          <section className="section-block">
            <div className="section-heading">
              <div><p className="rail-kicker">Already on your radar</p><h2>From your watchlist</h2></div>
              <button className="text-action" onClick={onViewWatchlist}>View all</button>
            </div>
            <FilmRail movies={watchlistMovies} label={(item) => `${item.runtime ? `${item.runtime} min · ` : ""}${item.genres[0] ?? item.year}`} onFilm={onFilm} />
          </section>
        ) : null}

        {recent.length ? (
          <section className="section-block home-recent">
            <div className="section-heading">
              <div><p className="rail-kicker">Your record</p><h2>Recently watched</h2></div>
              <button className="text-action" onClick={onViewDiary}>All entries</button>
            </div>
            <FilmRail
              movies={recent}
              label={(item) => {
                const entry = diary.find((row) => row.movieId === item.id);
                return entry ? prettyDate(entry.watchedOn, { month: "short", day: "numeric" }) : String(item.year);
              }}
              onFilm={onFilm}
            />
          </section>
        ) : null}

        <section className="quiet-stats" aria-label="Watching statistics">
          <div>
            <span><strong>{stats.films}</strong><small>films this year</small></span>
            <span><strong>{stats.minutes.toLocaleString()}</strong><small>minutes</small></span>
            <span><strong>{stats.rewatches}</strong><small>rewatches</small></span>
          </div>
        </section>
      </div>
    </div>
  );
}
