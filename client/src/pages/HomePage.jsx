import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useScanSite } from '../hooks/useScanSite.js';
import { apiUrl, authFetch } from '../utils/api';
import { openApprovals } from '../utils/approvals';
import AssignedNotice from '../components/AssignedNotice.jsx';
import Icon from '../components/Icon';
import styles from './HomePage.module.css';

/**
 * Home - where the app opens.
 *
 * "/" used to be a redirect to Scan, so the app opened in the middle of a job
 * with nothing to tell a person what they had, what was waiting on them, or
 * what this thing is for. This is the landing screen: who you are, the one
 * thing the app does, your own figures, your own racks, and whatever has been
 * put on you. Scanning is one tap away, from the dark card and from the bar.
 *
 * Every figure on this page is one the server already answers. Nothing here
 * adds a route or a field, and a number the server cannot give is left out
 * rather than guessed:
 *
 *   Racks scanned         GET /api/scans           - one row per rack
 *   Differences waiting   GET /api/approvals/dashboard  - `open`, exact and scoped
 *   Incidents with you    GET /api/approvals/plans - the open checks held by you
 *                                                    that carry an incident number
 *   a rack's name, site   GET /api/scan-sites      - /api/scans knows neither
 *   a rack's state        GET /api/approvals/plans - its newest check
 *
 * Class names deliberately avoid card / tile / panel / hero / chip / surface:
 * index.css auto-elevates and re-tones anything whose class contains those
 * words, which would repaint the dark card white. Same reason ProfilePage
 * calls its containers .block and .row.
 */

// How many racks and how many waiting checks a landing screen shows. The rest
// are one tap away: Scan history for the racks, Drift Desk for the checks.
const RACKS_SHOWN = 4;
const WAITING_SHOWN = 3;
// Enough checks to name the newest one of every rack a person is likely to
// have, without asking the server for an organization's whole history.
const PLAN_WINDOW = 100;

// A rack nobody has named is known only by the hash of its photograph, which
// is not something to print. Same test as ReportPage's.
const UNNAMED = /^RK-[0-9A-F]{6,}$/i;
const NO_NAME = 'Rack not identified yet';

/** The plan statuses that mean nobody has finished with the check yet. */
const OPEN_STATUS = new Set([
  'draft', 'submitted', 'triage', 'assigned', 'accepted', 'in_progress', 'pending',
  'resolved', 'verification_pending', 'approval_pending', 'approved',
  'write_in_progress', 'write_failed', 'manual_review', 'rework', 'reopened',
]);
/** And the ones that mean it was carried through to the record. */
const DONE_STATUS = new Set(['written', 'completed']);
/** Before it is sent, a check is nobody else's yet. */
const UNSENT_STATUS = new Set(['draft']);

function time(d) {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// The same words Scan history uses, so a rack reads the same on both screens.
function relTime(d) {
  const t = time(d);
  if (!t) return '';
  const ms = Date.now() - t;
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * What a rack's newest check says about it, in the words the rest of the app
 * already uses. No check at all is its own answer and not a fault.
 */
export function stateOf(plan) {
  if (!plan) return { key: 'unchecked', label: 'Not checked' };
  if (DONE_STATUS.has(plan.status)) return { key: 'written', label: 'Written' };
  const differences = Number(plan.summary?.decidable ?? 0);
  if (differences === 0) return { key: 'matched', label: 'Matches your records' };
  if (UNSENT_STATUS.has(plan.status)) return { key: 'unmatched', label: 'Unmatched' };
  if (OPEN_STATUS.has(plan.status)) return { key: 'spoc', label: 'With the SPOC' };
  return { key: 'unmatched', label: 'Unmatched' };
}

/** The newest check of each rack, by rack id. The list arrives newest first. */
function newestByRack(plans) {
  const out = new Map();
  for (const p of plans) {
    const id = p && p.rackId;
    if (!id || out.has(id)) continue;
    out.set(id, p);
  }
  return out;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The Sites this person may scan for. It is the only thing that knows a
  // rack's name and which Site it stands in - /api/scans knows neither.
  const { sites } = useScanSite();

  const [scans, setScans] = useState(null);      // null until it has answered
  const [scansFailed, setScansFailed] = useState(false);
  const [plans, setPlans] = useState(null);
  const [openCount, setOpenCount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    authFetch(apiUrl('/api/scans'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no'))))
      .then((d) => { if (!cancelled) setScans(Array.isArray(d.scans) ? d.scans : []); })
      .catch(() => { if (!cancelled) { setScans([]); setScansFailed(true); } });
    return () => { cancelled = true; };
  }, []);

  // Drift checks. An account with no part in the approval workflow is refused
  // at the door, which is not an error: the page simply says less.
  useEffect(() => {
    let cancelled = false;
    authFetch(apiUrl(`/api/approvals/plans?limit=${PLAN_WINDOW}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setPlans(Array.isArray(d?.plans) ? d.plans : []); })
      .catch(() => { if (!cancelled) setPlans([]); });
    authFetch(apiUrl('/api/approvals/dashboard'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && Number.isFinite(Number(d?.open))) setOpenCount(Number(d.open)); })
      .catch(() => { /* the figure is left out rather than invented */ });
    return () => { cancelled = true; };
  }, []);

  // rack id -> its name and the Site it stands in.
  const places = useMemo(() => {
    const out = new Map();
    for (const s of sites || []) {
      const where = String(s.name || s.siteId || '').trim() || null;
      for (const r of s.racks || []) {
        if (!r || r.rackId == null) continue;
        const name = String(r.name || '').trim();
        out.set(String(r.rackId), { name: name && !UNNAMED.test(name) ? name : null, where });
      }
    }
    return out;
  }, [sites]);

  const byRack = useMemo(() => newestByRack(plans || []), [plans]);

  const recent = useMemo(() => (scans || [])
    .slice(0, RACKS_SHOWN)
    .map((s) => {
      const place = places.get(String(s.rackId)) || {};
      const plan = byRack.get(s.rackId) || null;
      const named = place.name
        || (plan && plan.rackName && !UNNAMED.test(plan.rackName) ? String(plan.rackName) : null);
      return {
        rackId: s.rackId,
        name: named,
        where: place.where || (plan && plan.siteName) || null,
        when: relTime(s.timestamp),
        state: stateOf(plan),
      };
    }), [scans, places, byRack]);

  // The checks that are with this person. `holder` is a username and usernames
  // are unique, so this is the same set the server's holder=me filter answers,
  // read off a list the page already has rather than asked for twice.
  const waiting = useMemo(() => {
    const me = String(user?.username || '');
    if (!me) return [];
    return (plans || [])
      .filter((p) => p && p.holder === me && OPEN_STATUS.has(p.status));
  }, [plans, user]);

  const incidents = useMemo(
    () => new Set(waiting.map((p) => p.incidentNumber).filter(Boolean)).size,
    [waiting],
  );

  const openCheck = useCallback((planId) => {
    openApprovals(`/approvals/drifts/${encodeURIComponent(planId)}`)
      .catch(() => { /* openApprovals falls back to the plain address by itself */ });
  }, []);

  const loading = scans === null;
  const nothingYet = !loading && (scans || []).length === 0;
  const org = user?.organization?.name || null;
  const where = user?.tenant?.name || null;

  const figures = [];
  if (!nothingYet) {
    figures.push({ key: 'racks', value: (scans || []).length, label: 'Racks scanned' });
    if (openCount != null) {
      figures.push({ key: 'open', value: openCount, label: 'Differences waiting' });
    }
    if (incidents > 0) {
      figures.push({ key: 'incidents', value: incidents, label: 'Incidents with you' });
    }
  }

  return (
    <div className={styles.home}>
      <main className={styles.main}>
        {/* ── 1. Who you are ── */}
        <header className={styles.greet}>
          <div className={styles.greetText}>
            <p className={styles.welcome}>Welcome back</p>
            <h1 className={styles.who}>{user?.username || 'there'}</h1>
            {(org || where) && (
              <p className={styles.place}>
                {org}
                {org && where ? <span className={styles.dot} aria-hidden="true" /> : null}
                {where}
              </p>
            )}
          </div>
        </header>

        {/* ── 2. The one thing this app is for ── */}
        <section className={styles.start} aria-labelledby="home-start">
          <h2 className={styles.startTitle} id="home-start">Ready to scan a rack</h2>
          <p className={styles.startWords}>
            One photo and RackTrack reads the rack, then checks it against your records.
          </p>
          <button type="button" className={styles.startBtn} onClick={() => navigate('/scan')}>
            Start a scan
          </button>
        </section>

        {/* Anything an admin or a SPOC has put on this person. The component
            draws nothing when there is nothing, so it never leaves a gap. */}
        <AssignedNotice />

        {nothingYet && (
          <p className={styles.blank}>
            {scansFailed
              ? 'Your racks could not be loaded just now. Pull up again in a moment.'
              : 'Your racks will appear here after the first scan.'}
          </p>
        )}

        {/* ── 3. What this person actually has ── */}
        {figures.length > 0 && (
          <ul className={styles.figures}>
            {figures.map((f) => (
              <li key={f.key} className={styles.figure}>
                <span className={styles.figureValue}>{f.value}</span>
                <span className={styles.figureLabel}>{f.label}</span>
              </li>
            ))}
          </ul>
        )}

        {/* ── 4. Your racks ── */}
        {!nothingYet && !loading && recent.length > 0 && (
          <section className={styles.sect}>
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle}>Your racks</h2>
              <button type="button" className={styles.seeAll} onClick={() => navigate('/history')}>
                See all
              </button>
            </div>
            <ul className={styles.rows}>
              {recent.map((r) => (
                <li key={r.rackId}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => navigate(`/results/${encodeURIComponent(r.rackId)}`)}
                  >
                    <span className={styles.rowText}>
                      <span className={`${styles.rackName} ${r.name ? '' : styles.rackUnnamed}`}>
                        {r.name || NO_NAME}
                      </span>
                      <span className={styles.rowMeta}>
                        {r.where}
                        {r.where && r.when ? <span className={styles.dot} aria-hidden="true" /> : null}
                        {r.when}
                      </span>
                    </span>
                    <span className={`${styles.state} ${styles[r.state.key]}`}>{r.state.label}</span>
                    <Icon name="chevron_right" className={styles.chev} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── 5. What is waiting on this person. Only when there is something. ── */}
        {waiting.length > 0 && (
          <section className={styles.sect}>
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle}>Waiting on you</h2>
            </div>
            <ul className={styles.rows}>
              {waiting.slice(0, WAITING_SHOWN).map((p) => {
                const named = p.rackName && !UNNAMED.test(p.rackName) ? String(p.rackName) : null;
                const place = places.get(String(p.rackId)) || {};
                return (
                  <li key={p.id}>
                    <button type="button" className={styles.row} onClick={() => openCheck(p.id)}>
                      <span className={styles.rowText}>
                        <span className={`${styles.inc} ${p.incidentNumber ? '' : styles.rackUnnamed}`}>
                          {p.incidentNumber || 'No incident number'}
                        </span>
                        <span className={styles.rowMeta}>
                          {place.name || named || NO_NAME}
                        </span>
                      </span>
                      <Icon name="chevron_right" className={styles.chev} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {waiting.length > WAITING_SHOWN && (
              <p className={styles.rest}>
                and {waiting.length - WAITING_SHOWN} more with you
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
