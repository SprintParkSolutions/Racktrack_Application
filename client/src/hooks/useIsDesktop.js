import { useEffect, useState } from 'react';

// Tracks whether the viewport is wide enough to render the dedicated
// desktop / landscape layout. Mobile builds (under 1024px) always return
// false so the existing mobile components render unchanged. The check is
// re-evaluated on resize so DevTools device-toggling reflects immediately.
//
// 1024px is the standard landscape-tablet / small-laptop breakpoint —
// below that the layout would feel cramped for the side-by-side
// landscape design.
// Wait for a viewport wide enough that the sidebar + content layout has
// real room to breathe. Below this threshold the mobile build is a
// better experience.
const DESKTOP_BREAKPOINT = 1024;

// The sidebar shell wants LESS room than the side-by-side content layouts —
// a tablet in portrait (iPad ≈ 768–834px) comfortably fits sidebar + one
// column, so it gets the shell too. Content that needs real width for a
// two-up layout (e.g. side-by-side racks) keeps using useIsDesktop (1024).
const SIDEBAR_BREAKPOINT = 768;

// Shared matchMedia hook so DevTools/orientation changes re-evaluate live.
function useMinWidth(px) {
  const initial = typeof window !== 'undefined' && window.innerWidth >= px;
  const [matches, setMatches] = useState(initial);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(min-width: ${px}px)`);
    const handler = (e) => setMatches(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    setMatches(mql.matches);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, [px]);
  return matches;
}

export function useIsDesktop() {
  return useMinWidth(DESKTOP_BREAKPOINT);
}

// True once the viewport is wide enough for the sidebar shell (incl. iPad
// portrait). Used to decide DesktopShell vs. the bare mobile layout.
export function useHasSidebar() {
  return useMinWidth(SIDEBAR_BREAKPOINT);
}
