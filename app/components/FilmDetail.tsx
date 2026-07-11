"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { formatScore } from "@/lib/ranking";
import { cacheMovies } from "@/lib/seed";
import { movieSimilarity } from "@/lib/similarity";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCommunityMovieStats, type CommunityMovieStats } from "@/lib/supabase/data";
import type { AppState, Movie } from "@/lib/types";
import { filmStyle, prettyDate, sortDiary, type CanonRow } from "@/lib/ui";
import { useEffect, useState } from "react";
import { PosterArt, VerdictMark } from "./media";

export function FilmDetail({
  movie,
  state,
  canon,
  onClose,
  onLog,
  onRerank,
  onWatchlist,
}: {
  movie: Movie;
  state: AppState;
  canon: CanonRow[];
  onClose: () => void;
  onLog: () => void;
  onRerank: () => void;
  onWatchlist: () => void;
}) {
  const [film, setFilm] = useState(movie);
  const [community, setCommunity] = useState<CommunityMovieStats | null>(null);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const row = canon.find((item) => item.movie.id === movie.id);
  const history = sortDiary(state.diary.filter((entry) => entry.movieId === movie.id));
  const latest = history[0];
  const onWatchlistNow = state.watchlist.some((item) => item.movieId === movie.id);

  useEffect(() => {
    if (movie.tagline !== undefined) return;
    const controller = new AbortController();
    void fetch(`/api/tmdb/movie/${movie.id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as { movie?: Movie };
        return payload.movie ?? null;
      })
      .then((detail) => {
        if (!detail) return;
        cacheMovies([detail]);
        setFilm(detail);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
      });
    return () => controller.abort();
  }, [movie]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    void loadCommunityMovieStats(getSupabaseBrowserClient(), movie.id)
      .then((stats) => {
        if (!cancelled) setCommunity(stats);
      })
      .catch(() => {
        if (!cancelled) setCommunity(null);
      })
      .finally(() => {
        if (!cancelled) setCommunityLoaded(true);
      });
    return () => { cancelled = true; };
  }, [movie.id]);

  const rankingNeighbors = row
    ? canon.slice(Math.max(0, row.rank - 2), Math.min(canon.length, row.rank + 1))
    : [];
  const tasteEvidence = canon
    .filter((item) => item.movie.id !== movie.id)
    .map((item) => ({ ...item, similarity: movieSimilarity(film, item.movie) }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 3);
  const similarityTotal = tasteEvidence.reduce((sum, item) => sum + item.similarity, 0);
  const tasteWeight = similarityTotal > 0
    ? tasteEvidence.reduce((sum, item) => {
        const verdictWeight = item.ranked.verdict === "liked" ? 1 : item.ranked.verdict === "fine" ? 0.55 : 0.1;
        return sum + item.similarity * verdictWeight;
      }, 0) / similarityTotal
    : null;
  const tasteSignal = canon.length < 5 || tasteWeight === null
    ? "Needs more history"
    : tasteWeight >= 0.72
      ? "Looks like a strong fit"
      : tasteWeight >= 0.46
        ? "Could go either way"
        : "Probably not your thing";

  return (
    <div className="film-sheet" role="dialog" aria-modal="true" aria-label={`${film.title} details`} style={filmStyle(film)}>
      <nav className="film-detail-nav" aria-label="Film page controls">
        <button className="secondary-action" onClick={onClose} aria-label="Close film details">← <span>Back</span></button>
      </nav>
      <div className="film-atmosphere">{film.backdrop ? <img src={film.backdrop} alt="" /> : null}<div /></div>
      <div className="film-detail-wrap content-wrap">
        <div className="film-identity">
          <PosterArt movie={film} eager />
          <div>
            <h1>{film.title}</h1>
            <p>{film.year} · {film.director}</p>
            {film.tagline ? <blockquote className="film-tagline">{film.tagline}</blockquote> : null}
            <div className="film-actions">
              <button className="primary-action" onClick={onLog}>{row ? "Log a rewatch" : "Log this film"}</button>
              {!row ? <button className="secondary-action" onClick={onWatchlist}>{onWatchlistNow ? "On Watchlist ✓" : "Add to Watchlist"}</button> : null}
            </div>
          </div>
        </div>
        <section className="film-link-bar" aria-label="Film links">
          {film.trailerUrl ? <a href={film.trailerUrl} target="_blank" rel="noreferrer">Watch trailer <span aria-hidden="true">↗</span></a> : null}
          {film.imdbId ? <a href={`https://www.imdb.com/title/${film.imdbId}/`} target="_blank" rel="noreferrer">IMDb <span aria-hidden="true">↗</span></a> : null}
          <a href={`https://www.themoviedb.org/movie/${film.id}`} target="_blank" rel="noreferrer">TMDB <span aria-hidden="true">↗</span></a>
        </section>
        <div className="film-insights">
          <section className="insight-card personal-ranking-card">
            <div className="insight-heading">
              <div><span>Your ranking</span><h2>{row ? `#${row.rank} of ${canon.length}` : "Not ranked yet"}</h2></div>
              {row ? <button className="text-action" onClick={onRerank}>Re-rank</button> : null}
            </div>
            {row ? (
              <div className="personal-ranking-body">
                <div className="personal-ranking-summary">
                  <VerdictMark verdict={row.ranked.verdict} />
                  <div><span>Score</span><strong>{row.score === null ? "—" : formatScore(row.score)}</strong></div>
                  {latest ? <small>Watched {prettyDate(latest.watchedOn, { month: "short", day: "numeric", year: "numeric" })}</small> : null}
                </div>
                <div className="ranking-neighborhood" aria-label="Nearby films in your ranking">
                  {rankingNeighbors.map((neighbor) => (
                    <article className={neighbor.movie.id === movie.id ? "current" : ""} key={neighbor.movie.id}>
                      <span>#{neighbor.rank}</span><PosterArt movie={neighbor.movie} /><strong>{neighbor.movie.title}</strong>
                    </article>
                  ))}
                </div>
                {latest?.note ? <blockquote>&ldquo;{latest.note}&rdquo;</blockquote> : null}
              </div>
            ) : (
              <p className="insight-empty">Log this film and compare it with your canon to give it a position.</p>
            )}
          </section>

          <section className="insight-card community-ranking-card">
            <div className="insight-heading"><div><span>Across After Credits</span><h2>Community ranking</h2></div></div>
            {!isSupabaseConfigured ? <p className="insight-empty">Community context appears when the app is connected.</p> : !communityLoaded ? <p className="insight-empty">Reading public rankings…</p> : community && community.rankingCount >= 3 ? (
              <div className="community-stats">
                <div><strong>Top {community.averageTopPercent}%</strong><span>average placement</span></div>
                <div><strong>{community.averageScore === null ? "—" : formatScore(community.averageScore)}</strong><span>average score</span></div>
                <div><strong>{community.likedPercent}%</strong><span>liked it</span></div>
                <p>Based on {community.rankingCount} public {community.rankingCount === 1 ? "ranking" : "rankings"}.</p>
              </div>
            ) : (
              <p className="insight-empty">Not enough public rankings yet. This will become meaningful after three people place it.</p>
            )}
          </section>

          <section className="insight-card taste-match-card">
            <div className="insight-heading"><div><span>For you</span><h2>Taste match</h2></div><small>Early signal</small></div>
            <strong className="taste-signal">{row ? "Your ranking is the signal" : tasteSignal}</strong>
            <p>{tasteEvidence.length
              ? `${row ? "Closest in your canon" : "Based on nearby films in your canon"}: ${tasteEvidence.map((item) => item.movie.title).join(", ")}.`
              : "Keep ranking films and this page will learn what tends to work for you."}</p>
          </section>
        </div>
        <section className="film-metadata">
          <div>
            <h2 className="section-label">About the film</h2>
            <p>{film.overview}</p>
          </div>
          <dl>
            <div><dt>Director</dt><dd>{film.director}</dd></div>
            <div><dt>Runtime</dt><dd>{film.runtime ? `${film.runtime} minutes` : "Unknown"}</dd></div>
            <div><dt>Genres</dt><dd>{film.genres.join(", ") || "Unknown"}</dd></div>
            {film.cast?.length ? <div><dt>Cast</dt><dd>{film.cast.slice(0, 8).join(", ")}</dd></div> : null}
            {film.originalLanguage ? <div><dt>Language</dt><dd>{film.originalLanguage.toUpperCase()}</dd></div> : null}
          </dl>
        </section>
      </div>
    </div>
  );
}
