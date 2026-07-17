import {
  beginTmdbConcurrency,
  consumeTmdbBudget,
  tmdbRequestIdentity,
} from "@/lib/tmdb/limit";
import { logServerError } from "@/lib/server/log";
import { readBoundedJsonObject } from "@/lib/server/request";

const TMDB_ORIGIN = "https://api.themoviedb.org/3";

type JsonObject = Record<string, unknown>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function optionalBoundedText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  return boundedText(value, maxLength);
}

function validTmdbPath(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length <= 512 &&
      /^\/[A-Za-z0-9_./-]+$/.test(value) &&
      !value.includes(".."))
  );
}

function validReleaseDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1870 || year > new Date().getUTCFullYear() + 20) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

async function fetchTmdb(url: URL, attempt = 0): Promise<Response> {
  const token = process.env.TMDB_API_TOKEN;
  const apiKey = process.env.TMDB_API_KEY;
  if (!token && !apiKey) return new Response(null, { status: 503 });
  if (apiKey) url.searchParams.set("api_key", apiKey);

  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(7_000),
  });
  if (response.status === 429 && attempt === 0) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    const delay = Math.min(Math.max(retryAfter, 0.25), 2) * 1_000;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return fetchTmdb(url, attempt + 1);
  }
  return response;
}

function authoritativeMovie(payload: unknown, requestedId: number) {
  const movie = object(payload);
  if (!movie) return null;
  if (movie.adult === true) return "adult" as const;
  if (movie.adult !== false || movie.id !== requestedId) return null;

  const title = boundedText(movie.title, 500);
  const originalTitle = boundedText(movie.original_title, 500);
  const originalLanguage = boundedText(movie.original_language, 16);
  const overview =
    typeof movie.overview === "string" && movie.overview.length <= 20_000
      ? movie.overview
      : null;
  const runtime = movie.runtime;
  const releaseDate =
    movie.release_date === "" || movie.release_date == null
      ? null
      : validReleaseDate(movie.release_date)
        ? movie.release_date
        : undefined;
  if (
    !title ||
    !originalTitle ||
    !originalLanguage ||
    overview === null ||
    releaseDate === undefined ||
    (runtime !== null && runtime !== undefined && (
      !Number.isInteger(runtime) ||
      (runtime as number) < 1 ||
      (runtime as number) > 1_440
    )) ||
    !validTmdbPath(movie.poster_path) ||
    !validTmdbPath(movie.backdrop_path)
  ) {
    return null;
  }

  if (!Array.isArray(movie.genres) || movie.genres.length > 32) {
    return null;
  }
  const genres = movie.genres.map((value) => {
    const genre = object(value);
    return genre ? boundedText(genre.name, 100) : null;
  });
  if (genres.some((genre) => genre === null)) return null;

  const credits = object(movie.credits);
  if (!credits || !Array.isArray(credits.crew) || !Array.isArray(credits.cast)) return null;
  const directors = [
    ...new Set(
      credits.crew.flatMap((value) => {
        const member = object(value);
        if (!member || member.job !== "Director") return [];
        const name = boundedText(member.name, 200);
        return name ? [name] : [];
      }),
    ),
  ];
  if (directors.length > 16) return null;

  if (!Array.isArray(movie.production_countries) || movie.production_countries.length > 32) {
    return null;
  }
  const productionCountries = movie.production_countries.map((value) => {
    const country = object(value);
    if (!country) return null;
    const code = boundedText(country.iso_3166_1, 2);
    const name = boundedText(country.name, 120);
    return code && /^[A-Z]{2}$/.test(code) && name
      ? { iso_3166_1: code, name }
      : null;
  });
  if (productionCountries.some((country) => country === null)) return null;

  const principalCast = credits.cast.slice(0, 12).map((value) => {
    const member = object(value);
    if (!member) return null;
    const tmdbId = member.id;
    const name = boundedText(member.name, 200);
    const character = optionalBoundedText(member.character, 300);
    const order = member.order;
    return Number.isSafeInteger(tmdbId) && (tmdbId as number) > 0 && name &&
      Number.isInteger(order) && (order as number) >= 0
      ? { tmdb_id: tmdbId, name, character, order }
      : null;
  });
  if (principalCast.some((member) => member === null)) return null;

  const keywordPayload = object(movie.keywords);
  const keywordValues = keywordPayload && Array.isArray(keywordPayload.keywords)
    ? keywordPayload.keywords
    : keywordPayload && Array.isArray(keywordPayload.results)
      ? keywordPayload.results
      : [];
  const keywords = keywordValues.slice(0, 40).map((value) => {
    const keyword = object(value);
    if (!keyword) return null;
    const tmdbId = keyword.id;
    const name = boundedText(keyword.name, 160);
    return Number.isSafeInteger(tmdbId) && (tmdbId as number) > 0 && name
      ? { tmdb_id: tmdbId, name }
      : null;
  });
  if (keywords.some((keyword) => keyword === null)) return null;

  return {
    p_tmdb_id: requestedId,
    p_title: title,
    p_original_title: originalTitle,
    p_overview: overview,
    p_release_date: releaseDate,
    p_runtime_minutes: runtime == null ? null : runtime as number,
    p_poster_path: movie.poster_path as string | null,
    p_backdrop_path: movie.backdrop_path as string | null,
    p_genres: genres as string[],
    p_director: directors,
    p_original_language: originalLanguage.toLowerCase(),
    p_production_countries: productionCountries,
    p_principal_cast: principalCast,
    p_keywords: keywords,
  };
}

async function safeJson(response: Response): Promise<JsonObject | null> {
  try {
    return object(await response.json());
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!consumeTmdbBudget(`cache:${tmdbRequestIdentity(request)}`, { limit: 60 })) {
    return new Response(JSON.stringify({ error: "Movie cache request limit reached" }), {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "retry-after": "10",
      },
    });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(\S+)$/.exec(authorization);
  if (!bearer || bearer[1].length > 8_192) {
    return json({ error: "Authentication required" }, 401);
  }
  const forwardedAuthorization = `Bearer ${bearer[1]}`;

  const body = await readBoundedJsonObject(request, 1_024);
  if (
    !body ||
    Object.keys(body).length !== 1 ||
    !Number.isSafeInteger(body.tmdbId) ||
    (body.tmdbId as number) <= 0
  ) {
    return json({ error: "Invalid TMDB movie id" }, 400);
  }
  const tmdbId = body.tmdbId as number;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serverKey =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return json({ error: "Supabase is not configured" }, 503);
  }

  let authUrl: URL;
  let budgetUrl: URL;
  let rpcUrl: URL;
  let movieLookupUrl: URL;
  try {
    authUrl = new URL("/auth/v1/user", supabaseUrl);
    budgetUrl = new URL("/rest/v1/rpc/consume_tmdb_cache_budget", supabaseUrl);
    rpcUrl = new URL("/rest/v1/rpc/cache_tmdb_movie", supabaseUrl);
    movieLookupUrl = new URL("/rest/v1/movies", supabaseUrl);
    movieLookupUrl.searchParams.set("tmdb_id", `eq.${tmdbId}`);
    movieLookupUrl.searchParams.set("select", "tmdb_id");
    movieLookupUrl.searchParams.set("limit", "1");
  } catch (error) {
    logServerError("/api/tmdb/cache/config", error, request);
    return json({ error: "Supabase is not configured" }, 503);
  }

  try {
    const authResponse = await fetch(authUrl, {
      headers: {
        apikey: supabaseKey,
        authorization: forwardedAuthorization,
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (authResponse.status === 401 || authResponse.status === 403) {
      return json({ error: "Authentication required" }, 401);
    }
    if (!authResponse.ok) {
      return json({ error: "Authentication is temporarily unavailable" }, 502);
    }
    const authenticatedUser = await safeJson(authResponse);
    if (!authenticatedUser || typeof authenticatedUser.id !== "string") {
      return json({ error: "Authentication required" }, 401);
    }

    const movieLookupResponse = await fetch(movieLookupUrl, {
      headers: {
        accept: "application/json",
        apikey: supabaseKey,
        authorization: forwardedAuthorization,
      },
      signal: AbortSignal.timeout(7_000),
    });
    if (movieLookupResponse.ok) {
      const existingMovies = await movieLookupResponse.json();
      if (Array.isArray(existingMovies) && existingMovies.length > 0) {
        return json({ cached: true });
      }
    } else {
      const lookupError = await safeJson(movieLookupResponse);
      const code =
        lookupError && typeof lookupError.code === "string"
          ? lookupError.code
          : undefined;
      if (code === "PGRST202" || code === "PGRST205") {
        return json({ error: "Database schema is not installed", code }, 503);
      }
      return json({ error: "Could not read the film cache", code }, 502);
    }
    if (!serverKey) {
      return json({ error: "Server movie cache is not configured" }, 503);
    }
    const budgetResponse = await fetch(budgetUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        apikey: supabaseKey,
        authorization: forwardedAuthorization,
        "content-type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(7_000),
    });
    if (!budgetResponse.ok) {
      const budgetError = await safeJson(budgetResponse);
      const code =
        budgetError && typeof budgetError.code === "string"
          ? budgetError.code
          : undefined;
      if (code === "PGRST202" || code === "PGRST205") {
        return json({ error: "Database schema is not installed", code }, 503);
      }
      return json({ error: "Could not check the movie cache budget", code }, 502);
    }
    if ((await budgetResponse.json()) !== true) {
      return json({ error: "Movie cache request limit reached" }, 429);
    }
    const release = beginTmdbConcurrency(4);
    if (!release) {
      return json({ error: "Movie cache is busy" }, 429);
    }

    try {
      const tmdbUrl = new URL(`${TMDB_ORIGIN}/movie/${tmdbId}`);
      tmdbUrl.searchParams.set("language", "en-US");
      tmdbUrl.searchParams.set("append_to_response", "credits,keywords");
      const tmdbResponse = await fetchTmdb(tmdbUrl);
      if (tmdbResponse.status === 503) {
        return json({ error: "TMDB is not configured" }, 503);
      }
      if (tmdbResponse.status === 404) {
        return json({ error: "Film not found" }, 404);
      }
      if (tmdbResponse.status === 429) {
        return json({ error: "TMDB is temporarily rate limited" }, 429);
      }
      if (!tmdbResponse.ok) {
        return json({ error: "Film details are temporarily unavailable" }, 502);
      }

      const movie = authoritativeMovie(await tmdbResponse.json(), tmdbId);
      if (movie === "adult") return json({ error: "Film not found" }, 404);
      if (!movie) {
        return json({ error: "TMDB returned incomplete film details" }, 502);
      }

      const rpcResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          apikey: serverKey,
          ...(serverKey.startsWith("sb_secret_")
            ? {}
            : { authorization: `Bearer ${serverKey}` }),
          "content-type": "application/json",
        },
        body: JSON.stringify(movie),
        signal: AbortSignal.timeout(7_000),
      });
      if (rpcResponse.ok) return json({ cached: true });

      const rpcError = await safeJson(rpcResponse);
      const code =
        rpcError && typeof rpcError.code === "string" ? rpcError.code : undefined;
      if (rpcResponse.status === 401 || rpcResponse.status === 403) {
        return json({ error: "Server movie cache is not authorized", code }, 502);
      }
      if (code === "PGRST202" || code === "PGRST205") {
        return json({ error: "Database schema is not installed", code }, 503);
      }
      return json({ error: "Could not cache film details", code }, 502);
    } finally {
      release();
    }
  } catch (error) {
    logServerError("/api/tmdb/cache", error, request);
    return json({ error: "Film details are temporarily unavailable" }, 502);
  }
}
