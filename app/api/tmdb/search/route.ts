import { beginTmdbRequest, tmdbRequestIdentity } from "@/lib/tmdb/limit";
import { logServerError } from "@/lib/server/log";
import { TMDB_GENRES } from "@/lib/tmdb/discovery";

const TMDB_ORIGIN = "https://api.themoviedb.org/3";
const IMAGE_ORIGIN = "https://image.tmdb.org/t/p";

type TmdbMovie = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  adult?: boolean;
  genre_ids?: number[];
  popularity?: number;
};

type TmdbSearchResponse = {
  results?: TmdbMovie[];
};

function response(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

async function tmdbFetch(url: URL, attempt = 0): Promise<Response> {
  const token = process.env.TMDB_API_TOKEN;
  const key = process.env.TMDB_API_KEY;
  if (!token && !key) {
    return new Response(null, { status: 503 });
  }
  if (key) url.searchParams.set("api_key", key);

  const upstream = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(5_000),
  });

  if (upstream.status === 429 && attempt === 0) {
    const retryAfter = Number(upstream.headers.get("retry-after") ?? "1");
    const boundedDelay = Math.min(Math.max(retryAfter, 0.25), 2) * 1_000;
    await new Promise((resolve) => setTimeout(resolve, boundedDelay));
    return tmdbFetch(url, attempt + 1);
  }
  return upstream;
}

export async function GET(request: Request) {
  const parameters = new URL(request.url).searchParams;
  const query = parameters.get("q")?.trim() ?? "";
  const genreValue = parameters.get("genre") ?? "all";
  const decadeValue = parameters.get("decade") ?? "all";
  const sort = parameters.get("sort") === "newest" ? "newest" : "popularity";
  const genreId = genreValue === "all" ? null : Number(genreValue);
  const decade = decadeValue === "all" ? null : Number(decadeValue);
  const validGenre = genreId === null || TMDB_GENRES.some((genre) => genre.id === genreId);
  const validDecade = decade === null || (Number.isInteger(decade) && decade >= 1900 && decade <= 2020 && decade % 10 === 0);
  if (query.length > 120 || (query.length > 0 && query.length < 2) || !validGenre || !validDecade) {
    return response({ results: [] }, query.length > 120 || !validGenre || !validDecade ? 400 : 200);
  }
  const release = beginTmdbRequest(
    `search:${tmdbRequestIdentity(request)}`,
    { limit: 30 },
  );
  if (!release) {
    return response(
      { error: "Film search is temporarily unavailable", results: [] },
      429,
      { "cache-control": "no-store", "retry-after": "10" },
    );
  }

  try {
    const url = new URL(`${TMDB_ORIGIN}/${query ? "search/movie" : "discover/movie"}`);
    if (query) url.searchParams.set("query", query);
    else {
      url.searchParams.set("sort_by", sort === "newest" ? "primary_release_date.desc" : "popularity.desc");
      url.searchParams.set("vote_count.gte", "25");
      url.searchParams.set("primary_release_date.lte", new Date().toISOString().slice(0, 10));
      if (genreId !== null) url.searchParams.set("with_genres", String(genreId));
      if (decade !== null) { url.searchParams.set("primary_release_date.gte", `${decade}-01-01`); url.searchParams.set("primary_release_date.lte", `${decade + 9}-12-31`); }
    }
    url.searchParams.set("include_adult", "false");
    url.searchParams.set("language", "en-US");
    url.searchParams.set("page", "1");
    const upstream = await tmdbFetch(url);

    if (upstream.status === 503) {
      return response(
        { error: "TMDB search is not configured", results: [] },
        503,
        { "cache-control": "no-store" },
      );
    }
    if (upstream.status === 429) {
      return response(
        { error: "Film search is resting for a moment", results: [] },
        429,
        { "cache-control": "no-store" },
      );
    }
    if (!upstream.ok) {
      return response(
        { error: "Film search is temporarily unavailable", results: [] },
        502,
        { "cache-control": "no-store" },
      );
    }

    const payload = (await upstream.json()) as TmdbSearchResponse;
    const results = (payload.results ?? [])
      .filter((movie) => !movie.adult)
      .filter((movie) => genreId === null || movie.genre_ids?.includes(genreId))
      .filter((movie) => { const year = Number(movie.release_date?.slice(0, 4)); return decade === null || (year >= decade && year <= decade + 9); })
      .sort((left, right) => sort === "newest" ? (right.release_date ?? "").localeCompare(left.release_date ?? "") : (right.popularity ?? 0) - (left.popularity ?? 0))
      .slice(0, 16)
      .map((movie) => ({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        year: Number(movie.release_date?.slice(0, 4)) || new Date().getFullYear(),
        releaseDate: movie.release_date,
        runtime: null,
        director: "",
        genres: (movie.genre_ids ?? []).map((id) => TMDB_GENRES.find((genre) => genre.id === id)?.name).filter((name) => name !== undefined),
        poster: movie.poster_path
          ? `${IMAGE_ORIGIN}/w500${movie.poster_path}`
          : null,
        backdrop: movie.backdrop_path
          ? `${IMAGE_ORIGIN}/w1280${movie.backdrop_path}`
          : null,
        overview: movie.overview || "",
        palette: {
          dominant: "#443a69",
          secondary: "#17152b",
          accent: "#9f91e8",
        },
      }));

    return response(
      { results },
      200,
      { "cache-control": "public, max-age=60, stale-while-revalidate=240" },
    );
  } catch (error) {
    logServerError("/api/tmdb/search", error, request);
    return response(
      { error: "Film search is temporarily unavailable", results: [] },
      502,
      { "cache-control": "no-store" },
    );
  } finally {
    release();
  }
}
