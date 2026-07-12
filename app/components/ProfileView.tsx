"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import { movieById, movies } from "@/lib/seed";
import type { AppState, Movie } from "@/lib/types";
import { filmStyle, prettyDate, sortDiary, type CanonRow } from "@/lib/ui";
import type { ConnectedSupabase } from "../SupabaseGate";
import { PosterArt } from "./media";
import { LockIcon } from "./icons";

function tasteRead(rows: Array<{ movie: Movie }>) {
  const genres = new Set(rows.flatMap((row) => row.movie.genres.map((genre) => genre.toLowerCase())));

  if (genres.has("science fiction") && (genres.has("fantasy") || genres.has("adventure"))) {
    return "Escapist, but with standards. You want impossible worlds, airtight rules, and at least one person explaining the danger very seriously.";
  }
  if (genres.has("horror") && (genres.has("comedy") || genres.has("romance"))) {
    return "You like your feelings complicated and your evenings endangered. A laugh is welcome, preferably right before something goes terribly wrong.";
  }
  if (genres.has("thriller") && genres.has("drama")) {
    return "You prefer a slow tightening of the screws. Good manners, bad motives, and a third act that ruins everyone’s week.";
  }
  if (genres.has("comedy") && genres.has("drama")) {
    return "You want the joke, then the bruise underneath it. Bonus points when everyone is dressed too well to admit they’re unraveling.";
  }
  if (genres.has("animation") || genres.has("family")) {
    return "You have no patience for the idea that wonder is just for children. Frankly, the adults could use more talking animals.";
  }
  if (genres.has("action") || genres.has("adventure")) {
    return "You respect momentum: a clear mission, a looming catastrophe, and very little time wasted finding parking.";
  }
  if (genres.has("drama") || genres.has("romance")) {
    return "You come for the people making one defensible choice after another until their lives are completely unrecognizable.";
  }

  return "Hard to reduce, which is usually a good sign. Your favorites share a mood more readily than they share a shelf.";
}

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
  const diary = sortDiary(state.diary);
  const topThree = signedOut
    ? movies.slice(0, 3).map((movie, index) => ({ movie, rank: index + 1 }))
    : canon.slice(0, 3);
  const featured = topThree[0]?.movie ?? (diary[0] ? movieById(diary[0].movieId) : movies[0]);
  const profileTasteRead = topThree.length === 3 ? tasteRead(topThree) : null;
  const tasteDecades = new Set(topThree.map((row) => Math.floor(row.movie.year / 10) * 10)).size;
  const tasteDirectors = new Set(topThree.map((row) => row.movie.director)).size;
  const displayName = profile?.displayName || (localMode && !signedOut ? "Local diary" : "Your profile");
  const username = profile?.username || (localMode && !signedOut ? "this-device" : "you");

  return (
    <div className="profile-page" style={filmStyle(featured)}>
      <section className="profile-page-hero">
        {featured.backdrop ? <img src={featured.backdrop} alt="" /> : null}
        <div className="profile-page-shade" />
        <div className="profile-page-hero-content content-wrap">
          <div className="profile-page-avatar">{displayName.slice(0, 1).toUpperCase()}</div>
          <div className="profile-page-identity">
            <h1>{displayName}</h1>
            <span>@{username}{!signedOut && !profile?.isPublic ? <span className="privacy-lock" title="Private profile"><LockIcon /><span className="sr-only">Private profile</span></span> : null}</span>
            {profile?.bio ? <blockquote>{profile.bio}</blockquote> : null}
          </div>
          <div className="profile-page-actions">
            {signedOut ? (
              <button className="primary-action" onClick={onSignIn}>Create your profile</button>
            ) : profile ? (
              <button className="primary-action" onClick={onSettings}>Edit profile</button>
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
          </div>
          {topThree.length ? (
            <div className="profile-top-three-layout">
              <div className="profile-top-three">
                {topThree.map((row) => (
                  <button key={row.movie.id} onClick={() => onFilm(row.movie)} style={filmStyle(row.movie)}>
                    <span className="profile-film-rank">{row.rank}</span>
                    <PosterArt movie={row.movie} />
                    <span><strong>{row.movie.title}</strong><small>{row.movie.year} · {row.movie.director}</small></span>
                  </button>
                ))}
              </div>
              {profileTasteRead ? (
                <aside className="profile-taste-read">
                  <span>Your cinematic tell</span>
                  <p>{profileTasteRead}</p>
                  <small>{tasteDecades} decades · {tasteDirectors} directors · zero interest in realism</small>
                </aside>
              ) : null}
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
