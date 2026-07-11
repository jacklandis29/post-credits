"use client";

import { movieById } from "@/lib/seed";
import type { AppState, Movie } from "@/lib/types";
import { filmStyle, prettyDate } from "@/lib/ui";
import { PosterArt } from "./media";

export function WatchlistView({
  items,
  onFilm,
  onRemove,
  onLog,
}: {
  items: AppState["watchlist"];
  onFilm: (movie: Movie) => void;
  onRemove: (movieId: number) => void;
  onLog: (movie: Movie) => void;
}) {
  return (
    <div className="page content-wrap watchlist-page">
      <div className="page-heading">
        <div>
          <h1>Watchlist</h1>
          <p className="page-description">Films you mean to watch. Logging one removes it automatically.</p>
        </div>
      </div>
      <div className="watchlist-grid">
        {items.map((item) => {
          const movie = movieById(item.movieId);
          return (
            <article className="watchlist-card" key={item.movieId} style={filmStyle(movie)}>
              <button className="watchlist-poster" onClick={() => onFilm(movie)} aria-label={`${movie.title} details`}><PosterArt movie={movie} /></button>
              <div>
                <p className="item-meta">Added {prettyDate(item.addedAt.slice(0, 10), { month: "short", day: "numeric" })}</p>
                <h2>{movie.title}</h2>
                <p>{movie.year} · {movie.director}</p>
                <div className="watchlist-actions">
                  <button className="primary-action small" onClick={() => onLog(movie)}>Log this film</button>
                  <button className="text-action" onClick={() => onRemove(movie.id)}>Remove</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {items.length === 0 ? (
        <div className="empty-state">
          <h2>Watchlist is empty</h2>
          <p>Save films from search or any film page, and they&rsquo;ll wait for you here.</p>
        </div>
      ) : null}
    </div>
  );
}
