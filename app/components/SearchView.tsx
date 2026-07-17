"use client";

/* eslint-disable @next/next/no-img-element -- avatars come from user-provided URLs with initials fallback. */

import type { PublicProfile } from "@/lib/supabase/data";
import { DISCOVERY_DECADES, TMDB_GENRES, type DiscoveryFilters } from "@/lib/tmdb/discovery";
import type { Movie } from "@/lib/types";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SearchIcon } from "./icons";
import { PosterArt } from "./media";

export function SearchView({
  query,
  movies,
  profiles,
  movieBusy,
  profileBusy,
  movieError,
  profilesAvailable,
  filterLabel,
  filters,
  browseActive,
  showFilters = true,
  onQuery,
  onFilters,
  onFilm,
  onProfile,
}: {
  query: string;
  movies: Movie[];
  profiles: PublicProfile[];
  movieBusy: boolean;
  profileBusy: boolean;
  movieError: string;
  profilesAvailable: boolean;
  filterLabel?: string | null;
  filters: DiscoveryFilters;
  browseActive: boolean;
  showFilters?: boolean;
  onQuery: (value: string) => void;
  onFilters: (filters: DiscoveryFilters) => void;
  onFilm: (movie: Movie) => void;
  onProfile: (profile: PublicProfile) => void;
}) {
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeResult, setActiveResult] = useState(-1);
  const searching = movieBusy || profileBusy;
  const ready = query.trim().length >= 2 || browseActive;
  const resultCount = movies.length + profiles.length;
  const inputHint = ready ? `${resultCount} result${resultCount === 1 ? "" : "s"}` : "Movies & people";

  const resultLabels = useMemo(
    () => [
      ...profiles.map((profile) => `${profile.displayName}, @${profile.username}`),
      ...movies.map((movie) => `${movie.title}, ${movie.year}`),
    ],
    [movies, profiles],
  );

  function moveToResult(index: number) {
    if (!resultLabels.length) return;
    const next = (index + resultLabels.length) % resultLabels.length;
    setActiveResult(next);
    resultRefs.current[next]?.focus();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" || !resultLabels.length) return;
    event.preventDefault();
    moveToResult(0);
  }

  function handleResultKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveToResult(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveToResult(index - 1);
    }
  }

  return (
    <div className="page content-wrap search-page">
      <div className="search-stage">
        <div className="search-title-block">
          <h1>{filterLabel ? `More from ${filterLabel}.` : "Find your next film."}</h1>
          {filterLabel ? <p>Following a thread from the film page. Type anything to start a new search.</p> : showFilters ? <p>Search a title, or browse by genre and decade when you don&rsquo;t have one in mind.</p> : null}
        </div>

        <section className="unified-search" aria-label="Search movies and people">
          <label className="unified-search-input">
            <SearchIcon />
            <input
              autoFocus
              data-modal-autofocus
              value={query}
              onChange={(event) => {
                setActiveResult(-1);
                onQuery(event.target.value);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="Search movies or people"
              aria-label="Search movies and people"
              aria-controls="unified-search-results"
            />
            {query ? (
              <button
                className="search-clear"
                type="button"
                onClick={() => onQuery("")}
                aria-label="Clear search"
              >
                Clear
              </button>
            ) : null}
            {searching ? <span className="search-spinner" aria-label="Searching" /> : null}
          </label>

          {showFilters ? (
            <div className="search-filter-row" aria-label="Film discovery filters">
              <label className="compact-select"><span>Genre</span><select value={filters.genre} onChange={(event) => onFilters({ ...filters, genre: event.target.value })}><option value="all">All genres</option>{TMDB_GENRES.map((genre) => <option key={genre.id} value={genre.id}>{genre.name}</option>)}</select></label>
              <label className="compact-select"><span>Decade</span><select value={filters.decade} onChange={(event) => onFilters({ ...filters, decade: event.target.value })}><option value="all">All decades</option>{DISCOVERY_DECADES.map((decade) => <option key={decade} value={decade}>{decade}s</option>)}</select></label>
              <label className="compact-select"><span>Order</span><select value={filters.sort} onChange={(event) => onFilters({ ...filters, sort: event.target.value as DiscoveryFilters["sort"] })}><option value="popularity">Most popular</option><option value="newest">Newest releases</option></select></label>
            </div>
          ) : null}

          <div className="search-status" aria-live="polite">
            <span>{searching ? "Searching…" : inputHint}</span>
            {ready && resultCount > 0 ? <span className="search-key-hint">↑↓ to move · enter to open</span> : null}
          </div>

          <div
            className="unified-search-results"
            id="unified-search-results"
            aria-busy={searching}
          >
            {!ready ? (
              <div className="search-prompt">
                <span className="search-prompt-icon"><SearchIcon /></span>
                <div>
                  <strong>Search everything</strong>
                  <p>Try a title, director, name, or username.</p>
                </div>
              </div>
            ) : (
              <>
                {profiles.length ? (
                  <div className="unified-result-group">
                    <div className="unified-result-heading">
                      <span>People</span>
                      <span>{profiles.length}</span>
                    </div>
                    {profiles.map((profile, index) => (
                      <button
                        className={`unified-result-row person-result${activeResult === index ? " active" : ""}`}
                        type="button"
                        key={profile.id}
                        ref={(element) => { resultRefs.current[index] = element; }}
                        onFocus={() => setActiveResult(index)}
                        onKeyDown={(event) => handleResultKeyDown(event, index)}
                        onClick={() => onProfile(profile)}
                      >
                        {profile.avatarUrl ? (
                          <img className="search-avatar" src={profile.avatarUrl} alt="" />
                        ) : (
                          <span className="search-avatar">{(profile.displayName || profile.username).slice(0, 1).toUpperCase()}</span>
                        )}
                        <span className="unified-result-copy">
                          <strong>{profile.displayName}</strong>
                          <small>@{profile.username}{profile.bio ? ` · ${profile.bio}` : ""}</small>
                        </span>
                        <span className="result-kind">Profile</span>
                        <span className="result-arrow" aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {movies.length ? (
                  <div className="unified-result-group">
                    <div className="unified-result-heading">
                      <span>Movies</span>
                      <span>{movies.length}</span>
                    </div>
                    {movies.map((movie, movieIndex) => {
                      const index = profiles.length + movieIndex;
                      return (
                        <button
                          className={`unified-result-row movie-result${activeResult === index ? " active" : ""}`}
                          type="button"
                          key={movie.id}
                          ref={(element) => { resultRefs.current[index] = element; }}
                          onFocus={() => setActiveResult(index)}
                          onKeyDown={(event) => handleResultKeyDown(event, index)}
                          onClick={() => onFilm(movie)}
                        >
                          <PosterArt movie={movie} />
                          <span className="unified-result-copy">
                            <strong>{movie.title}</strong>
                            <small>{movie.releaseDate || movie.year}{movie.originalTitle && movie.originalTitle !== movie.title ? ` · ${movie.originalTitle}` : ""}{movie.genres[0] ? ` · ${movie.genres[0]}` : ""}{movie.director ? ` · ${movie.director}` : ""}</small>
                          </span>
                          <span className="result-kind">Movie</span>
                          <span className="result-arrow" aria-hidden="true">→</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {searching && resultCount === 0 ? (
                  <div className="unified-search-loading" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}

                {!searching && resultCount === 0 ? (
                  <div className="unified-search-empty">
                    <span>{query.trim() ? `No results for “${query.trim()}”` : "No films match these filters"}</span>
                    <p>{movieError || (profilesAvailable ? "Check the spelling or broaden the genre or decade." : "Try another genre, decade, or title.")}</p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function QuickSearchModal({
  onClose,
  onViewAll,
  ...searchProps
}: Parameters<typeof SearchView>[0] & {
  onClose: () => void;
  onViewAll: () => void;
}) {
  return (
    <div
      className="quick-search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quick search"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="quick-search-modal">
        <div className="quick-search-heading">
          <div><span>Quick search</span><strong>Find a film or person</strong></div>
          <button className="sheet-close inline" type="button" onClick={onClose} aria-label="Close quick search">×</button>
        </div>
        <SearchView {...searchProps} showFilters={false} browseActive={false} />
        <button className="quick-search-view-all" type="button" onClick={onViewAll}>
          Browse the full search page <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
