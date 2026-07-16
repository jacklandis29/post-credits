"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { useState, type FormEvent } from "react";
import { formatScore } from "@/lib/ranking";
import { movieById, movies } from "@/lib/seed";
import type { PublicProfileState } from "@/lib/supabase/data";
import type { Movie } from "@/lib/types";
import { canonFromState, filmStyle, prettyDate, sortDiary } from "@/lib/ui";
import type { ConnectedSupabase } from "../SupabaseGate";
import { FilmRollIcon } from "./icons";
import { PosterArt } from "./media";

export function PublicProfileSheet({
  data,
  onClose,
  onFilm,
}: {
  data: PublicProfileState;
  onClose: () => void;
  onFilm: (movie: Movie) => void;
}) {
  const canon = canonFromState(data.state);
  const diary = sortDiary(data.state.diary);
  const featured = canon[0]?.movie ?? (diary[0] ? movieById(diary[0].movieId) : movies[0]);
  const [shareStatus, setShareStatus] = useState("");

  async function share() {
    const url = `${window.location.origin}/?profile=${encodeURIComponent(data.profile.username)}`;
    await navigator.clipboard.writeText(url);
    setShareStatus("Link copied");
    window.setTimeout(() => setShareStatus(""), 1800);
  }
  return (
    <div className="public-profile-overlay" role="dialog" aria-modal="true" aria-label={`${data.profile.displayName} profile`} style={filmStyle(featured)}>
      <div className="public-profile-sheet">
        <button className="sheet-close" onClick={onClose} aria-label="Close public profile">×</button>
        <header className="public-profile-heading">
          {featured.backdrop ? <img className="public-profile-backdrop" src={featured.backdrop} alt="" /> : null}
          <div className="public-profile-hero-shade" />
          <div className="public-profile-heading-inner content-wrap">
            <div className="profile-avatar large">{(data.profile.displayName || data.profile.username).slice(0, 1).toUpperCase()}</div>
            <div className="public-profile-copy">
              <h1>{data.profile.displayName}</h1>
              <span>@{data.profile.username}</span>
              {data.profile.bio ? <blockquote>{data.profile.bio}</blockquote> : null}
            </div>
            <div className="public-profile-actions"><button className="primary-action" onClick={() => void share()}>{shareStatus || "Share profile"}</button></div>
            <dl><div><dt>Ranked</dt><dd>{canon.length}</dd></div><div><dt>Watches</dt><dd>{diary.length}</dd></div><div><dt>Rewatches</dt><dd>{diary.filter((entry) => entry.isRewatch).length}</dd></div></dl>
          </div>
        </header>
        <section className="public-profile-section content-wrap">
          <div className="section-heading"><h2>Their top films</h2><span className="section-note">Scores are relative to this person&rsquo;s own ranking</span></div>
          <div className="public-profile-canon">
            {canon.slice(0, 10).map((row) => (
              <button key={row.movie.id} onClick={() => onFilm(row.movie)} style={filmStyle(row.movie)}>
                <span>{row.rank}</span>
                <PosterArt movie={row.movie} />
                <span><strong>{row.movie.title}</strong><em>{row.movie.year} · {row.movie.director}</em></span>
                <small>{formatScore(row.score)}</small>
              </button>
            ))}
          </div>
          {canon.length === 0 ? <p className="quiet-copy">No ranked films yet.</p> : null}
        </section>
        <section className="public-profile-section content-wrap">
          <div className="section-heading"><h2>Latest watches</h2></div>
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
          {diary.length === 0 ? <p className="quiet-copy">No public diary entries yet.</p> : null}
        </section>
      </div>
    </div>
  );
}

export function ProfileSheet({
  profile,
  busy,
  error,
  onSave,
  onSignOut,
  onSignOutEverywhere,
  onDeleteAccount,
  onClose,
}: {
  profile: ConnectedSupabase["profile"];
  busy: boolean;
  error: string;
  onSave: (input: {
    displayName: string;
    bio: string;
    isPublic: boolean;
    isDiscoverable: boolean;
  }) => void;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  onDeleteAccount: (username: string) => void;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [isPublic, setIsPublic] = useState(profile.isPublic);
  const [isDiscoverable, setIsDiscoverable] = useState(profile.isDiscoverable);
  const [confirmGlobalSignOut, setConfirmGlobalSignOut] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim()) return;
    onSave({ displayName, bio, isPublic, isDiscoverable });
  }

  return (
    <div className="profile-overlay" role="dialog" aria-modal="true" aria-label="Profile and settings">
      <section className="profile-sheet">
        <div className="profile-sheet-heading">
          <div className="profile-avatar">{(displayName || profile.username).slice(0, 1).toUpperCase()}</div>
          <div><p>Edit profile</p><h1>@{profile.username}</h1></div>
          <button className="sheet-close inline" onClick={onClose} aria-label="Close profile settings">×</button>
        </div>
        <form className="profile-form" onSubmit={submit}>
          <label className="profile-field"><span>Display name</span><input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} required /></label>
          <label className="profile-field"><span>Bio <small>{bio.length}/300</small></span><textarea value={bio} maxLength={300} onChange={(event) => setBio(event.target.value)} placeholder="A line about your taste in film" /></label>
          <fieldset className="profile-privacy">
            <legend>Privacy</legend>
            <label className="setting-toggle"><span><strong>Public profile</strong><small>{profile.publicAccessApproved ? "Let people visit your diary and ranking." : "Public profiles are invite-only during the private alpha."}</small></span><input type="checkbox" checked={isPublic} disabled={!profile.publicAccessApproved} onChange={(event) => { setIsPublic(event.target.checked); if (!event.target.checked) setIsDiscoverable(false); }} /></label>
            <label className="setting-toggle"><span><strong>Discoverable</strong><small>Allow your username to appear in People search.</small></span><input type="checkbox" checked={isDiscoverable} disabled={!isPublic} onChange={(event) => setIsDiscoverable(event.target.checked)} /></label>
          </fieldset>
          <fieldset className="profile-privacy">
            <legend>Account security</legend>
            <div className="setting-toggle">
              <span><strong>Other signed-in devices</strong><small>Revoke every session if a device is lost or you notice suspicious activity.</small></span>
              <button
                className="text-action muted"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (confirmGlobalSignOut) onSignOutEverywhere();
                  else setConfirmGlobalSignOut(true);
                }}
              >
                {confirmGlobalSignOut ? "Confirm sign out everywhere" : "Sign out everywhere"}
              </button>
            </div>
          </fieldset>
          <fieldset className="profile-privacy profile-danger-zone">
            <legend>Danger zone</legend>
            <div className="setting-toggle">
              <span><strong>Delete account</strong><small>Permanently delete your profile, diary, ranking, Watchlist, and every active session.</small></span>
              <button className="text-action danger" type="button" disabled={busy} onClick={() => setShowDeleteAccount((visible) => !visible)}>Delete account</button>
            </div>
            {showDeleteAccount ? (
              <div className="profile-delete-confirmation">
                <label className="profile-field">
                  <span>Type @{profile.username} to confirm</span>
                  <input
                    type="text"
                    value={deleteConfirmation}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(event) => setDeleteConfirmation(event.target.value)}
                  />
                </label>
                <button
                  className="primary-action danger"
                  type="button"
                  disabled={busy || deleteConfirmation.trim().toLowerCase() !== profile.username.toLowerCase()}
                  onClick={() => onDeleteAccount(deleteConfirmation)}
                >
                  {busy ? "Deleting…" : "Permanently delete account"}
                </button>
              </div>
            ) : null}
          </fieldset>
          {error ? <p className="profile-error" role="alert">{error}</p> : null}
          <div className="profile-form-actions"><button className="primary-action" type="submit" disabled={busy || !displayName.trim()}>{busy ? "Saving…" : "Save changes"}</button><button className="text-action muted" type="button" onClick={onSignOut} disabled={busy}>Sign out on this device</button></div>
        </form>
      </section>
    </div>
  );
}

export function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="about-overlay" role="dialog" aria-modal="true" aria-label="About Post Credits">
      <div className="about-sheet">
        <div className="about-topbar"><FilmRollIcon /><button className="sheet-close inline" onClick={onClose} aria-label="Close">×</button></div>
        <h1>Post Credits</h1>
        <p>A personal film diary where comparisons — not star ratings — keep an honest, living record of your taste.</p>
        <div className="about-definitions">
          <div><strong>Diary</strong><span>Your chronological viewing history. Every watch, rewatch, and DNF is a separate entry.</span></div>
          <div><strong>Ranking</strong><span>Your ordered list of unique completed films. Each film holds one current position and a relative score.</span></div>
        </div>
        <hr />
        <h2>Film data</h2>
        <p>Metadata and artwork are provided by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">Visit The Movie Database ↗</a>
      </div>
    </div>
  );
}

export function ImportLocalSheet({
  entryCount,
  watchlistCount,
  busy,
  progress,
  error,
  onImport,
  onDismiss,
}: {
  entryCount: number;
  watchlistCount: number;
  busy: boolean;
  progress: number;
  error: string;
  onImport: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="about-overlay import-overlay" role="dialog" aria-modal="true" aria-label="Bring your local diary">
      <div className="about-sheet import-sheet">
        <h1>Bring your local diary</h1>
        <p>
          You logged {entryCount} {entryCount === 1 ? "film" : "films"}
          {watchlistCount ? ` and saved ${watchlistCount} to your Watchlist` : ""} on
          this device before creating an account. Import them and your diary
          follows you everywhere you sign in.
        </p>
        <ul className="import-notes">
          <li>Watch dates, notes, and DNFs come across exactly as logged.</li>
          <li>Rankings are rebuilt honestly: each imported film asks for its verdict and a few comparisons when you get to it.</li>
          <li>A backup of the local data stays in this browser.</li>
        </ul>
        {error ? <p className="profile-error" role="alert">{error}</p> : null}
        <div className="import-actions">
          <button className="primary-action" onClick={onImport} disabled={busy}>
            {busy ? `Importing ${Math.min(progress + 1, entryCount)} of ${entryCount}…` : "Import my diary"}
          </button>
          <button className="text-action muted" onClick={onDismiss} disabled={busy}>
            Keep it on this device only
          </button>
        </div>
      </div>
    </div>
  );
}
