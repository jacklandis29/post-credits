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
import { parseLocalState, safelyWriteLocalState, serializeLocalState } from "@/lib/local-state";
import { exportUserData } from "@/lib/export";
import {
  beginRankingRecord,
  commitRankingRecord,
  insertWatchEntry,
  loadPublicProfileByUsername,
  loadPublicProfileState,
  recordRankingAnswer,
  resumeRankingRecord,
  saveReviewRecord,
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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import SupabaseGate, { type ConnectedSupabase } from "./SupabaseGate";
import { CanonView } from "./components/CanonView";
import { DiaryView } from "./components/DiaryView";
import { FilmDetail } from "./components/FilmDetail";
import { HomeView } from "./components/HomeView";
import { InsightsView } from "./components/InsightsView";
import { Landing } from "./components/Landing";
import {
  emptyDraft,
  LogFilmFlow,
  type LogDraft,
} from "./components/LogFlow";
import { QuickSearchModal, SearchView } from "./components/SearchView";
import { ProfileView } from "./components/ProfileView";
import { WatchlistView } from "./components/WatchlistView";
import { AboutSheet, ImportLocalSheet, ProfileSheet, PublicProfileSheet } from "./components/sheets";
import { FilmRollIcon, LockIcon, NavIcon, SearchIcon, SidebarToggleIcon, type View } from "./components/icons";

const STORAGE_KEY = "after-credits-local-v2";
const IMPORT_DECIDED_KEY = "post-credits-import-decided-v1";
const PENDING_LOG_KEY = "after-credits-pending-log-v1";
const SIDEBAR_KEY = "after-credits-sidebar-collapsed";
const IMPORT_PROGRESS_KEY = "post-credits-import-progress-v1";

const views: View[] = ["home", "diary", "canon", "stats", "watchlist", "search", "profile"];

function viewFromLocation(): View {
  const candidate = new URLSearchParams(window.location.search).get("view");
  return views.includes(candidate as View) ? (candidate as View) : "home";
}

function urlForView(view: View): string {
  const url = new URL(window.location.href);
  if (view === "home") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  url.searchParams.delete("film");
  return `${url.pathname}${url.search}${url.hash}`;
}

function urlForFilm(movieId: number): string {
  const url = new URL(window.location.href);
  url.searchParams.set("film", String(movieId));
  return `${url.pathname}${url.search}${url.hash}`;
}

function filmIdFromLocation(): number | null {
  const value = new URLSearchParams(window.location.search).get("film");
  if (!value || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function removeFilmFromLocation(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("film")) return;
  url.searchParams.delete("film");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

const viewLabels: Record<View, string> = {
  home: "Home",
  diary: "Diary",
  canon: "Ranking",
  stats: "Stats",
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
      {(connection, requestSignIn) => (
        <AfterCreditsCore
          key={connection?.userId ?? "local"}
          connection={connection}
          onSignIn={requestSignIn}
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
  const [peopleSearch, setPeopleSearch] = useState<{
    query: string;
    results: PublicProfile[];
  }>({ query: "", results: [] });
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [selectedPublicProfile, setSelectedPublicProfile] = useState<PublicProfileState | null>(null);
  const [publicFilmContext, setPublicFilmContext] = useState<PublicProfileState | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState(connection?.profile ?? null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTransitioning, setSidebarTransitioning] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [importOffer, setImportOffer] = useState<AppState | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const importedEntryIds = useRef<Set<string>>(new Set());
  const operationBusyRef = useRef(false);
  const filmRestoreGeneration = useRef(0);
  const sidebarTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeLogStep = log?.step ?? null;

  useLayoutEffect(() => {
    queueMicrotask(() => setView(viewFromLocation()));
  }, []);

  useEffect(() => {
    function restoreViewFromHistory() {
      setSelectedFilm(null);
      setLog(null);
      setView(viewFromLocation());
      window.scrollTo({ top: 0 });
    }
    window.addEventListener("popstate", restoreViewFromHistory);
    return () => window.removeEventListener("popstate", restoreViewFromHistory);
  }, []);

  useEffect(() => {
    async function restoreFilmFromLocation() {
      const generation = ++filmRestoreGeneration.current;
      const movieId = filmIdFromLocation();
      if (!movieId) {
        setSelectedFilm(null);
        return;
      }
      let movie = movieById(movieId);
      try {
        const response = await fetch(`/api/tmdb/movie/${movieId}`);
        if (response.ok) {
          const payload = (await response.json()) as { movie?: Movie };
          if (payload.movie) {
            movie = payload.movie;
            cacheMovies([movie]);
          }
        }
      } catch {
        // Cached film data is enough to restore the sheet when offline.
      }
      if (generation === filmRestoreGeneration.current && filmIdFromLocation() === movieId) {
        setSelectedFilm(movie);
      }
    }

    function restoreFilmFromHistory() {
      void restoreFilmFromLocation();
    }

    void restoreFilmFromLocation();
    window.addEventListener("popstate", restoreFilmFromHistory);
    return () => {
      filmRestoreGeneration.current += 1;
      window.removeEventListener("popstate", restoreFilmFromHistory);
    };
  }, []);

  useLayoutEffect(() => {
    const collapsed = window.localStorage.getItem(SIDEBAR_KEY) === "true";
    queueMicrotask(() => setSidebarCollapsed(collapsed));
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const initialCollapsed = root.classList.contains("sidebar-collapsed-initial");
    if (sidebarCollapsed === initialCollapsed) {
      root.classList.remove("sidebar-collapsed-initial");
    }
  }, [sidebarCollapsed]);

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
    if (sidebarTransitionTimer.current) clearTimeout(sidebarTransitionTimer.current);
    setSidebarTransitioning(true);
    sidebarTransitionTimer.current = setTimeout(() => {
      setSidebarTransitioning(false);
      sidebarTransitionTimer.current = null;
    }, 240);
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }

  useEffect(() => () => {
    if (sidebarTransitionTimer.current) clearTimeout(sidebarTransitionTimer.current);
  }, []);

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
      if (saved) savedState = parseLocalState(saved);
    } catch {
      queueMicrotask(() => setOperationError("The saved local diary could not be read. It has been left in place so it can be recovered."));
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
    const result = safelyWriteLocalState(window.localStorage, STORAGE_KEY, state);
    if (result.error) queueMicrotask(() => setOperationError(result.error!));
  }, [connection, hydrated, publicMode, state]);

  useEffect(() => {
    if (connection || publicMode) return;
    function syncFromAnotherTab(event: StorageEvent) {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try {
        const incoming = parseLocalState(event.newValue);
        if (!incoming) return;
        const currentRevision = state.activeRankingRevision ?? 0;
        const incomingRevision = incoming.activeRankingRevision ?? 0;
        if (
          state.activeRankingSessionId &&
          incoming.activeRankingSessionId === state.activeRankingSessionId &&
          incomingRevision < currentRevision
        ) return;
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
  }, [connection, publicMode, state.activeRankingRevision, state.activeRankingSessionId]);

  useEffect(() => {
    function closeTopLayer(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (aboutOpen) setAboutOpen(false);
      else if (importOffer && !importBusy) setImportOffer(null);
      else if (accountMenuOpen) setAccountMenuOpen(false);
      else if (profileOpen) setProfileOpen(false);
      else if (selectedPublicProfile) setSelectedPublicProfile(null);
      else if (log) setLog(null);
      else if (selectedFilm) {
        removeFilmFromLocation();
        setSelectedFilm(null);
        if (publicFilmContext) {
          setSelectedPublicProfile(publicFilmContext);
          setPublicFilmContext(null);
        }
      }
      else if (quickSearchOpen) setQuickSearchOpen(false);
    }
    window.addEventListener("keydown", closeTopLayer);
    return () => window.removeEventListener("keydown", closeTopLayer);
  }, [aboutOpen, accountMenuOpen, importBusy, importOffer, log, profileOpen, publicFilmContext, quickSearchOpen, selectedFilm, selectedPublicProfile]);

  const hasAboutLayer = aboutOpen;
  const hasProfileLayer = profileOpen;
  const hasPublicProfileLayer = Boolean(selectedPublicProfile);
  const hasLogLayer = Boolean(log);
  const hasFilmLayer = Boolean(selectedFilm);
  const hasQuickSearchLayer = quickSearchOpen;
  const hasImportLayer = Boolean(importOffer);

  useEffect(() => {
    const anyLayer =
      hasAboutLayer || hasProfileLayer || hasPublicProfileLayer || hasLogLayer || hasFilmLayer ||
      hasQuickSearchLayer || hasImportLayer;
    document.documentElement.style.overflow = anyLayer ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [hasAboutLayer, hasFilmLayer, hasImportLayer, hasLogLayer, hasProfileLayer, hasPublicProfileLayer, hasQuickSearchLayer]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    function closeMenu(event: MouseEvent) {
      if ((event.target as HTMLElement | null)?.closest(".account-menu-anchor")) return;
      setAccountMenuOpen(false);
    }
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!connection || !hydrated) return;
    if (connection.initialState.diary.length > 0) return;
    if (window.localStorage.getItem(IMPORT_DECIDED_KEY)) return;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const local = parseLocalState(saved);
      if (!local) return;
      if (!local.diary?.length) return;
      cacheMovies(local.movieCache ?? []);
      queueMicrotask(() => setImportOffer(local));
    } catch {
      // A malformed local snapshot simply means there is nothing to offer.
    }
  }, [connection, hydrated]);

  useEffect(() => {
    const selector = hasImportLayer
      ? ".import-overlay"
      : hasAboutLayer
      ? ".about-overlay"
      : hasProfileLayer
        ? ".profile-overlay"
      : hasPublicProfileLayer
        ? ".public-profile-overlay"
      : hasLogLayer
        ? ".log-overlay"
        : hasFilmLayer
          ? ".film-sheet"
          : hasQuickSearchLayer
            ? ".quick-search-overlay"
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
    const preferred = root.querySelector<HTMLElement>("[autofocus], [data-modal-autofocus]") ?? focusables[0];
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
  }, [activeLogStep, hasAboutLayer, hasFilmLayer, hasImportLayer, hasLogLayer, hasProfileLayer, hasPublicProfileLayer, hasQuickSearchLayer]);

  useEffect(() => {
    const peopleClient = connection?.client ?? publicClient;
    const query = discoveryQuery.trim();
    const normalizedQuery = query.toLowerCase();
    if (!peopleClient || (view !== "search" && !quickSearchOpen) || query.length < 2) {
      queueMicrotask(() => {
        setPeopleSearch({ query: "", results: [] });
        setPeopleBusy(false);
      });
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPeopleBusy(true);
      void searchPublicProfiles(peopleClient, query)
        .then((results) => {
          if (!cancelled) setPeopleSearch({ query: normalizedQuery, results });
        })
        .catch((error) => {
          if (!cancelled) {
            setPeopleSearch({ query: normalizedQuery, results: [] });
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
  }, [connection, discoveryQuery, publicClient, quickSearchOpen, view]);

  useEffect(() => {
    const query = discoveryQuery.trim();
    const generation = ++discoveryGeneration.current;
    if ((view !== "search" && !quickSearchOpen) || query.length < 2) {
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
  }, [discoveryQuery, quickSearchOpen, view]);

  const diary = useMemo(() => sortDiary(state.diary), [state.diary]);
  const canon = useMemo(() => canonFromState(state), [state]);
  const completedDiary = diary.filter((entry) => entry.completionStatus === "completed");
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
    defaultNoteVisibility: "private" | "public";
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
    if (!connection || operationBusyRef.current) return;
    operationBusyRef.current = true;
    setOperationBusy(true);
    setOperationError("");
    void work()
      .catch((error) => setOperationError(readableError(error)))
      .finally(() => {
        operationBusyRef.current = false;
        setOperationBusy(false);
      });
  }

  async function importLocalDiary() {
    if (!connection || !importOffer || importBusy) return;
    setImportBusy(true);
    setOperationError("");
    try {
      try {
        const savedProgress = window.localStorage.getItem(IMPORT_PROGRESS_KEY);
        if (savedProgress) importedEntryIds.current = new Set(JSON.parse(savedProgress) as string[]);
      } catch {
        importedEntryIds.current.clear();
      }
      const localCache = importOffer.movieCache ?? [];
      const movieFor = (movieId: number) =>
        localCache.find((cached) => cached.id === movieId) ?? movieById(movieId);
      const entries = [...importOffer.diary].sort(
        (left, right) =>
          left.watchedOn.localeCompare(right.watchedOn) ||
          left.createdAt.localeCompare(right.createdAt),
      );
      let done = 0;
      for (const entry of entries) {
        if (!importedEntryIds.current.has(entry.id)) {
          await insertWatchEntry(connection.client, {
            userId: connection.userId,
            movie: movieFor(entry.movieId),
            watchedOn: entry.watchedOn,
            note: entry.note,
            visibility: entry.visibility,
            dnf: entry.completionStatus === "dnf",
            importKey: entry.id,
          });
          importedEntryIds.current.add(entry.id);
          window.localStorage.setItem(
            IMPORT_PROGRESS_KEY,
            JSON.stringify([...importedEntryIds.current]),
          );
        }
        done += 1;
        setImportProgress(done);
      }
      for (const item of importOffer.watchlist ?? []) {
        await setWatchlistItem(connection.client, {
          userId: connection.userId,
          movie: movieFor(item.movieId),
          shouldAdd: true,
        });
      }
      await refreshConnectedState();
      window.localStorage.setItem(
        `${STORAGE_KEY}-imported-backup`,
        serializeLocalState(importOffer),
      );
      window.localStorage.setItem(IMPORT_DECIDED_KEY, "imported");
      window.localStorage.removeItem(IMPORT_PROGRESS_KEY);
      window.localStorage.removeItem(STORAGE_KEY);
      setImportOffer(null);
    } catch (error) {
      setOperationError(readableError(error));
    } finally {
      setImportBusy(false);
    }
  }

  function dismissImport() {
    window.localStorage.setItem(IMPORT_DECIDED_KEY, "kept-local");
    setImportOffer(null);
  }

  function readAuthoritativeState(): AppState {
    if (connection || publicMode) return state;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseLocalState(saved);
        if (!parsed) return state;
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
      const result = safelyWriteLocalState(window.localStorage, STORAGE_KEY, next);
      if (result.error) setOperationError(result.error);
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
    removeFilmFromLocation();
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
    removeFilmFromLocation();
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
    if (connection && operationBusyRef.current) return;
    const shouldAdd = !state.watchlist.some((item) => item.movieId === movieId);
    const applyOptimisticState = (current: AppState, add: boolean): AppState => ({
      ...current,
      watchlist: add
        ? [{ movieId, addedAt: new Date().toISOString() }, ...current.watchlist.filter((item) => item.movieId !== movieId)]
        : current.watchlist.filter((item) => item.movieId !== movieId),
    });
    if (connection) setState((current) => applyOptimisticState(current, shouldAdd));
    if (connection) {
      const movie = movieById(movieId);
      runConnected(async () => {
        try {
          await setWatchlistItem(connection.client, {
            userId: connection.userId,
            movie,
            shouldAdd,
          });
          await refreshConnectedState();
        } catch (error) {
          setState((current) => applyOptimisticState(current, !shouldAdd));
          throw error;
        }
      });
      return;
    }
    writeAuthoritativeState(applyOptimisticState(readAuthoritativeState(), shouldAdd));
  }

  function saveReview(movie: Movie, body: string, visibility: "private" | "public") {
    if (requireSignIn()) return;
    const normalized = body.trim();
    if (connection) {
      runConnected(async () => {
        await saveReviewRecord(connection.client, { userId: connection.userId, movie, body: normalized, visibility });
        await refreshConnectedState();
      });
      return;
    }
    const now = new Date().toISOString();
    const current = readAuthoritativeState();
    const existing = current.reviews.find((review) => review.movieId === movie.id);
    writeAuthoritativeState({ ...current, reviews: normalized ? [
      ...current.reviews.filter((review) => review.movieId !== movie.id),
      { id: existing?.id ?? `local-review-${movie.id}`, movieId: movie.id, body: normalized, visibility, createdAt: existing?.createdAt ?? now, updatedAt: now },
    ] : current.reviews.filter((review) => review.movieId !== movie.id) });
  }

  function openView(next: View) {
    setQuickSearchOpen(false);
    setSelectedFilm(null);
    if (next !== viewFromLocation() || filmIdFromLocation()) {
      window.history.pushState(null, "", urlForView(next));
    }
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
    setQuickSearchOpen(false);
    cacheMovies([movie]);
    setState((current) => ({
      ...current,
      movieCache: [
        ...(current.movieCache ?? []).filter((cached) => cached.id !== movie.id),
        movie,
      ],
    }));
    openFilm(movie);
  }

  function openFilm(movie: Movie) {
    if (filmIdFromLocation() !== movie.id) {
      window.history.pushState({ afterCreditsFilm: true }, "", urlForFilm(movie.id));
    }
    setSelectedFilm(movie);
  }

  function openPublicProfileFilm(movie: Movie) {
    const context = selectedPublicProfile;
    setSelectedPublicProfile(null);
    openFilm(movie);
    setPublicFilmContext(context);
  }

  function closeFilm() {
    if (publicFilmContext) {
      removeFilmFromLocation();
      setSelectedFilm(null);
      setSelectedPublicProfile(publicFilmContext);
      setPublicFilmContext(null);
      return;
    }
    if (filmIdFromLocation() && window.history.state?.afterCreditsFilm) {
      window.history.back();
      return;
    }
    removeFilmFromLocation();
    setSelectedFilm(null);
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

  const normalizedDiscoveryQuery = discoveryQuery.trim().toLowerCase();
  const discoveryReady = normalizedDiscoveryQuery.length >= 2;
  const profilesAvailable = Boolean(connection?.client ?? publicClient);
  const visiblePeopleResults = peopleSearch.query === normalizedDiscoveryQuery
    ? peopleSearch.results
    : [];
  const movieSearchPending = discoveryReady && (
    discoveryMovieBusy || discoveryMovies.query !== normalizedDiscoveryQuery
  );
  const peopleSearchPending = discoveryReady && profilesAvailable && (
    peopleBusy || peopleSearch.query !== normalizedDiscoveryQuery
  );
  const selectedFilmState = publicFilmContext?.state ?? state;
  const selectedFilmCanon = publicFilmContext ? canonFromState(publicFilmContext.state) : canon;

  return (
    <div className={`app-shell${publicMode ? " public-shell" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}${sidebarTransitioning ? " sidebar-transitioning" : ""}`} aria-busy={operationBusy}>
      <header className={`site-header${accountMenuOpen ? " account-menu-open" : ""}`}>
        <div className="sidebar-brand-row">
          <button className="wordmark" onClick={() => openView("home")} aria-label="Post Credits home">
            <FilmRollIcon />
            <span className="sidebar-brand-name">Post Credits</span>
          </button>
          <button className="sidebar-toggle" type="button" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            <SidebarToggleIcon />
          </button>
        </div>
        <nav className="desktop-nav" aria-label="Primary navigation">
          {(["home", "diary", "canon", "stats", "watchlist", "search"] as View[]).map((item) => (
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
            <button className="header-sign-in" onClick={onSignIn} title="Sign in or create account">
              <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M7 3.5H4.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H7M10.5 5.5 14 9l-3.5 3.5M6.5 9H14" /></svg>
              <span>Sign in</span>
            </button>
          ) : (
            <div className="account-menu-anchor">
              {accountMenuOpen ? (
                <div className="account-menu" role="menu" aria-label="Account">
                  {connection && activeProfile ? (
                    <>
                      <div className="account-menu-identity">
                        <strong>{activeProfile.displayName || `@${activeProfile.username}`}</strong>
                        <small>@{activeProfile.username}{activeProfile.isPublic ? "" : <span className="privacy-lock" title="Private profile"><LockIcon /><span className="sr-only">Private profile</span></span>}</small>
                      </div>
                      <button role="menuitem" onClick={() => { setAccountMenuOpen(false); openView("profile"); }}>View profile</button>
                      <button role="menuitem" onClick={() => { setAccountMenuOpen(false); setProfileOpen(true); }}>Edit profile &amp; settings</button>
                      <button role="menuitem" className="account-menu-signout" disabled={operationBusy} onClick={() => { setAccountMenuOpen(false); runConnected(connection.signOut); }}>Sign out</button>
                    </>
                  ) : (
                    <>
                      <div className="account-menu-identity">
                        <strong>Local device</strong>
                        <small>This diary is stored only in this browser.</small>
                      </div>
                      {onSignIn ? (
                        <button role="menuitem" onClick={() => { setAccountMenuOpen(false); onSignIn(); }}>Sign in or create account</button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
              <button
                className="sidebar-account"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-label="Account menu"
                title={connection && activeProfile ? `@${activeProfile.username}` : "Local device"}
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                <span className="icon-button" aria-hidden="true">
                  {connection && activeProfile
                    ? (activeProfile.displayName || activeProfile.username)
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase())
                        .join("")
                    : "L"}
                </span>
                <span className="sidebar-account-name">
                  {connection && activeProfile
                    ? activeProfile.displayName || `@${activeProfile.username}`
                    : "Local device"}
                </span>
                <span className="account-menu-caret" aria-hidden="true">⌃</span>
              </button>
              <button
                className="account-profile-shortcut"
                type="button"
                aria-label="View profile"
                title="View profile"
                onClick={() => { setAccountMenuOpen(false); openView("profile"); }}
              >
                <NavIcon view="profile" />
              </button>
            </div>
          )}
          <button className="sidebar-about" onClick={() => setAboutOpen(true)}>About &amp; credits</button>
        </div>
      </header>

      {view !== "search" && !quickSearchOpen ? (
        <button className="global-search-button" type="button" onClick={() => { setDiscoveryQuery(""); setQuickSearchOpen(true); }} aria-label="Quick search" title="Search">
          <SearchIcon />
        </button>
      ) : null}

      {quickSearchOpen ? (
        <QuickSearchModal
          query={discoveryQuery}
          movies={discoveryMovieResults}
          profiles={visiblePeopleResults}
          movieBusy={movieSearchPending}
          profileBusy={peopleSearchPending}
          movieError={discoveryMovies.query === discoveryQuery.trim().toLowerCase() ? discoveryMovies.error : ""}
          profilesAvailable={profilesAvailable}
          onQuery={setDiscoveryQuery}
          onFilm={openDiscoveredFilm}
          onProfile={(profile) => { setQuickSearchOpen(false); openPublicProfile(profile); }}
          onClose={() => setQuickSearchOpen(false)}
          onViewAll={() => openView("search")}
        />
      ) : null}

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
              onFilm={openFilm}
            />
          ) : (
            <HomeView
              diary={diary}
              canon={canon}
              watchlist={state.watchlist}
              stats={stats}
              unfinishedMovie={unfinishedMovie}
              onResume={openLogger}
              onLog={openLogger}
              onFilm={openFilm}
              onViewDiary={() => openView("diary")}
              onViewWatchlist={() => openView("watchlist")}
            />
          )
        ) : null}

        {view === "diary" ? (
          <DiaryView
            groups={diaryGroups}
            state={state}
            canon={canon}
            onFilm={openFilm}
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
            onFilm={openFilm}
            onLog={openLogger}
          />
        ) : null}

        {view === "stats" ? <InsightsView state={state} canon={canon} onFilm={openFilm} /> : null}

        {view === "watchlist" ? (
          <WatchlistView
            items={state.watchlist}
            onFilm={openFilm}
            onRemove={toggleWatchlist}
            onLog={openMovieLogger}
          />
        ) : null}

        {view === "search" ? (
          <SearchView
            query={discoveryQuery}
            movies={discoveryMovieResults}
            profiles={visiblePeopleResults}
            movieBusy={movieSearchPending}
            profileBusy={peopleSearchPending}
            movieError={discoveryMovies.query === discoveryQuery.trim().toLowerCase() ? discoveryMovies.error : ""}
            profilesAvailable={profilesAvailable}
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
            onFilm={openFilm}
            onSettings={() => connection ? setProfileOpen(true) : undefined}
            onSignIn={() => onSignIn?.()}
            onStats={() => openView("stats")}
            onExport={(format) => exportUserData(activeProfile, state, format)}
          />
        ) : null}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {(["home", "diary", "canon", "stats", "watchlist", "profile"] as View[]).map((item) => (
          <button
            key={item}
            className={view === item ? "active" : ""}
            aria-current={view === item ? "page" : undefined}
            onClick={() => openView(item)}
          >
            <NavIcon view={item} />
            <span>{viewLabels[item]}</span>
          </button>
        ))}
      </nav>

      {selectedFilm ? (
        <FilmDetail
          key={selectedFilm.id}
          movie={selectedFilm}
          state={selectedFilmState}
          canon={selectedFilmCanon}
          onClose={closeFilm}
          onLog={() => openMovieLogger(selectedFilm)}
          onRerank={() => startManualRerank(selectedFilm)}
          onWatchlist={() => toggleWatchlist(selectedFilm.id)}
          onSaveReview={saveReview}
          readOnly={publicMode || Boolean(publicFilmContext)}
          profileLabel={publicFilmContext?.profile.displayName}
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
            openFilm(movie);
          }}
        />
      ) : null}

      {aboutOpen ? <AboutSheet onClose={() => setAboutOpen(false)} /> : null}
      {importOffer && connection ? (
        <ImportLocalSheet
          entryCount={importOffer.diary.length}
          watchlistCount={(importOffer.watchlist ?? []).length}
          busy={importBusy}
          progress={importProgress}
          error={operationError}
          onImport={() => void importLocalDiary()}
          onDismiss={dismissImport}
        />
      ) : null}
      {selectedPublicProfile ? (
        <PublicProfileSheet data={selectedPublicProfile} onClose={() => setSelectedPublicProfile(null)} onFilm={openPublicProfileFilm} />
      ) : null}
      {profileOpen && connection && activeProfile ? (
        <ProfileSheet
          profile={activeProfile}
          busy={operationBusy}
          error={operationError}
          onSave={saveProfileSettings}
          onSignOut={() => runConnected(connection.signOut)}
          onSignOutEverywhere={() => runConnected(connection.signOutEverywhere)}
          onDeleteAccount={(username) => runConnected(() => connection.deleteAccount(username))}
          onClose={() => setProfileOpen(false)}
        />
      ) : null}
    </div>
  );
}
