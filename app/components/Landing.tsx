"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { movies } from "@/lib/seed";
import type { Movie } from "@/lib/types";
import { PosterArt } from "./media";

export function Landing({
  onSignIn,
  onBrowse,
  onFilm,
}: {
  onSignIn: () => void;
  onBrowse: () => void;
  onFilm: (movie: Movie) => void;
}) {
  const featured = movies.slice(0, 6);
  const hero = movies[0];

  return (
    <div className="landing">
      <section className="landing-hero">
        {hero.backdrop ? (
          <img className="landing-hero-art" src={hero.backdrop} alt="" aria-hidden="true" />
        ) : null}
        <div className="landing-hero-shade" aria-hidden="true" />
        <div className="landing-hero-copy content-wrap">
          <h1>A film diary that keeps itself in order.</h1>
          <p>
            Log what you watch and answer a few head-to-head questions.
            After Credits turns your instincts into a ranked, living record
            of your taste — no stars, no scores to invent.
          </p>
          <div className="landing-actions">
            <button className="primary-action" type="button" onClick={onSignIn}>
              Start your diary
            </button>
            <button className="secondary-action" type="button" onClick={onBrowse}>
              Search films and accounts
            </button>
          </div>
        </div>
      </section>

      <section className="landing-steps content-wrap" aria-label="How it works">
        <div>
          <h2>Log</h2>
          <p>Search any film, pick the date, keep a private note while the credits are still rolling.</p>
        </div>
        <div>
          <h2>Compare</h2>
          <p>Liked it, it was okay, or not for you — then a few &ldquo;which did you like more?&rdquo; choices place it among everything you&rsquo;ve seen.</p>
        </div>
        <div>
          <h2>Revisit</h2>
          <p>A diary by month, one all-time ranking, and a score derived from your own taste instead of the crowd&rsquo;s.</p>
        </div>
      </section>

      <section className="landing-strip content-wrap" aria-label="Featured films">
        {featured.map((movie) => (
          <button key={movie.id} type="button" onClick={() => onFilm(movie)}>
            <PosterArt movie={movie} />
            <span>
              <strong>{movie.title}</strong>
              <small>{movie.year}</small>
            </span>
          </button>
        ))}
      </section>

      <section className="landing-final content-wrap">
        <p>The film ends. Your record of it doesn&rsquo;t have to.</p>
        <button className="primary-action" type="button" onClick={onSignIn}>
          Start your diary
        </button>
      </section>
    </div>
  );
}
