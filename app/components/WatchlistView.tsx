"use client";

import { movieById } from "@/lib/seed";
import type { AppState, Movie } from "@/lib/types";
import { filmStyle, prettyDate } from "@/lib/ui";
import { useMemo, useState } from "react";
import { SearchIcon } from "./icons";
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("added-desc");
  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const next = items.filter((item) => movieById(item.movieId).title.toLowerCase().includes(normalizedQuery));
    if (sort === "title") next.sort((a, b) => movieById(a.movieId).title.localeCompare(movieById(b.movieId).title));
    else if (sort === "release-desc") next.sort((a, b) => movieById(b.movieId).year - movieById(a.movieId).year);
    else if (sort === "release-asc") next.sort((a, b) => movieById(a.movieId).year - movieById(b.movieId).year);
    else if (sort === "runtime-asc") next.sort((a, b) => (movieById(a.movieId).runtime ?? Infinity) - (movieById(b.movieId).runtime ?? Infinity));
    else if (sort === "runtime-desc") next.sort((a, b) => (movieById(b.movieId).runtime ?? -1) - (movieById(a.movieId).runtime ?? -1));
    else next.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return next;
  }, [items, query, sort]);

  function pickRandom() {
    if (!visibleItems.length) return;
    const item = visibleItems[Math.floor(Math.random() * visibleItems.length)];
    onFilm(movieById(item.movieId));
  }

  return (
    <div className="page content-wrap watchlist-page">
      <div className="page-heading">
        <div>
          <h1>Watchlist</h1>
          <p className="page-description">Films you mean to watch. Logging one removes it automatically.</p>
        </div>
      </div>
      {items.length ? (
        <div className="collection-tools watchlist-tools">
          <label className="search-field"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your watchlist" aria-label="Search your watchlist" /></label>
          <label className="compact-select"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="added-desc">Recently added</option><option value="title">Title</option><option value="release-desc">Newest release</option><option value="release-asc">Oldest release</option><option value="runtime-asc">Shortest runtime</option><option value="runtime-desc">Longest runtime</option></select></label>
          <button className="primary-action pick-random" type="button" onClick={pickRandom} disabled={!visibleItems.length}>Pick something for me</button>
        </div>
      ) : null}
      <div className="watchlist-grid">
        {visibleItems.map((item) => {
          const movie = movieById(item.movieId);
          return (
            <article className="watchlist-card" key={item.movieId} style={filmStyle(movie)}>
              <button className="watchlist-poster" onClick={() => onFilm(movie)} aria-label={`${movie.title} details`}><PosterArt movie={movie} /></button>
              <div>
                <p className="item-meta">Added {prettyDate(item.addedAt.slice(0, 10), { month: "short", day: "numeric" })}</p>
                <h2>{movie.title}</h2>
                <p>{movie.year} · {movie.director}{movie.runtime ? ` · ${movie.runtime} min` : ""}</p>
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
      {items.length > 0 && visibleItems.length === 0 ? <div className="empty-state"><h2>No films found</h2><p>Try a different watchlist search.</p></div> : null}
    </div>
  );
}
