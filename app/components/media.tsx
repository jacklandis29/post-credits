"use client";

/* eslint-disable @next/next/no-img-element -- TMDB paths are cached metadata and rendered with designed fallbacks. */

import type { Movie, Verdict } from "@/lib/types";
import { filmStyle, verdictCopy } from "@/lib/ui";

const preloadedBackdrops = new Set<string>();

export function preloadBackdrop(movie: Movie): void {
  if (!movie.backdrop || preloadedBackdrops.has(movie.backdrop)) return;
  preloadedBackdrops.add(movie.backdrop);
  const image = new Image();
  image.decoding = "async";
  image.src = movie.backdrop;
}

export function PosterArt({ movie, eager = false }: { movie: Movie; eager?: boolean }) {
  return (
    <span
      className="poster-art"
      style={filmStyle(movie)}
      onPointerEnter={() => preloadBackdrop(movie)}
      onPointerDown={() => preloadBackdrop(movie)}
    >
      <span className="poster-fallback" aria-hidden="true">
        <span>{movie.title.slice(0, 1)}</span>
        <small>{movie.year}</small>
      </span>
      {movie.poster ? (
        <img
          src={movie.poster}
          alt={`${movie.title} poster`}
          loading={eager ? "eager" : "lazy"}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
    </span>
  );
}

export function VerdictMark({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`verdict-mark verdict-${verdict}`}>
      {verdictCopy[verdict].short}
    </span>
  );
}
