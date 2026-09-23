import { useCallback, useEffect, useState } from 'react';
import { viewFor, viewsFor, setView as writeView } from '../utils/appView.js';

/* The role this account holds, as the server answers it.
 *
 * Kept here as well as on Home because the bar and the routes need it too,
 * and a second copy of the rules is how the bar and the page came to disagree
 * about who sees the Desk. */
export function roleOfUser(user, can) {
  // Same ladder, in the same order, as roleOf() on Home. They disagreed once:
  // this one read only the account's role, so an admin whose account row says
  // "member" but whose approvals answer says admin came out a technician, and
  // the toggle never appeared for them.
  const role = String(user?.role || '').toLowerCase();
  if (role === 'owner') return 'admin';
  if ((can && can.admin) || role === 'org_admin') return 'admin';
  if (can && can.spoc) return 'spoc';
  if (role === 'site_manager') return 'manager';
  return 'tech';
}

/**
 * Which view the app is in, and how to shift it.
 *
 * Takes the role this account holds - every caller already knows it, and
 * working it out again here cost a second request for /api/approvals/me on
 * every visit to Home. Use roleOfUser(user, can) above to get it.
 *
 * Returns { view, views, shift } - the view in force, the ones this person
 * may shift to (one of them when there is nothing to shift), and the setter.
 * Every consumer re-renders when the view moves, in this tab through the
 * 'rt-view' event and in another tab through 'storage'.
 */
export function useAppView(role = 'tech') {
  /* The view is WORKED OUT WHILE RENDERING, not kept in state and corrected
     by an effect. Until the server answers, every account reads as a
     technician, whose only view is Employee; an effect that fixed that
     afterwards meant an admin's first paint showed the toggle with Employee
     lit, and anything that looked at the screen in that moment - a person or
     a test - saw the wrong thing.

     `tick` exists only to re-render when the choice moves, here or in
     another tab. The answer itself always comes from viewFor(). */
  const [, tick] = useState(0);
  const bump = useCallback(() => tick((n) => n + 1), []);

  useEffect(() => {
    window.addEventListener('rt-view', bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener('rt-view', bump);
      window.removeEventListener('storage', bump);
    };
  }, [bump]);

  const shift = useCallback((next) => {
    if (!viewsFor(role).includes(next)) return;
    writeView(next);       // dispatches 'rt-view', which bumps every listener
    bump();
  }, [role, bump]);

  return { view: viewFor(role), views: viewsFor(role), role, shift };
}

