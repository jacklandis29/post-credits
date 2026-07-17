import { beginTmdbRequest, tmdbRequestIdentity } from "@/lib/tmdb/limit";
import { logServerError } from "@/lib/server/log";

const TMDB_ORIGIN = "https://api.themoviedb.org/3";
const IMAGE_ORIGIN = "https://image.tmdb.org/t/p";

type MovieDetail = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  runtime?: number | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  tagline?: string;
  imdb_id?: string | null;
  adult?: boolean;
  original_language?: string;
  production_countries?: Array<{ iso_3166_1?: string; name?: string }>;
  genres?: Array<{ id: number; name: string }>;
  credits?: {
    crew?: Array<{ id?: number; job?: string; name?: string }>;
    cast?: Array<{
      id?: number;
      name?: string;
      character?: string;
      order?: number;
      profile_path?: string | null;
    }>;
  };
  keywords?: { keywords?: Array<{ id?: number; name?: string }> };
  "watch/providers"?: {
    results?: Record<string, {
      link?: string;
      flatrate?: Array<{ provider_id?: number; provider_name?: string; logo_path?: string | null }>;
      free?: Array<{ provider_id?: number; provider_name?: string; logo_path?: string | null }>;
      ads?: Array<{ provider_id?: number; provider_name?: string; logo_path?: string | null }>;
      rent?: Array<{ provider_id?: number; provider_name?: string; logo_path?: string | null }>;
      buy?: Array<{ provider_id?: number; provider_name?: string; logo_path?: string | null }>;
    }>;
  };
  videos?: {
    results?: Array<{
      key?: string;
      site?: string;
      type?: string;
      official?: boolean;
    }>;
  };
};

type WatchProvider = {
  provider_id?: number;
  provider_name?: string;
  logo_path?: string | null;
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

async function fetchDetail(url: URL, attempt = 0): Promise<Response> {
  const token = process.env.TMDB_API_TOKEN;
  const key = process.env.TMDB_API_KEY;
  if (!token && !key) return new Response(null, { status: 503 });
  if (key) url.searchParams.set("api_key", key);
  const upstream = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(5_000),
  });
  if (upstream.status === 429 && attempt === 0) {
    const retryAfter = Number(upstream.headers.get("retry-after") ?? "1");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(Math.max(retryAfter, 0.25), 2) * 1_000),
    );
    return fetchDetail(url, attempt + 1);
  }
  return upstream;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^\d{1,12}$/.test(id) || Number(id) <= 0) {
    return json({ error: "Invalid TMDB movie id" }, 400);
  }
  const release = beginTmdbRequest(
    `detail:${tmdbRequestIdentity(request)}`,
    { limit: 40 },
  );
  if (!release) {
    return json(
      { error: "Film details are temporarily unavailable" },
      429,
      { "retry-after": "10" },
    );
  }

  try {
    const url = new URL(`${TMDB_ORIGIN}/movie/${id}`);
    url.searchParams.set("language", "en-US");
    url.searchParams.set("append_to_response", "credits,keywords,videos,watch/providers");
    const upstream = await fetchDetail(url);
    if (upstream.status === 503) {
      return json({ error: "TMDB details are not configured" }, 503);
    }
    if (upstream.status === 404) return json({ error: "Film not found" }, 404);
    if (!upstream.ok) {
      return json({ error: "Film details are temporarily unavailable" }, 502);
    }
    const detail = (await upstream.json()) as MovieDetail;
    if (detail.adult) return json({ error: "Film not available in v1" }, 404);
    const directors = (detail.credits?.crew ?? [])
      .filter((person) => person.job === "Director" && person.name)
      .map((person) => ({ id: person.id ?? 0, name: person.name! }));
    const usProviders = detail["watch/providers"]?.results?.US;
    const providers = (items: WatchProvider[] = []) => items.flatMap((provider) =>
        provider.provider_id && provider.provider_name
          ? [{
              id: provider.provider_id,
              name: provider.provider_name,
              logo: provider.logo_path ? `${IMAGE_ORIGIN}/w92${provider.logo_path}` : null,
            }]
          : [],
      );
    const trailer = (detail.videos?.results ?? []).find(
      (video) => video.site === "YouTube" && video.type === "Trailer" && video.official && video.key,
    ) ?? (detail.videos?.results ?? []).find(
      (video) => video.site === "YouTube" && video.type === "Trailer" && video.key,
    );
    const movie = {
      id: detail.id,
      title: detail.title,
      originalTitle: detail.original_title,
      year: Number(detail.release_date?.slice(0, 4)) || new Date().getFullYear(),
      releaseDate: detail.release_date,
      runtime: detail.runtime ?? null,
      director: directors.map((person) => person.name).join(" & ") || "Unknown director",
      directors: directors.filter((person) => person.id > 0),
      genres: (detail.genres ?? []).map((genre) => genre.name),
      genreDetails: detail.genres ?? [],
      cast: (detail.credits?.cast ?? [])
        .filter((person) => person.name)
        .sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
        .slice(0, 12)
        .map((person) => person.name!),
      credits: (detail.credits?.cast ?? [])
        .filter((person) => person.id && person.name)
        .sort((left, right) => (left.order ?? 999) - (right.order ?? 999))
        .slice(0, 14)
        .map((person) => ({
          id: person.id!,
          name: person.name!,
          character: person.character?.trim() || null,
          profile: person.profile_path
            ? `${IMAGE_ORIGIN}/w185${person.profile_path}`
            : null,
        })),
      keywords: (detail.keywords?.keywords ?? [])
        .flatMap((keyword) => keyword.name ? [keyword.name] : [])
        .slice(0, 40),
      keywordDetails: (detail.keywords?.keywords ?? [])
        .flatMap((keyword) => keyword.id && keyword.name ? [{ id: keyword.id, name: keyword.name }] : [])
        .slice(0, 40),
      watchProviders: usProviders?.link ? {
        region: "US",
        link: usProviders.link,
        stream: providers([
          ...(usProviders.flatrate ?? []),
          ...(usProviders.free ?? []),
          ...(usProviders.ads ?? []),
        ]),
        rent: providers(usProviders.rent ?? []),
        buy: providers(usProviders.buy ?? []),
      } : null,
      originalLanguage: detail.original_language ?? null,
      productionCountries: (detail.production_countries ?? [])
        .flatMap((country) => country.name ? [country.name] : []),
      poster: detail.poster_path
        ? `${IMAGE_ORIGIN}/w500${detail.poster_path}`
        : null,
      backdrop: detail.backdrop_path
        ? `${IMAGE_ORIGIN}/w1280${detail.backdrop_path}`
        : null,
      overview: detail.overview || "No overview is currently available.",
      tagline: detail.tagline?.trim() || null,
      trailerUrl: trailer?.key ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}` : null,
      imdbId: detail.imdb_id ?? null,
      palette: {
        dominant: "#443a69",
        secondary: "#17152b",
        accent: "#9f91e8",
      },
    };
    return json(
      { movie },
      200,
      { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" },
    );
  } catch (error) {
    logServerError("/api/tmdb/movie/[id]", error, request);
    return json({ error: "Film details are temporarily unavailable" }, 502);
  } finally {
    release();
  }
}
