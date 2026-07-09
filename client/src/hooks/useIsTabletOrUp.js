import { useEffect, useState } from 'react';

// Tracks whether the viewport is iPad-portrait or wider. The new white-focused
// iPad/desktop layout kicks in at this breakpoint; below it, the existing
// mobile components render unchanged.
//
// 768px = iPad portrait width. The same layout flexes up to desktop sizes via
// CSS clamp() and grid templates inside each *IPad page.
const TABLET_BREAKPOINT = 768;

export function useIsTabletOrUp() {
  const initial = typeof window !== 'undefined'
    && window.innerWidth >= TABLET_BREAKPOINT;
  const [isTablet, setIsTablet] = useState(initial);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(min-width: ${TABLET_BREAKPOINT}px)`);
    const handler = (e) => setIsTablet(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    setIsTablet(mql.matches);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);

  return isTablet;
}
