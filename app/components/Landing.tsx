"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { movies } from "@/lib/seed";
import type { Movie } from "@/lib/types";
import { filmStyle } from "@/lib/ui";
import { PosterArt } from "./media";

const moods = [
  { label: "Something gripping", movie: movies[8] },
  { label: "Under two hours", movie: movies[3] },
  { label: "A modern classic", movie: movies[4] },
  { label: "Surprise me", movie: movies[6] },
];

export function Landing({
  onSignIn,
  onBrowse,
  onFilm,
}: {
  onSignIn: () => void;
  onBrowse: () => void;
  onFilm: (movie: Movie) => void;
}) {
  const hero = movies[0];
  const active = movies.slice(1, 7);

  return (
    <div className="landing discovery-home">
      <section className="discovery-hero landing-discovery-hero" style={filmStyle(hero)}>
        {hero.backdrop ? <img className="discovery-hero-art" src={hero.backdrop} alt="" aria-hidden="true" /> : null}
        <div className="discovery-hero-shade" aria-hidden="true" />
        <div className="discovery-hero-copy content-wrap">
          <p className="discovery-kicker">Your next favorite is out there</p>
          <h1>What should you watch tonight?</h1>
          <p className="discovery-reason">Explore films now. Build a canon and the recommendations become entirely your own.</p>
          <div className="landing-actions">
            <button className="primary-action" type="button" onClick={onBrowse}>Search films</button>
            <button className="secondary-action" type="button" onClick={onSignIn}>Start your canon</button>
          </div>
          <div className="mood-picker" aria-label="Browse by mood">
            {moods.map(({ label, movie }) => (
              <button key={label} type="button" onClick={() => onFilm(movie)}>{label}<span aria-hidden="true">↗</span></button>
            ))}
          </div>
        </div>
      </section>

      <div className="content-wrap discovery-body landing-discovery-body">
        <section className="discovery-intro">
          <div><p className="discovery-kicker">On Post Credits</p><h2>See what people are watching.</h2></div>
          <p>No crowd scores. No popularity contest. Just films passing through people&rsquo;s diaries right now.</p>
        </section>

        <section className="section-block">
          <div className="section-heading"><div><p className="rail-kicker">Recently watched</p><h2>In the community&rsquo;s diaries</h2></div></div>
          <div className="poster-rail">
            {active.map((movie) => (
              <button className="poster-card" key={movie.id} type="button" onClick={() => onFilm(movie)}>
                <PosterArt movie={movie} />
                <span className="poster-card-copy"><strong>{movie.title}</strong><small>{movie.year} · {movie.genres[0]}</small></span>
              </button>
            ))}
          </div>
        </section>

        <section className="taste-promise">
          <div>
            <p className="discovery-kicker">Yours before theirs</p>
            <h2>Recommendations shaped by your taste—not everyone else&rsquo;s ratings.</h2>
          </div>
          <div className="taste-steps">
            <span><strong>01</strong>Log what you watch</span>
            <span><strong>02</strong>Compare what you loved</span>
            <span><strong>03</strong>Discover what comes next</span>
          </div>
          <button className="primary-action" type="button" onClick={onSignIn}>Start your canon</button>
        </section>
      </div>
    </div>
  );
}
