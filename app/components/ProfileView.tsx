"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { useState } from "react";
import { movieById, movies } from "@/lib/seed";
import type { AppState, Movie } from "@/lib/types";
import { filmStyle, prettyDate, sortDiary, type CanonRow } from "@/lib/ui";
import type { ConnectedSupabase } from "../SupabaseGate";
import { PosterArt } from "./media";

export function ProfileView({
  profile,
  state,
  canon,
  localMode,
  signedOut,
  onFilm,
  onSettings,
  onSignIn,
}: {
  profile: ConnectedSupabase["profile"] | null;
  state: AppState;
  canon: CanonRow[];
  localMode: boolean;
  signedOut: boolean;
  onFilm: (movie: Movie) => void;
  onSettings: () => void;
  onSignIn: () => void;
}) {
  const [shareStatus, setShareStatus] = useState("");
  const diary = sortDiary(state.diary);
  const topThree = signedOut
    ? movies.slice(0, 3).map((movie, index) => ({ movie, rank: index + 1 }))
    : canon.slice(0, 3);
  const featured = topThree[0]?.movie ?? (diary[0] ? movieById(diary[0].movieId) : movies[0]);
  const topGenres = [...new Set(canon.slice(0, 10).flatMap((row) => row.movie.genres))].slice(0, 3);
  const displayName = profile?.displayName || (localMode && !signedOut ? "Local diary" : "Your profile");
  const username = profile?.username || (localMode && !signedOut ? "this-device" : "you");

  async function shareProfile() {
    if (!profile?.isPublic) {
      onSettings();
      return;
    }
    const url = `${window.location.origin}/?profile=${encodeURIComponent(profile.username)}`;
    await navigator.clipboard.writeText(url);
    setShareStatus("Link copied");
    window.setTimeout(() => setShareStatus(""), 1800);
  }

  return (
    <div className="profile-page" style={filmStyle(featured)}>
      <section className="profile-page-hero">
        {featured.backdrop ? <img src={featured.backdrop} alt="" /> : null}
        <div className="profile-page-shade" />
        <div className="profile-page-hero-content content-wrap">
          <div className="profile-page-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
          <div className="profile-page-identity">
            <h1>{displayName}</h1>
            <span>@{username}{signedOut ? "" : profile?.isPublic ? " · Public" : " · Private"}</span>
            {profile?.bio ? <blockquote>{profile.bio}</blockquote> : null}
          </div>
          <div className="profile-page-actions">
            {signedOut ? (
              <button className="primary-action" onClick={onSignIn}>Create your profile</button>
            ) : profile ? (
              <>
                <button className="primary-action" onClick={() => void shareProfile()}>{shareStatus || (profile.isPublic ? "Share profile" : "Make public to share")}</button>
                <button className="secondary-action" onClick={onSettings}>Edit profile</button>
              </>
            ) : (
              <span className="quiet-copy">Stored on this device</span>
            )}
          </div>
          <dl className="profile-page-stats">
            <div><dt>Ranked</dt><dd>{signedOut ? "—" : canon.length}</dd></div>
            <div><dt>Entries</dt><dd>{signedOut ? "—" : diary.length}</dd></div>
            <div><dt>Rewatches</dt><dd>{signedOut ? "—" : diary.filter((entry) => entry.isRewatch).length}</dd></div>
          </dl>
        </div>
      </section>

      <div className="profile-page-body content-wrap">
        <section className="profile-top-three-block">
          <div className="section-heading">
            <h2>Top three</h2>
            {topGenres.length ? <span className="section-note">Mostly {topGenres.join(", ").toLowerCase()}</span> : null}
          </div>
          {topThree.length ? (
            <div className="profile-top-three">
              {topThree.map((row) => (
                <button key={row.movie.id} onClick={() => onFilm(row.movie)} style={filmStyle(row.movie)}>
                  <span className="profile-film-rank">{row.rank}</span>
                  <PosterArt movie={row.movie} />
                  <span><strong>{row.movie.title}</strong><small>{row.movie.year} · {row.movie.director}</small></span>
                </button>
              ))}
            </div>
          ) : (
            <p className="quiet-copy">Your three highest-ranked films will appear here on their own — no picking required.</p>
          )}
        </section>

        <section className="profile-diary-preview">
          <div className="section-heading"><h2>Latest watches</h2></div>
          {diary.length ? (
            <div className="poster-rail">
              {diary.slice(0, 6).map((entry) => {
                const movie = movieById(entry.movieId);
                return (
                  <button className="poster-card" key={entry.id} onClick={() => onFilm(movie)}>
                    <PosterArt movie={movie} />
                    <span className="poster-card-copy"><strong>{movie.title}</strong><small>{prettyDate(entry.watchedOn)}</small></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="quiet-copy">Your latest watches will live here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
