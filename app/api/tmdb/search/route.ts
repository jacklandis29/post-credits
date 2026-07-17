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
  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams.get("q")?.trim() ?? "";
  const filterType = requestUrl.searchParams.get("type") ?? "";
  const filterId = requestUrl.searchParams.get("id") ?? "";
  const browseGenre = requestUrl.searchParams.get("genre") ?? "all";
  const browseDecade = requestUrl.searchParams.get("decade") ?? "all";
  const browseSort = requestUrl.searchParams.get("sort") === "newest" ? "newest" : "popularity";
  const browseGenreId = browseGenre === "all" ? null : Number(browseGenre);
  const browseDecadeYear = browseDecade === "all" ? null : Number(browseDecade);
  const validBrowseGenre = browseGenreId === null || TMDB_GENRES.some((genre) => genre.id === browseGenreId);
  const validBrowseDecade = browseDecadeYear === null || (
    Number.isInteger(browseDecadeYear) &&
    browseDecadeYear >= 1900 &&
    browseDecadeYear <= 2020 &&
    browseDecadeYear % 10 === 0
  );
  const filterParam = {
    director: "with_crew",
    cast: "with_cast",
    genre: "with_genres",
    keyword: "with_keywords",
  }[filterType];
  const filtered = Boolean(filterParam && /^\d{1,12}$/.test(filterId) && Number(filterId) > 0);
  const browsing = query.length === 0 && !filtered;
  if (
    query.length > 120 ||
    (query.length > 0 && query.length < 2) ||
    !validBrowseGenre ||
    !validBrowseDecade
  ) {
    return response(
      { results: [] },
      query.length > 120 || !validBrowseGenre || !validBrowseDecade ? 400 : 200,
    );
  }
  const release = beginTmdbRequest(
    `search:${filterType}:${filterId}:${browseGenre}:${browseDecade}:${tmdbRequestIdentity(request)}`,
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
    const url = new URL(`${TMDB_ORIGIN}/${filtered || browsing ? "discover/movie" : "search/movie"}`);
    if (filtered && filterParam) {
      url.searchParams.set(filterParam, filterId);
      url.searchParams.set("sort_by", "popularity.desc");
    } else if (browsing) {
      url.searchParams.set("sort_by", browseSort === "newest" ? "primary_release_date.desc" : "popularity.desc");
      url.searchParams.set("vote_count.gte", "25");
      url.searchParams.set("primary_release_date.lte", new Date().toISOString().slice(0, 10));
      if (browseGenreId !== null) url.searchParams.set("with_genres", String(browseGenreId));
      if (browseDecadeYear !== null) {
        url.searchParams.set("primary_release_date.gte", `${browseDecadeYear}-01-01`);
        url.searchParams.set("primary_release_date.lte", `${browseDecadeYear + 9}-12-31`);
      }
    } else {
      url.searchParams.set("query", query);
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
      .filter((movie) => browseGenreId === null || movie.genre_ids?.includes(browseGenreId))
      .filter((movie) => {
        if (browseDecadeYear === null) return true;
        const year = Number(movie.release_date?.slice(0, 4));
        return year >= browseDecadeYear && year <= browseDecadeYear + 9;
      })
      .sort((left, right) => browseSort === "newest"
        ? (right.release_date ?? "").localeCompare(left.release_date ?? "")
        : (right.popularity ?? 0) - (left.popularity ?? 0))
      .slice(0, 16)
      .map((movie) => ({
        id: movie.id,
        title: movie.title,
        originalTitle: movie.original_title,
        year: Number(movie.release_date?.slice(0, 4)) || new Date().getFullYear(),
        releaseDate: movie.release_date,
        runtime: null,
        director: "",
        genres: (movie.genre_ids ?? [])
          .map((id) => TMDB_GENRES.find((genre) => genre.id === id)?.name)
          .filter((name) => name !== undefined),
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
