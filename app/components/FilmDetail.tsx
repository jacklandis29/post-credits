"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { formatScore } from "@/lib/ranking";
import { cacheMovies, movieById } from "@/lib/seed";
import { movieSimilarity } from "@/lib/similarity";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadCommunityMovieStats, type CommunityMovieStats } from "@/lib/supabase/data";
import type { AppState, Movie } from "@/lib/types";
import { filmStyle, prettyDate, sortDiary, verdictCopy, type CanonRow } from "@/lib/ui";
import { useEffect, useRef, useState } from "react";
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
  const filmSheetRef = useRef<HTMLDivElement>(null);
  const [film, setFilm] = useState(movie);
  const [community, setCommunity] = useState<CommunityMovieStats | null>(null);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const row = canon.find((item) => item.movie.id === movie.id);
  const history = sortDiary(state.diary.filter((entry) => entry.movieId === movie.id));
  const latest = history[0];
  const onWatchlistNow = state.watchlist.some((item) => item.movieId === movie.id);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      filmSheetRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (movie.tagline !== undefined && movie.credits !== undefined) return;
    const controller = new AbortController();
    void fetch(`/api/tmdb/movie/${movie.id}?v=2`, { signal: controller.signal })
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

  const rankEvents = (state.rankHistory ?? []).filter(
    (event) => event.movieId === movie.id,
  );
  const personalTimeline = [
    ...history.map((entry) => ({
      key: entry.id,
      date: entry.watchedOn,
      sortStamp: `${entry.watchedOn}T00:00:00`,
      title:
        entry.completionStatus === "dnf"
          ? "Did not finish"
          : entry.isRewatch
            ? "Rewatch"
            : "First watch",
      detail: null as string | null,
      note: entry.note || null,
    })),
    ...rankEvents.map((event) => ({
      key: event.id,
      date: event.createdAt.slice(0, 10),
      sortStamp: event.createdAt,
      title:
        event.rankBefore === null
          ? `Entered your ranking at #${event.rankAfter}`
          : event.rankBefore === event.rankAfter
            ? `Held at #${event.rankAfter}`
            : `Moved #${event.rankBefore} → #${event.rankAfter}`,
      detail:
        event.verdictBefore && event.verdictBefore !== event.verdictAfter
          ? `${verdictCopy[event.verdictBefore].short} → ${verdictCopy[event.verdictAfter].short}`
          : event.reason === "manual_rerank"
            ? "Re-ranked by hand"
            : null,
      note: null as string | null,
    })),
  ].sort((left, right) => right.sortStamp.localeCompare(left.sortStamp)).slice(0, 10);

  const headToHead = (state.comparisons ?? [])
    .filter(
      (duel) =>
        (duel.sessionMovieId === movie.id || duel.opponentMovieId === movie.id) &&
        duel.winnerMovieId !== null,
    )
    .map((duel) => {
      const opponentId =
        duel.sessionMovieId === movie.id ? duel.opponentMovieId : duel.sessionMovieId;
      return {
        key: duel.id,
        opponent: movieById(opponentId),
        won: duel.winnerMovieId === movie.id,
        date: duel.createdAt,
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 8);
  const headToHeadWins = headToHead.filter((duel) => duel.won).length;

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
    <div
      ref={filmSheetRef}
      className="film-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={`${film.title} details`}
      tabIndex={-1}
      style={filmStyle(film)}
    >
      <nav className="film-detail-nav" aria-label="Film page controls">
        <button className="secondary-action" onClick={onClose} aria-label="Close film details">← <span>Back</span></button>
      </nav>
      <div className="film-atmosphere">{film.backdrop ? <img src={film.backdrop} alt="" fetchPriority="high" decoding="async" /> : null}<div /></div>
      <div className="film-detail-wrap content-wrap">
        <div className="film-identity">
          <PosterArt movie={film} eager />
          <div>
            <h1>{film.title}</h1>
            <p>{film.year} · {film.director}</p>
            {film.tagline ? <blockquote className="film-tagline">{film.tagline}</blockquote> : null}
            <div className="film-actions">
              <button className="primary-action" onClick={onLog}>{row ? "Log a rewatch" : "Log this film"}</button>
              {!row ? <button className={`secondary-action watchlist-toggle${onWatchlistNow ? " active" : ""}`} onClick={onWatchlist}><span className="watchlist-toggle-icon" aria-hidden="true">{onWatchlistNow ? "✓" : "+"}</span><span>{onWatchlistNow ? "On Watchlist" : "Add to Watchlist"}</span></button> : null}
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
              <div><span>Your canon</span><h2>{row ? "Where it sits" : "Not ranked yet"}</h2></div>
              {row ? <button className="text-action" onClick={onRerank}>Re-rank</button> : null}
            </div>
            {row ? (
              <div className="personal-ranking-body">
                <div className="ranking-placement">
                  <strong>#{row.rank}</strong>
                  <span>of {canon.length} films</span>
                  <p>This is your personal all-time order.</p>
                </div>
                <div className="ranking-neighborhood" aria-label="Nearby films in your ranking">
                  {rankingNeighbors.map((neighbor) => (
                    <article className={neighbor.movie.id === movie.id ? "current" : ""} key={neighbor.movie.id}>
                      <span>#{neighbor.rank}</span><PosterArt movie={neighbor.movie} /><strong>{neighbor.movie.title}</strong>
                      {neighbor.movie.id === movie.id ? <small>This film</small> : null}
                    </article>
                  ))}
                </div>
                <div className="personal-ranking-meta">
                  <div><span>Verdict</span><VerdictMark verdict={row.ranked.verdict} /></div>
                  <div><span>Score</span><strong>{row.score === null ? "—" : formatScore(row.score)}</strong></div>
                  {latest ? <div><span>Last watched</span><strong>{prettyDate(latest.watchedOn, { month: "short", day: "numeric", year: "numeric" })}</strong></div> : null}
                </div>
                {latest?.note ? <blockquote>&ldquo;{latest.note}&rdquo;</blockquote> : null}
              </div>
            ) : (
              <p className="insight-empty">Log this film and compare it with your canon to give it a position.</p>
            )}
          </section>

          <section className="insight-card community-ranking-card">
            <div className="insight-heading"><div><span>Across Post Credits</span><h2>Community ranking</h2></div></div>
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
        {(personalTimeline.length || headToHead.length) ? (
          <div className="film-record">
            {personalTimeline.length ? (
              <section className="film-record-panel">
                <h2 className="section-label">Your history</h2>
                <div className="film-timeline">
                  {personalTimeline.map((event) => (
                    <article key={event.key}>
                      <time>{prettyDate(event.date, { month: "short", day: "numeric", year: "numeric" })}</time>
                      <div>
                        <strong>{event.title}</strong>
                        {event.detail ? <small>{event.detail}</small> : null}
                        {event.note ? <blockquote>&ldquo;{event.note}&rdquo;</blockquote> : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            {headToHead.length ? (
              <section className="film-record-panel">
                <div className="film-record-heading">
                  <h2 className="section-label">Head-to-head record</h2>
                  <span>{headToHeadWins} {headToHeadWins === 1 ? "win" : "wins"} · {headToHead.length - headToHeadWins} {headToHead.length - headToHeadWins === 1 ? "loss" : "losses"}</span>
                </div>
                <div className="head-to-head-list">
                  {headToHead.map((duel) => (
                    <div className={duel.won ? "won" : "lost"} key={duel.key}>
                      <span className="duel-result">{duel.won ? "W" : "L"}</span>
                      <PosterArt movie={duel.opponent} />
                      <span className="duel-copy">
                        <strong>{duel.won ? "Beat" : "Lost to"} {duel.opponent.title}</strong>
                        <small>{prettyDate(duel.date.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}</small>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {film.credits?.length ? (
          <section className="film-cast">
            <h2 className="section-label">Cast</h2>
            <div className="cast-strip">
              {film.credits.map((person) => (
                <figure key={person.name}>
                  <span className="cast-photo">
                    {person.profile ? (
                      <img src={person.profile} alt={person.name} loading="lazy" />
                    ) : (
                      <span aria-hidden="true">{person.name.slice(0, 1)}</span>
                    )}
                  </span>
                  <figcaption>
                    <strong>{person.name}</strong>
                    {person.character ? <small>{person.character}</small> : null}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ) : null}

        <section className="film-metadata">
          <div>
            <h2 className="section-label">About the film</h2>
            <p>{film.overview}</p>
            {film.keywords?.length ? (
              <div className="film-keywords" aria-label="Themes">
                {film.keywords.slice(0, 10).map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
            ) : null}
          </div>
          <dl>
            <div><dt>Director</dt><dd>{film.director}</dd></div>
            {film.releaseDate ? <div><dt>Released</dt><dd>{prettyDate(film.releaseDate, { month: "long", day: "numeric", year: "numeric" })}</dd></div> : null}
            <div><dt>Runtime</dt><dd>{film.runtime ? `${film.runtime} minutes` : "Unknown"}</dd></div>
            <div><dt>Genres</dt><dd>{film.genres.join(", ") || "Unknown"}</dd></div>
            {film.productionCountries?.length ? <div><dt>Country</dt><dd>{film.productionCountries.join(", ")}</dd></div> : null}
            {film.originalLanguage ? <div><dt>Language</dt><dd>{film.originalLanguage.toUpperCase()}</dd></div> : null}
          </dl>
        </section>
      </div>
    </div>
  );
}
