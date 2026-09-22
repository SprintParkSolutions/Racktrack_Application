import { useEffect, useState } from 'react';
import { apiUrl, authFetch } from '../utils/api';

/**
 * What this account may do in the drift workflow, in the server's own words.
 *
 * GET /api/approvals/me answers with a `can` object - spoc, admin, approve,
 * verify, audit - and `spoc` is true for whoever is the single point of
 * contact of a Site, whatever their role. That is the one fact the app cannot
 * work out for itself: a technician can be a SPOC, and an org_admin may not
 * be one.
 *
 * Asked once per session and kept, because three screens want the same answer
 * (Home, the navigation, and anything that decides whether to show the Drift
 * Desk) and none of them should each cost a request. A refusal is not an
 * error: an account with no part in the workflow simply gets `{}`, and every
 * caller treats that as "nothing extra".
 */
let cached = null;      // the promise, so callers that arrive together share one request

export function fetchApprovalsCan() {
  if (cached) return cached;
  cached = authFetch(apiUrl('/api/approvals/me'))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.can) || {})
    .catch(() => ({}));
  return cached;
}

/** Forget the answer, for a sign-out or a change of account. */
export function forgetApprovalsCan() { cached = null; }

export function useApprovalsCan() {
  const [can, setCan] = useState(null);
  useEffect(() => {
    let dropped = false;
    fetchApprovalsCan().then((c) => { if (!dropped) setCan(c); });
    return () => { dropped = true; };
  }, []);
  return can;
}
