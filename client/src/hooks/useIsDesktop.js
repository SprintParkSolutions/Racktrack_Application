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

export function useIsDesktop() {
  const initial = typeof window !== 'undefined'
    && window.innerWidth >= DESKTOP_BREAKPOINT;
  const [isDesktop, setIsDesktop] = useState(initial);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const handler = (e) => setIsDesktop(e.matches);
    // matchMedia in older Safari uses addListener; modern uses addEventListener.
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    setIsDesktop(mql.matches);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);

  return isDesktop;
}
