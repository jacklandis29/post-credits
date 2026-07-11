import type { Movie } from "./types";

function tokens(movie: Movie): Set<string> {
  return new Set(
    [
      ...movie.genres,
      ...(movie.keywords ?? []),
      ...movie.director.split(/\s*&\s*/g),
    ]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function movieSimilarity(left: Movie, right: Movie): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) intersection += 1;
  });
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}
