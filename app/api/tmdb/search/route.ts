import { beginTmdbRequest, tmdbRequestIdentity } from "@/lib/tmdb/limit";
import { logServerError } from "@/lib/server/log";

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
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 120) {
    return response({ results: [] }, query.length > 120 ? 400 : 200);
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
    const url = new URL(`${TMDB_ORIGIN}/search/movie`);
    url.searchParams.set("query", query);
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
      .slice(0, 8)
      .map((movie) => ({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        year: Number(movie.release_date?.slice(0, 4)) || new Date().getFullYear(),
        releaseDate: movie.release_date,
        runtime: null,
        director: "",
        genres: [],
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
