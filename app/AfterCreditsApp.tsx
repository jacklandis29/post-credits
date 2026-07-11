"use client";

import {
  acceptCurrentPlacement,
  answerComparison,
  comparisonEventDrafts,
  deriveScore,
  getNextComparison,
  startRanking,
  undoLastAnswer,
  type RankingSession,
} from "@/lib/ranking";
import { cacheMovies, initialState, movieById, movies } from "@/lib/seed";
import { movieSimilarity } from "@/lib/similarity";
import {
  beginRankingRecord,
  commitRankingRecord,
  insertWatchEntry,
  loadPublicProfileByUsername,
  loadPublicProfileState,
  recordRankingAnswer,
  resumeRankingRecord,
  searchPublicProfiles,
  setWatchlistItem,
  undoRankingAnswer,
  updateProfile,
  type PublicProfile,
  type PublicProfileState,
} from "@/lib/supabase/data";
import type { AppState, DiaryEntry, Movie, RankedFilm, Verdict } from "@/lib/types";
import {
  canonFromState,
  insertionPosition,
  isAbandonedSession,
  isValidLocalDate,
  monthKey,
  readableError,
  sortBucket,
  sortDiary,
  todayLocal,
  verdictPriority,
} from "@/lib/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import SupabaseGate, { type ConnectedSupabase } from "./SupabaseGate";
import { CanonView } from "./components/CanonView";
import { DiaryView } from "./components/DiaryView";
import { FilmDetail } from "./components/FilmDetail";
import { HomeView } from "./components/HomeView";
import { Landing } from "./components/Landing";
import {
  emptyDraft,
  LogFilmFlow,
  type LogDraft,
} from "./components/LogFlow";
import { SearchView } from "./components/SearchView";
import { ProfileView } from "./components/ProfileView";
import { WatchlistView } from "./components/WatchlistView";
import { AboutSheet, ProfileSheet, PublicProfileSheet } from "./components/sheets";
import { FilmRollIcon, NavIcon, PlusIcon, SidebarToggleIcon, type View } from "./components/icons";

const STORAGE_KEY = "after-credits-local-v2";
const PENDING_LOG_KEY = "after-credits-pending-log-v1";
const SIDEBAR_KEY = "after-credits-sidebar-collapsed";

const viewLabels: Record<View, string> = {
  home: "Home",
  diary: "Diary",
  canon: "Ranking",
  watchlist: "Watchlist",
  search: "Search",
  profile: "Profile",
};

export default function AfterCreditsApp() {
  return (
    <SupabaseGate
      signedOut={(openSignIn, publicClient) => (
        <AfterCreditsCore
          key="public"
          connection={null}
          publicClient={publicClient}
          publicMode
          onSignIn={openSignIn}
        />
      )}
    >
      {(connection) => (
        <AfterCreditsCore
          key={connection?.userId ?? "local"}
          connection={connection}
        />
      )}
    </SupabaseGate>
  );
}

function AfterCreditsCore({
  connection,
  publicClient,
  publicMode = false,
  onSignIn,
}: {
  connection: ConnectedSupabase | null;
  publicClient?: SupabaseClient;
  publicMode?: boolean;
  onSignIn?: () => void;
}) {
  const [state, setState] = useState<AppState>(
    connection?.initialState ?? initialState,
  );
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("home");
  const [selectedFilm, setSelectedFilm] = useState<Movie | null>(null);
  const [log, setLog] = useState<LogDraft | null>(null);
  const [canonQuery, setCanonQuery] = useState("");
  const [canonVerdict, setCanonVerdict] = useState<"all" | Verdict>("all");
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [discoveryMovies, setDiscoveryMovies] = useState<{
    query: string;
    results: Movie[];
    error: string;
  }>({ query: "", results: [], error: "" });
  const [discoveryMovieBusy, setDiscoveryMovieBusy] = useState(false);
  const discoveryGeneration = useRef(0);
  const [peopleResults, setPeopleResults] = useState<PublicProfile[]>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [selectedPublicProfile, setSelectedPublicProfile] = useState<PublicProfileState | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState(connection?.profile ?? null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activeLogStep = log?.step ?? null;

  useEffect(() => {
    queueMicrotask(() => {
      setSidebarCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "true");
    });
  }, []);

  useEffect(() => {
    const client = connection?.client ?? publicClient;
    const username = new URLSearchParams(window.location.search).get("profile");
    if (!client || !username) return;
    let cancelled = false;
    void loadPublicProfileByUsername(client, username)
      .then((result) => {
        if (!cancelled) setSelectedPublicProfile(result);
      })
      .catch((error) => {
        if (!cancelled) setOperationError(readableError(error));
      });
    return () => { cancelled = true; };
  }, [connection, publicClient]);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }

  useEffect(() => {
    if (publicMode) {
      cacheMovies(initialState.movieCache ?? []);
      queueMicrotask(() => setHydrated(true));
      return;
    }
    if (connection) {
      cacheMovies(connection.initialState.movieCache ?? []);
      queueMicrotask(() => {
        try {
          const pending = window.sessionStorage.getItem(PENDING_LOG_KEY);
          if (pending) {
            const restored = JSON.parse(pending) as LogDraft;
            if (restored.movie) {
              cacheMovies([restored.movie]);
              setLog({
                ...restored,
                step: "details",
                entryId: null,
                session: null,
                sessionId: null,
              });
            }
            window.sessionStorage.removeItem(PENDING_LOG_KEY);
          }
        } catch {
          window.sessionStorage.removeItem(PENDING_LOG_KEY);
        }
        setHydrated(true);
      });
      return;
    }
    let savedState: AppState | null = null;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) savedState = JSON.parse(saved) as AppState;
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    queueMicrotask(() => {
      if (savedState) {
        cacheMovies(savedState.movieCache ?? []);
        setState(savedState);
      }
      setHydrated(true);
    });
  }, [connection, publicMode]);

  useEffect(() => {
    if (!hydrated || connection || publicMode) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [connection, hydrated, publicMode, state]);

  useEffect(() => {
    if (connection || publicMode) return;
    function syncFromAnotherTab(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = JSON.parse(event.newValue) as AppState;
        cacheMovies(incoming.movieCache ?? []);
        setState(incoming);
        setLog((current) => {
          if (
            incoming.activeRankingSession &&
            incoming.activeRankingSessionId &&
            current?.sessionId === incoming.activeRankingSessionId
          ) {
            return {
              ...current,
              session: incoming.activeRankingSession,
              sessionRevision: incoming.activeRankingRevision ?? 0,
              step:
                incoming.activeRankingSession.status === "complete"
                  ? "resume"
                  : current.step,
              reason: incoming.activeRankingReason ?? current.reason,
              rankBefore: incoming.activeRankingOriginalRank ?? null,
              verdictBefore: incoming.activeRankingOriginalVerdict ?? null,
            };
          }
          if (
            current?.sessionId &&
            (incoming.committedRankingSessionIds ?? []).includes(current.sessionId)
          ) {
            return null;
          }
          if (incoming.activeRankingSessionId && current && current.step !== "result") {
            return null;
          }
          return current;
        });
      } catch {
        // Ignore partial or malformed writes from an older local prototype.
      }
    }
    window.addEventListener("storage", syncFromAnotherTab);
    return () => window.removeEventListener("storage", syncFromAnotherTab);
  }, [connection, publicMode]);

  useEffect(() => {
    function closeTopLayer(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (aboutOpen) setAboutOpen(false);
      else if (profileOpen) setProfileOpen(false);
      else if (selectedPublicProfile) setSelectedPublicProfile(null);
      else if (log) setLog(null);
      else if (selectedFilm) setSelectedFilm(null);
    }
    window.addEventListener("keydown", closeTopLayer);
    return () => window.removeEventListener("keydown", closeTopLayer);
  }, [aboutOpen, log, profileOpen, selectedFilm, selectedPublicProfile]);

  const hasAboutLayer = aboutOpen;
  const hasProfileLayer = profileOpen;
  const hasPublicProfileLayer = Boolean(selectedPublicProfile);
  const hasLogLayer = Boolean(log);
  const hasFilmLayer = Boolean(selectedFilm);

  useEffect(() => {
    const anyLayer =
      hasAboutLayer || hasProfileLayer || hasPublicProfileLayer || hasLogLayer || hasFilmLayer;
    document.documentElement.style.overflow = anyLayer ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [hasAboutLayer, hasFilmLayer, hasLogLayer, hasProfileLayer, hasPublicProfileLayer]);

  useEffect(() => {
    const selector = hasAboutLayer
      ? ".about-overlay"
      : hasProfileLayer
        ? ".profile-overlay"
      : hasPublicProfileLayer
        ? ".public-profile-overlay"
      : hasLogLayer
        ? ".log-overlay"
        : hasFilmLayer
          ? ".film-sheet"
          : null;
    if (!selector) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const root = document.querySelector<HTMLElement>(selector);
    if (!root) return;
    const focusableSelector =
      'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(focusableSelector),
    );
    const preferred = root.querySelector<HTMLElement>("[autofocus]") ?? focusables[0];
    queueMicrotask(() => preferred?.focus());

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const currentFocusables = Array.from(
        root!.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (currentFocusables.length === 0) return;
      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    root.addEventListener("keydown", keepFocusInside);
    return () => {
      root.removeEventListener("keydown", keepFocusInside);
      previousFocus?.focus();
    };
  }, [activeLogStep, hasAboutLayer, hasFilmLayer, hasLogLayer, hasProfileLayer, hasPublicProfileLayer]);

  useEffect(() => {
    const peopleClient = connection?.client ?? publicClient;
    if (!peopleClient || view !== "search" || discoveryQuery.trim().length < 2) {
      queueMicrotask(() => {
        setPeopleResults([]);
        setPeopleBusy(false);
      });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPeopleBusy(true);
      void searchPublicProfiles(peopleClient, discoveryQuery)
        .then((results) => {
          if (!cancelled) setPeopleResults(results);
        })
        .catch((error) => {
          if (!cancelled) {
            setPeopleResults([]);
            setOperationError(readableError(error));
          }
        })
        .finally(() => {
          if (!cancelled) setPeopleBusy(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connection, discoveryQuery, publicClient, view]);

  useEffect(() => {
    const query = discoveryQuery.trim();
    const generation = ++discoveryGeneration.current;
    if (view !== "search" || query.length < 2) {
      queueMicrotask(() => {
        if (generation !== discoveryGeneration.current) return;
        setDiscoveryMovieBusy(false);
        setDiscoveryMovies({ query: "", results: [], error: "" });
      });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDiscoveryMovieBusy(true);
      setDiscoveryMovies({ query: query.toLowerCase(), results: [], error: "" });
      try {
        const response = await fetch(`/api/tmdb/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { results?: Movie[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Film search is unavailable.");
        if (generation !== discoveryGeneration.current) return;
        setDiscoveryMovies({ query: query.toLowerCase(), results: payload.results ?? [], error: "" });
      } catch (error) {
        if ((error as Error).name !== "AbortError" && generation === discoveryGeneration.current) {
          setDiscoveryMovies({ query: query.toLowerCase(), results: [], error: readableError(error) });
        }
      } finally {
        if (generation === discoveryGeneration.current) setDiscoveryMovieBusy(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [discoveryQuery, view]);

  const diary = useMemo(() => sortDiary(state.diary), [state.diary]);
  const canon = useMemo(() => canonFromState(state), [state]);
  const completedDiary = diary.filter((entry) => entry.completionStatus === "completed");
  const latest = completedDiary[0] ?? diary[0];
  const latestMovie = latest ? movieById(latest.movieId) : movies[0];
  const latestCanon = canon.find((row) => row.movie.id === latestMovie.id);
  const unfinished = diary.find(
    (entry) => entry.rankingStatus === "pending" || entry.rankingStatus === "in_progress",
  );
  const unfinishedMovie = state.activeRankingSession
    ? movieById(Number(state.activeRankingSession.movieId))
    : unfinished
      ? movieById(unfinished.movieId)
      : undefined;

  const stats = useMemo(() => {
    const currentYear = String(new Date().getFullYear());
    const thisYear = completedDiary.filter((entry) => entry.watchedOn.startsWith(currentYear));
    return {
      films: thisYear.length,
      minutes: thisYear.reduce(
        (total, entry) => total + (movieById(entry.movieId).runtime ?? 0),
        0,
      ),
      rewatches: thisYear.filter((entry) => entry.isRewatch).length,
    };
  }, [completedDiary]);

  const diaryGroups = useMemo(() => {
    const groups = new Map<string, DiaryEntry[]>();
    diary.forEach((entry) => {
      const key = monthKey(entry.watchedOn);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    });
    return [...groups.entries()];
  }, [diary]);

  const visibleCanon = canon.filter((row) => {
    const verdictMatches = canonVerdict === "all" || row.ranked.verdict === canonVerdict;
    const queryMatches = row.movie.title.toLowerCase().includes(canonQuery.toLowerCase());
    return verdictMatches && queryMatches;
  });

  function updateDraft(update: Partial<LogDraft>) {
    setLog((current) => (current ? { ...current, ...update } : current));
  }

  function requireSignIn(): boolean {
    if (!publicMode) return false;
    if (log?.movie) {
      window.sessionStorage.setItem(PENDING_LOG_KEY, JSON.stringify(log));
    }
    onSignIn?.();
    return true;
  }

  function saveProfileSettings(input: {
    displayName: string;
    bio: string;
    isPublic: boolean;
    isDiscoverable: boolean;
  }) {
    if (!connection) return;
    runConnected(async () => {
      const profile = await updateProfile(connection.client, {
        userId: connection.userId,
        ...input,
      });
      setActiveProfile(profile);
      setProfileOpen(false);
    });
  }

  async function refreshConnectedState(): Promise<AppState> {
    if (!connection) return state;
    const next = await connection.refresh();
    cacheMovies(next.movieCache ?? []);
    setState(next);
    return next;
  }

  function runConnected(work: () => Promise<void>) {
    if (!connection || operationBusy) return;
    setOperationBusy(true);
    setOperationError("");
    void work()
      .catch((error) => setOperationError(readableError(error)))
      .finally(() => setOperationBusy(false));
  }

  function readAuthoritativeState(): AppState {
    if (connection || publicMode) return state;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as AppState;
        cacheMovies(parsed.movieCache ?? []);
        return parsed;
      }
    } catch {
      // Fall through to the current in-memory snapshot.
    }
    return state;
  }

  function writeAuthoritativeState(next: AppState) {
    cacheMovies(next.movieCache ?? []);
    if (!connection && !publicMode) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    setState(next);
  }

  function runWithRankingLock(work: () => void) {
    if (navigator.locks) {
      void navigator.locks.request("after-credits-ranking-v1", async () => {
        work();
      });
      return;
    }
    work();
  }

  function adoptAuthoritativeSession(incoming: AppState) {
    if (incoming.activeRankingSession && !incoming.activeRankingSessionId) {
      incoming = {
        ...incoming,
        activeRankingSessionId: crypto.randomUUID(),
        activeRankingRevision: 0,
        activeRankingReason: incoming.activeRankingEntryId ? "initial" : "manual",
      };
    }
    writeAuthoritativeState(incoming);
    const session = incoming.activeRankingSession;
    const sessionId = incoming.activeRankingSessionId;
    if (!session || !sessionId) {
      setLog(null);
      return;
    }
    const movie = movieById(Number(session.movieId));
    const entry = incoming.activeRankingEntryId
      ? incoming.diary.find((item) => item.id === incoming.activeRankingEntryId)
      : undefined;
    setSelectedFilm(null);
    setLog({
      ...emptyDraft(),
      movie,
      entryId: entry?.id ?? null,
      watchedOn: entry?.watchedOn ?? todayLocal(),
      note: entry?.note ?? "",
      visibility: entry?.visibility ?? "private",
      step:
        session.status === "complete" ||
        incoming.activeRankingStatus === "abandoned" ||
        isAbandonedSession(incoming.activeRankingLastActivityAt)
          ? "resume"
          : "compare",
      reason: incoming.activeRankingReason ?? (entry?.isRewatch ? "rewatch" : "manual"),
      verdict: session.verdict,
      session,
      sessionId,
      sessionRevision: incoming.activeRankingRevision ?? 0,
      rankBefore: incoming.activeRankingOriginalRank ?? null,
      verdictBefore: incoming.activeRankingOriginalVerdict ?? null,
    });
  }

  function draftMatchesAuthority(draft: LogDraft, incoming: AppState): boolean {
    return Boolean(
      draft.sessionId &&
      draft.sessionId === incoming.activeRankingSessionId &&
      draft.sessionRevision === (incoming.activeRankingRevision ?? 0) &&
      incoming.activeRankingSession,
    );
  }

  function openLogger() {
    setSelectedFilm(null);
    const authoritative = readAuthoritativeState();
    if (authoritative.activeRankingSession) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const unresolved = sortDiary(authoritative.diary).find(
      (entry) => entry.rankingStatus === "pending" || entry.rankingStatus === "in_progress",
    );
    if (unresolved) {
      setState(authoritative);
      resumeEntry(unresolved, authoritative);
      return;
    }
    setSelectedFilm(null);
    setLog(null);
    setView("search");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openMovieLogger(movie: Movie) {
    const authoritative = readAuthoritativeState();
    const unresolved = authoritative.diary.some(
      (entry) => entry.rankingStatus === "pending" || entry.rankingStatus === "in_progress",
    );
    if (authoritative.activeRankingSession || unresolved) {
      openLogger();
      return;
    }
    let selected = movie;
    if (movie.runtime === null || !movie.director) {
      setOperationBusy(true);
      setOperationError("");
      try {
        const response = await fetch(`/api/tmdb/movie/${movie.id}`);
        if (!response.ok) throw new Error("Film details are unavailable.");
        const payload = (await response.json()) as { movie?: Movie };
        if (!payload.movie) throw new Error("Film details are unavailable.");
        selected = payload.movie;
      } catch (error) {
        setOperationError(readableError(error));
        return;
      } finally {
        setOperationBusy(false);
      }
    }
    cacheMovies([selected]);
    setState((current) => ({
      ...current,
      movieCache: [
        ...(current.movieCache ?? []).filter((cached) => cached.id !== selected.id),
        selected,
      ],
    }));
    setSelectedFilm(null);
    setLog({
      ...emptyDraft(),
      movie: selected,
      step: "details",
      reason: authoritative.ranked.some((row) => row.movieId === selected.id)
        ? "rewatch"
        : "initial",
    });
  }

  function resumeEntry(entry: DiaryEntry, source = state) {
    const movie = movieById(entry.movieId);
    const ranked = source.ranked.find((film) => film.movieId === entry.movieId);
    if (!ranked || entry.rankingStatus === "pending") {
      setLog({
        ...emptyDraft(),
        movie,
        entryId: entry.id,
        watchedOn: entry.watchedOn,
        note: entry.note,
        visibility: entry.visibility,
        step: "verdict",
      });
      return;
    }
    const savedSession =
      source.activeRankingEntryId === entry.id &&
      source.activeRankingSession?.movieId === String(movie.id)
        ? source.activeRankingSession
        : null;
    const candidates = sortBucket(source.ranked, ranked.verdict)
      .filter((film) => film.movieId !== movie.id)
      .map((film) => ({
        movieId: String(film.movieId),
        similarity: movieSimilarity(movie, movieById(film.movieId)),
      }));
    const session = savedSession ?? startRanking({
      movieId: String(movie.id),
      verdict: ranked.verdict,
      candidates,
    });
    setLog({
      ...emptyDraft(),
      movie,
      entryId: entry.id,
      watchedOn: entry.watchedOn,
      note: entry.note,
      visibility: entry.visibility,
      step:
        session.status === "complete"
          ? "result"
          : savedSession && (
              source.activeRankingStatus === "abandoned" ||
              isAbandonedSession(source.activeRankingLastActivityAt)
            )
            ? "resume"
            : "compare",
      reason: source.activeRankingReason ?? (entry.isRewatch ? "rewatch" : "initial"),
      verdict: ranked.verdict,
      session,
      sessionId: source.activeRankingSessionId ?? null,
      sessionRevision: source.activeRankingRevision ?? 0,
      rankBefore: source.activeRankingOriginalRank ?? null,
      verdictBefore: source.activeRankingOriginalVerdict ?? null,
      resultRank: session.status === "complete" ? 1 : null,
    });
  }

  function saveWatch(dnf = false) {
    if (requireSignIn()) return;
    if (!log?.movie || !isValidLocalDate(log.watchedOn)) return;
    if (connection) {
      const draft = log;
      const existingRank = state.ranked.find(
        (film) => film.movieId === draft.movie!.id,
      );
      runConnected(async () => {
        const entry = await insertWatchEntry(connection.client, {
          userId: connection.userId,
          movie: draft.movie!,
          watchedOn: draft.watchedOn,
          note: draft.note,
          visibility: draft.visibility,
          dnf,
        });
        await refreshConnectedState();
        setLog((current) =>
          current
            ? {
                ...current,
                entryId: entry.id,
                dnf,
                reason: existingRank ? "rewatch" : "initial",
                step: dnf ? "result" : existingRank ? "rewatch" : "verdict",
              }
            : current,
        );
      });
      return;
    }
    const authoritative = readAuthoritativeState();
    if (authoritative.activeRankingSession) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const existingRank = authoritative.ranked.find(
      (film) => film.movieId === log.movie?.id,
    );
    const entryId = `watch-${log.movie.id}-${Date.now()}`;
    const entry: DiaryEntry = {
      id: entryId,
      movieId: log.movie.id,
      watchedOn: log.watchedOn,
      note: log.note.trim(),
      visibility: log.visibility,
      completionStatus: dnf ? "dnf" : "completed",
      rankingStatus: dnf
        ? "not_applicable"
        : existingRank
          ? "complete"
          : "pending",
      isRewatch:
        !dnf &&
        authoritative.diary.some(
          (item) =>
            item.movieId === log.movie?.id && item.completionStatus === "completed",
        ),
      createdAt: new Date().toISOString(),
    };
    writeAuthoritativeState({
      ...authoritative,
      diary: [entry, ...authoritative.diary],
      watchlist: dnf
        ? authoritative.watchlist
        : authoritative.watchlist.filter((item) => item.movieId !== log.movie?.id),
    });

    if (dnf) {
      updateDraft({ entryId, dnf: true, step: "result" });
    } else if (existingRank) {
      updateDraft({ entryId, reason: "rewatch", step: "rewatch" });
    } else {
      updateDraft({ entryId, reason: "initial", step: "verdict" });
    }
  }

  function keepRewatchPlacement() {
    if (!log?.movie) return;
    const row = canon.find((item) => item.movie.id === log.movie?.id);
    updateDraft({
      step: "result",
      resultRank: row?.rank ?? null,
      resultScore: row?.score ?? null,
    });
  }

  async function finishConnectedRanking(
    session: RankingSession,
    draft: LogDraft,
  ): Promise<void> {
    if (!connection || !draft.sessionId || !draft.movie) return;
    let next: AppState;
    try {
      await commitRankingRecord(
        connection.client,
        draft.sessionId,
        session.placementConfidence,
      );
      next = await refreshConnectedState();
    } catch (error) {
      next = await refreshConnectedState();
      if (!(next.committedRankingSessionIds ?? []).includes(draft.sessionId)) {
        throw error;
      }
    }
    const row = canonFromState(next).find(
      (item) => item.movie.id === draft.movie!.id,
    );
    setLog({
      ...draft,
      session,
      step: "result",
      resultRank: row?.rank ?? null,
      resultScore: row?.score ?? null,
    });
  }

  function beginRanking(verdict: Verdict) {
    if (requireSignIn()) return;
    if (!log?.movie) return;
    if (connection) {
      const draft = log;
      const movie = log.movie;
      const bucket = sortBucket(state.ranked, verdict).filter(
        (film) => film.movieId !== movie.id,
      );
      const session = startRanking({
        movieId: String(movie.id),
        verdict,
        candidates: bucket.map((film) => ({
          movieId: String(film.movieId),
          similarity: movieSimilarity(movie, movieById(film.movieId)),
        })),
      });
      const previous = canon.find((row) => row.movie.id === movie.id);
      runConnected(async () => {
        const sessionId = await beginRankingRecord(connection.client, {
          movieId: movie.id,
          watchEntryId: draft.reason === "manual" ? null : draft.entryId,
          reason:
            draft.reason === "manual"
              ? "manual_rerank"
              : draft.reason === "rewatch"
                ? "rewatch"
                : "initial_log",
          verdict,
        });
        const fresh = await refreshConnectedState();
        const restored = fresh.activeRankingSession ?? session;
        const nextDraft: LogDraft = {
          ...draft,
          verdict,
          session: restored,
          sessionId,
          sessionRevision: fresh.activeRankingRevision ?? 0,
          step: restored.status === "complete" ? "result" : "compare",
          rankBefore: previous?.rank ?? null,
          verdictBefore: previous?.ranked.verdict ?? null,
        };
        if (restored.status === "complete") {
          await finishConnectedRanking(restored, nextDraft);
        } else {
          setLog(nextDraft);
        }
      });
      return;
    }
    runWithRankingLock(() => beginRankingLocal(verdict));
  }

  function beginRankingLocal(verdict: Verdict) {
    if (!log?.movie) return;
    const authoritative = readAuthoritativeState();
    if (authoritative.activeRankingSession) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const bucket = sortBucket(authoritative.ranked, verdict).filter(
      (film) => film.movieId !== log.movie?.id,
    );
    const session = startRanking({
      movieId: String(log.movie.id),
      verdict,
      candidates: bucket.map((film) => ({
        movieId: String(film.movieId),
        similarity: movieSimilarity(log.movie!, movieById(film.movieId)),
      })),
    });
    const previous = canonFromState(authoritative).find(
      (row) => row.movie.id === log.movie?.id,
    );
    const nextDraft = {
      ...log,
      verdict,
      session,
      sessionId: crypto.randomUUID(),
      sessionRevision: 0,
      step: "compare" as const,
      rankBefore: previous?.rank ?? null,
      verdictBefore: previous?.ranked.verdict ?? null,
    };
    if (!persistSessionProgress(session, nextDraft, authoritative)) {
      adoptAuthoritativeSession(readAuthoritativeState());
      return;
    }
    if (session.status === "complete") commitSession(session, nextDraft);
    else setLog(nextDraft);
  }

  function persistSessionProgress(
    session: RankingSession,
    draft: LogDraft,
    source?: AppState,
  ): boolean {
    if (!draft.movie || !draft.sessionId) return false;
    const movieId = draft.movie.id;
    const current = source ?? readAuthoritativeState();
    if (
      current.activeRankingSessionId &&
      (current.activeRankingSessionId !== draft.sessionId ||
        (current.activeRankingRevision ?? 0) !== draft.sessionRevision - 1)
    ) {
      return false;
    }
    if (
      !current.activeRankingSessionId &&
      draft.sessionRevision !== 0
    ) {
      return false;
    }
    const bucket = sortBucket(current.ranked, session.verdict).filter(
      (film) => film.movieId !== movieId,
    );
    const existing = current.ranked.find((film) => film.movieId === movieId);
    const now = new Date().toISOString();
    const provisional: RankedFilm = {
      movieId,
      verdict: session.verdict,
      sortPosition: insertionPosition(bucket, session.placementIndex),
      placementConfidence: session.placementConfidence,
      comparisonCount: session.decisiveAnswers,
      firstRankedAt: existing?.firstRankedAt ?? now,
      lastRankedAt: now,
    };
    const next: AppState = {
      ...current,
      ranked: [
        ...current.ranked.filter((film) => film.movieId !== movieId),
        provisional,
      ],
      diary: current.diary.map((entry) =>
        entry.id === draft.entryId ? { ...entry, rankingStatus: "in_progress" } : entry,
      ),
      activeRankingSession: session,
      activeRankingEntryId: draft.entryId,
      activeRankingOriginalRank: draft.rankBefore,
      activeRankingOriginalVerdict: draft.verdictBefore,
      activeRankingLastActivityAt: now,
      activeRankingSessionId: draft.sessionId,
      activeRankingRevision: draft.sessionRevision,
      activeRankingReason: draft.reason,
    };
    writeAuthoritativeState(next);
    return true;
  }

  function commitSession(session: RankingSession, draft = log) {
    if (!draft?.movie || !draft.sessionId) return;
    const authoritative = readAuthoritativeState();
    if ((authoritative.committedRankingSessionIds ?? []).includes(draft.sessionId)) {
      setState(authoritative);
      setLog(null);
      return;
    }
    if (!draftMatchesAuthority(draft, authoritative)) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const movie = draft.movie;
    const verdict = session.verdict;
    const bucketBefore = sortBucket(authoritative.ranked, verdict).filter(
      (film) => film.movieId !== movie.id,
    );
    const sortPosition = insertionPosition(bucketBefore, session.placementIndex);
    const now = new Date().toISOString();
    const existing = authoritative.ranked.find((film) => film.movieId === movie.id);
    const finalFilm: RankedFilm = {
      movieId: movie.id,
      verdict,
      sortPosition,
      placementConfidence: session.placementConfidence,
      comparisonCount: session.decisiveAnswers,
      firstRankedAt: existing?.firstRankedAt ?? now,
      lastRankedAt: now,
    };
    const nextRanked = [
      ...authoritative.ranked.filter((film) => film.movieId !== movie.id),
      finalFilm,
    ];
    const preceding = nextRanked.filter(
      (film) => verdictPriority[film.verdict] < verdictPriority[verdict],
    ).length;
    const bucketSize = nextRanked.filter((film) => film.verdict === verdict).length;
    const withinBucketRank = session.placementIndex + 1;
    const score =
      nextRanked.length >= 5
        ? deriveScore(verdict, withinBucketRank, bucketSize)
        : null;
    const rankAfter = preceding + withinBucketRank;
    const eventTime = new Date().toISOString();
    const events = comparisonEventDrafts(session).map((event) => ({
      id: `comparison-${draft.sessionId}-${event.sequence}`,
      sessionId: draft.sessionId!,
      sessionMovieId: movie.id,
      opponentMovieId: Number(event.existingMovieId),
      winnerMovieId: Number(event.winnerId),
      sequence: event.sequence,
      createdAt: eventTime,
    }));
    const historyReason =
      draft.reason === "manual"
        ? "manual_rerank"
        : draft.reason === "rewatch"
          ? "rewatch"
          : "initial_log";

    const next: AppState = {
      ...authoritative,
      ranked: [
        ...authoritative.ranked.filter((film) => film.movieId !== movie.id),
        finalFilm,
      ],
      diary: authoritative.diary.map((entry) =>
        entry.id === draft.entryId ? { ...entry, rankingStatus: "complete" } : entry,
      ),
      watchlist: authoritative.watchlist.filter((item) => item.movieId !== movie.id),
      comparisons: [
        ...(authoritative.comparisons ?? []).filter(
          (event) => event.sessionId !== draft.sessionId,
        ),
        ...events,
      ],
      rankHistory: [
        {
          id: `rank-${draft.sessionId}`,
          sessionId: draft.sessionId,
          movieId: movie.id,
          rankBefore: draft.rankBefore,
          rankAfter,
          verdictBefore: draft.verdictBefore,
          verdictAfter: verdict,
          reason: historyReason,
          createdAt: eventTime,
        },
        ...(authoritative.rankHistory ?? []).filter(
          (entry) => entry.sessionId !== draft.sessionId,
        ),
      ],
      activeRankingSession: null,
      activeRankingEntryId: null,
      activeRankingOriginalRank: null,
      activeRankingOriginalVerdict: null,
      activeRankingLastActivityAt: null,
      activeRankingSessionId: null,
      activeRankingRevision: 0,
      activeRankingReason: null,
      committedRankingSessionIds: [
        ...(authoritative.committedRankingSessionIds ?? []).filter(
          (sessionId) => sessionId !== draft.sessionId,
        ),
        draft.sessionId,
      ],
    };
    writeAuthoritativeState(next);
    setLog({
      ...draft,
      session,
      step: "result",
      resultRank: rankAfter,
      resultScore: score,
    });
  }

  function answer(outcome: "new_wins" | "existing_wins" | "too_close") {
    if (requireSignIn()) return;
    if (!log?.session || !log.sessionId) return;
    if (connection) {
      const draft = log;
      const session = log.session;
      const comparison = getNextComparison(session);
      if (!comparison) return;
      const updated = answerComparison(session, {
        comparatorId: comparison.comparatorId,
        outcome,
      });
      const nextDraft: LogDraft = {
        ...draft,
        session: updated,
        sessionRevision: draft.sessionRevision + 1,
      };
      runConnected(async () => {
        try {
          await recordRankingAnswer(connection.client, {
            sessionId: draft.sessionId!,
            opponentMovieId: Number(comparison.comparatorId),
            winnerMovieId:
              outcome === "too_close"
                ? null
                : outcome === "new_wins"
                  ? draft.movie!.id
                  : Number(comparison.comparatorId),
          });
        } catch (error) {
          const fresh = await refreshConnectedState();
          adoptAuthoritativeSession(fresh);
          throw error;
        }
        if (updated.status === "complete") {
          await finishConnectedRanking(updated, nextDraft);
          return;
        }
        const fresh = await refreshConnectedState();
        const restored = fresh.activeRankingSession ?? updated;
        setLog({
          ...nextDraft,
          session: restored,
          sessionRevision: fresh.activeRankingRevision ?? nextDraft.sessionRevision,
        });
      });
      return;
    }
    runWithRankingLock(() => answerLocal(outcome));
  }

  function answerLocal(outcome: "new_wins" | "existing_wins" | "too_close") {
    if (!log?.session || !log.sessionId) return;
    const authoritative = readAuthoritativeState();
    if (!draftMatchesAuthority(log, authoritative)) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const currentSession = authoritative.activeRankingSession!;
    const shownComparison = getNextComparison(log.session);
    const currentComparison = getNextComparison(currentSession);
    if (
      !shownComparison ||
      !currentComparison ||
      shownComparison.comparatorId !== currentComparison.comparatorId
    ) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const updated = answerComparison(currentSession, {
      comparatorId: currentComparison.comparatorId,
      outcome,
    });
    const draft = {
      ...log,
      session: updated,
      sessionRevision: log.sessionRevision + 1,
    };
    if (!persistSessionProgress(updated, draft, authoritative)) {
      adoptAuthoritativeSession(readAuthoritativeState());
      return;
    }
    if (updated.status === "complete") commitSession(updated, draft);
    else setLog(draft);
  }

  function undoComparison() {
    if (requireSignIn()) return;
    if (!log?.session || !log.sessionId) return;
    if (connection) {
      const draft = log;
      runConnected(async () => {
        await undoRankingAnswer(connection.client, draft.sessionId!);
        const fresh = await refreshConnectedState();
        const restored = fresh.activeRankingSession;
        if (!restored) return;
        setLog({
          ...draft,
          session: restored,
          sessionRevision: fresh.activeRankingRevision ?? 0,
          step: "compare",
        });
      });
      return;
    }
    runWithRankingLock(undoComparisonLocal);
  }

  function undoComparisonLocal() {
    if (!log?.session || !log.sessionId) return;
    const authoritative = readAuthoritativeState();
    if (!draftMatchesAuthority(log, authoritative)) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const restored = undoLastAnswer(authoritative.activeRankingSession!);
    const draft = {
      ...log,
      session: restored,
      sessionRevision: log.sessionRevision + 1,
    };
    if (!persistSessionProgress(restored, draft, authoritative)) {
      adoptAuthoritativeSession(readAuthoritativeState());
      return;
    }
    setLog(draft);
  }

  function acceptPlacement() {
    if (requireSignIn()) return;
    if (!log?.session || !log.sessionId) return;
    if (connection) {
      const draft = log;
      const accepted = acceptCurrentPlacement(log.session);
      runConnected(() => finishConnectedRanking(accepted, {
        ...draft,
        session: accepted,
        sessionRevision: draft.sessionRevision + 1,
      }));
      return;
    }
    runWithRankingLock(acceptPlacementLocal);
  }

  function acceptPlacementLocal() {
    if (!log?.session || !log.sessionId) return;
    const authoritative = readAuthoritativeState();
    if (!draftMatchesAuthority(log, authoritative)) {
      adoptAuthoritativeSession(authoritative);
      return;
    }
    const accepted = acceptCurrentPlacement(authoritative.activeRankingSession!);
    const draft = {
      ...log,
      session: accepted,
      sessionRevision: log.sessionRevision + 1,
    };
    if (!persistSessionProgress(accepted, draft, authoritative)) {
      adoptAuthoritativeSession(readAuthoritativeState());
      return;
    }
    commitSession(accepted, draft);
  }

  function resumeRankingFlow() {
    if (!log?.session || !log.sessionId) return;
    if (log.session.status === "complete") {
      acceptPlacement();
      return;
    }
    if (connection && state.activeRankingStatus === "abandoned") {
      const draft = log;
      runConnected(async () => {
        await resumeRankingRecord(connection.client, draft.sessionId!);
        const fresh = await refreshConnectedState();
        setLog({
          ...draft,
          session: fresh.activeRankingSession ?? draft.session,
          sessionRevision: fresh.activeRankingRevision ?? draft.sessionRevision,
          step: "compare",
        });
      });
      return;
    }
    updateDraft({ step: "compare" });
  }

  function startManualRerank(movie: Movie) {
    if (requireSignIn()) return;
    const authoritative = readAuthoritativeState();
    const unresolved = authoritative.diary.some(
      (entry) => entry.rankingStatus === "pending" || entry.rankingStatus === "in_progress",
    );
    if (authoritative.activeRankingSession || unresolved) {
      openLogger();
      return;
    }
    setSelectedFilm(null);
    const current = authoritative.ranked.find((film) => film.movieId === movie.id);
    setLog({
      ...emptyDraft(),
      movie,
      step: "verdict",
      reason: "manual",
      verdict: current?.verdict ?? null,
    });
  }

  function toggleWatchlist(movieId: number) {
    if (requireSignIn()) return;
    if (connection) {
      const movie = movieById(movieId);
      const shouldAdd = !state.watchlist.some((item) => item.movieId === movieId);
      runConnected(async () => {
        await setWatchlistItem(connection.client, {
          userId: connection.userId,
          movie,
          shouldAdd,
        });
        await refreshConnectedState();
      });
      return;
    }
    setState((current) => {
      const exists = current.watchlist.some((item) => item.movieId === movieId);
      return {
        ...current,
        watchlist: exists
          ? current.watchlist.filter((item) => item.movieId !== movieId)
          : [{ movieId, addedAt: new Date().toISOString() }, ...current.watchlist],
      };
    });
  }

  function openView(next: View) {
    setSelectedFilm(null);
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openPublicProfile(profile: PublicProfile) {
    const client = connection?.client ?? publicClient;
    if (!client || peopleBusy) return;
    setPeopleBusy(true);
    setOperationError("");
    void loadPublicProfileState(client, profile.id)
      .then(setSelectedPublicProfile)
      .catch((error) => setOperationError(readableError(error)))
      .finally(() => setPeopleBusy(false));
  }

  function openDiscoveredFilm(movie: Movie) {
    cacheMovies([movie]);
    setState((current) => ({
      ...current,
      movieCache: [
        ...(current.movieCache ?? []).filter((cached) => cached.id !== movie.id),
        movie,
      ],
    }));
    setSelectedFilm(movie);
  }

  const discoveryMovieResults = useMemo(() => {
    const query = discoveryQuery.trim().toLowerCase();
    if (query.length < 2) return [];
    const results = movies.filter(
      (movie) => movie.title.toLowerCase().includes(query) || movie.director.toLowerCase().includes(query),
    );
    if (discoveryMovies.query === query) {
      discoveryMovies.results.forEach((movie) => {
        if (!results.some((result) => result.id === movie.id)) results.push(movie);
      });
    }
    return results.slice(0, 12);
  }, [discoveryMovies, discoveryQuery]);

  return (
    <div className={`app-shell${publicMode ? " public-shell" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}`} aria-busy={operationBusy}>
      <header className="site-header">
        <div className="sidebar-brand-row">
          <button className="wordmark" onClick={() => openView("home")} aria-label="After Credits home">
            <FilmRollIcon />
            <span className="sidebar-brand-name">After Credits</span>
          </button>
          <button className="sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <SidebarToggleIcon />
          </button>
        </div>
        <button className="sidebar-primary" onClick={openLogger} disabled={operationBusy} title="Log a film">
          <PlusIcon />
          <span>Log a film</span>
        </button>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {(["home", "diary", "canon", "watchlist", "search", "profile"] as View[]).map((item) => (
            <button
              key={item}
              className={view === item ? "active" : ""}
              onClick={() => openView(item)}
              title={viewLabels[item]}
            >
              <NavIcon view={item} />
              <span className="nav-label">{viewLabels[item]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {publicMode ? (
            <button className="header-sign-in" onClick={onSignIn} title="Sign in">
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M7 3.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H7M10.5 5.5 14 9l-3.5 3.5M6.5 9H14" /></svg>
              <span>Sign in</span>
            </button>
          ) : connection && activeProfile ? (
            <button
              className="sidebar-account"
              aria-label="Open profile and settings"
              title={`Profile @${activeProfile.username}`}
              onClick={() => setProfileOpen(true)}
              disabled={operationBusy}
            >
              <span className="icon-button" aria-hidden="true">
                {(activeProfile.displayName || activeProfile.username)
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("")}
              </span>
              <span className="sidebar-account-name">{activeProfile.displayName || `@${activeProfile.username}`}</span>
            </button>
          ) : (
            <span className="local-mode-badge" title="Diary is stored on this device only"><span className="icon-button" aria-hidden="true">L</span><span className="sidebar-account-name">Local device</span></span>
          )}
          <button className="sidebar-about" onClick={() => setAboutOpen(true)}>About &amp; credits</button>
        </div>
      </header>

      {operationError ? (
        <button
          className="operation-error"
          type="button"
          role="alert"
          onClick={() => setOperationError("")}
        >
          {operationError} <span aria-hidden="true">×</span>
        </button>
      ) : null}

      <main>
        {view === "home" ? (
          publicMode ? (
            <Landing
              onSignIn={() => onSignIn?.()}
              onBrowse={() => openView("search")}
              onFilm={setSelectedFilm}
            />
          ) : (
            <HomeView
              latest={latest}
              movie={latestMovie}
              canonRow={latestCanon}
              diary={diary}
              stats={stats}
              unfinishedMovie={unfinishedMovie}
              onResume={openLogger}
              onLog={openLogger}
              onFilm={setSelectedFilm}
              onViewDiary={() => openView("diary")}
            />
          )
        ) : null}

        {view === "diary" ? (
          <DiaryView
            groups={diaryGroups}
            state={state}
            canon={canon}
            onFilm={setSelectedFilm}
            onLog={openLogger}
          />
        ) : null}

        {view === "canon" ? (
          <CanonView
            rows={visibleCanon}
            total={canon.length}
            diary={state.diary}
            query={canonQuery}
            verdict={canonVerdict}
            onQuery={setCanonQuery}
            onVerdict={setCanonVerdict}
            onFilm={setSelectedFilm}
            onLog={openLogger}
          />
        ) : null}

        {view === "watchlist" ? (
          <WatchlistView
            items={state.watchlist}
            onFilm={setSelectedFilm}
            onRemove={toggleWatchlist}
            onLog={openMovieLogger}
          />
        ) : null}

        {view === "search" ? (
          <SearchView
            query={discoveryQuery}
            movies={discoveryMovieResults}
            profiles={peopleResults}
            movieBusy={discoveryMovieBusy}
            profileBusy={peopleBusy}
            movieError={discoveryMovies.query === discoveryQuery.trim().toLowerCase() ? discoveryMovies.error : ""}
            profilesAvailable={Boolean(connection?.client ?? publicClient)}
            onQuery={setDiscoveryQuery}
            onFilm={openDiscoveredFilm}
            onProfile={openPublicProfile}
          />
        ) : null}

        {view === "profile" ? (
          <ProfileView
            profile={activeProfile}
            state={state}
            canon={canon}
            localMode={!connection}
            signedOut={publicMode}
            onFilm={setSelectedFilm}
            onSettings={() => connection ? setProfileOpen(true) : undefined}
            onSignIn={() => onSignIn?.()}
          />
        ) : null}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {(["home", "diary", "canon", "search", "profile"] as View[]).map((item) => (
          <button
            key={item}
            className={view === item ? "active" : ""}
            onClick={() => openView(item)}
          >
            <NavIcon view={item} />
            <span>{viewLabels[item]}</span>
          </button>
        ))}
        <button className="mobile-log" onClick={openLogger} aria-label="Log a film">
          <PlusIcon />
        </button>
      </nav>

      {selectedFilm ? (
        <FilmDetail
          key={selectedFilm.id}
          movie={selectedFilm}
          state={state}
          canon={canon}
          onClose={() => setSelectedFilm(null)}
          onLog={() => openMovieLogger(selectedFilm)}
          onRerank={() => startManualRerank(selectedFilm)}
          onWatchlist={() => toggleWatchlist(selectedFilm.id)}
        />
      ) : null}

      {log ? (
        <LogFilmFlow
          draft={log}
          canon={canon}
          onUpdate={updateDraft}
          onSave={saveWatch}
          onKeepRewatch={keepRewatchPlacement}
          onVerdict={beginRanking}
          onAnswer={answer}
          onUndo={undoComparison}
          onAccept={acceptPlacement}
          onResume={resumeRankingFlow}
          onClose={() => setLog(null)}
          onOpenFilm={(movie) => {
            setLog(null);
            setSelectedFilm(movie);
          }}
        />
      ) : null}

      {aboutOpen ? <AboutSheet onClose={() => setAboutOpen(false)} /> : null}
      {selectedPublicProfile ? (
        <PublicProfileSheet data={selectedPublicProfile} onClose={() => setSelectedPublicProfile(null)} onFilm={(movie) => { setSelectedPublicProfile(null); setSelectedFilm(movie); }} />
      ) : null}
      {profileOpen && connection && activeProfile ? (
        <ProfileSheet
          profile={activeProfile}
          busy={operationBusy}
          error={operationError}
          onSave={saveProfileSettings}
          onSignOut={() => runConnected(connection.signOut)}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </div>
  );
}
