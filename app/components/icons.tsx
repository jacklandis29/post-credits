import type { ReactNode } from "react";

export type View = "home" | "diary" | "canon" | "watchlist" | "search" | "profile";

/**
 * Brand mark: credit lines rolling off the top of the screen, and the one
 * thing still there when they're gone.
 */
export function FilmRollIcon() {
  return (
    <svg className="film-roll-logo" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 4.75h8" strokeWidth="1.9" strokeLinecap="round" opacity="0.28" />
      <path d="M5.5 9.25h13" strokeWidth="1.9" strokeLinecap="round" opacity="0.52" />
      <path d="M7 13.75h10" strokeWidth="1.9" strokeLinecap="round" opacity="0.78" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function NavIcon({ view }: { view: View }) {
  const paths: Record<View, ReactNode> = {
    home: <><path d="M3.5 8.2 9 3.8l5.5 4.4v6H10.8v-4H7.2v4H3.5z" /></>,
    diary: <><rect x="3" y="3.5" width="12" height="11" rx="1.5" /><path d="M6 2.5v3M12 2.5v3M3 7h12M6 9.5h2M10 9.5h2M6 12h2" /></>,
    canon: <><path d="M4 4h10M4 8h10M4 12h7" /><path d="m12.5 12.5 1.2 1.2 2.3-2.8" /></>,
    watchlist: <><path d="M5 2.8h8a.7.7 0 0 1 .7.7v11l-4.7-3.2L4.3 14.5v-11a.7.7 0 0 1 .7-.7z" /></>,
    search: <><circle cx="7.5" cy="7.5" r="4.5" /><path d="m10.9 10.9 3.7 3.7" /></>,
    profile: <><circle cx="9" cy="6.2" r="2.7" /><path d="M3.8 15c.4-3.2 2.2-4.8 5.2-4.8s4.8 1.6 5.2 4.8" /></>,
  };
  return <svg className="sidebar-nav-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">{paths[view]}</svg>;
}

export function SidebarToggleIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="13" height="12" rx="2" />
      <path d="M6.5 3v12" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3v12M3 9h12" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg className="search-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5" />
      <path d="m11.8 11.8 3.4 3.4" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg className="lock-icon" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="4" y="8" width="10" height="7" rx="2" />
      <path d="M6.5 8V6.2a2.5 2.5 0 0 1 5 0V8" />
    </svg>
  );
}
