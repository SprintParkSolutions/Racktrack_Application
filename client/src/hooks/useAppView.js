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
  const [view, setLocal] = useState(() => viewFor(role));

  // The role arrives after the server answers, so the allowed set can change
  // under a view that was chosen before it did.
  useEffect(() => { setLocal(viewFor(role)); }, [role]);

  useEffect(() => {
    const onMove = () => setLocal(viewFor(role));
    window.addEventListener('rt-view', onMove);
    window.addEventListener('storage', onMove);
    return () => {
      window.removeEventListener('rt-view', onMove);
      window.removeEventListener('storage', onMove);
    };
  }, [role]);

  const shift = useCallback((next) => {
    if (!viewsFor(role).includes(next)) return;
    writeView(next);
    setLocal(next);
  }, [role]);

  return { view, views: viewsFor(role), role, shift };
}
