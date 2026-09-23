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

/* How long the navigation may wait for this answer.
 *
 * Until it arrives the app does not know whether a technician is a SPOC, so
 * it shows only what belongs to no role: Home, Ask DOT, Contact support,
 * Profile. That is the right thing for a moment and the wrong thing forever -
 * an admin on a phone with no signal saw exactly those four and nothing else,
 * and there was no way back from it, because a request that never settles
 * never resolves the promise everything is waiting on (the owner,
 * 23 September 2026).
 *
 * So it gives up and answers "nothing extra". A refusal and a timeout are the
 * same answer here: the account's own role still decides everything an admin
 * sees, and a technician who is a SPOC gets their Desk on the next load. */
const PATIENCE = 6000;

export function fetchApprovalsCan() {
  if (cached) return cached;
  const asked = authFetch(apiUrl('/api/approvals/me'))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.can) || {})
    .catch(() => ({}));
  let timer = null;
  const waited = new Promise((resolve) => { timer = setTimeout(() => resolve({}), PATIENCE); });
  cached = Promise.race([asked, waited]).finally(() => clearTimeout(timer));
  /* And when the real answer does arrive after the wait ran out, take it:
     the next thing to ask gets the truth rather than the stand-in. */
  asked.then((real) => { if (real && Object.keys(real).length) cached = Promise.resolve(real); });
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
