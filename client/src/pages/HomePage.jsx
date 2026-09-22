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
 * The composition, top to bottom, is a hierarchy rather than a stack of
 * equal blocks:
 *
 *   the greeting     your name, heavier than anything else made of words
 *   the dark card    the one dark object on the page. It carries the figure
 *                    that matters - how many racks have been read - and the
 *                    one action, at full width. A brand-new account has no
 *                    figure, so the promise leads the card instead.
 *   a pair           the two drift figures, side by side because they are the
 *                    same kind of thing. One on its own goes full width as a
 *                    row rather than sitting half-empty.
 *   waiting on you   whatever is held by this person, on a light ground so it
 *                    reads as the second-strongest thing on the screen.
 *   your racks       the substance: one hairline between rows, the rack name
 *                    in the mono face, and the state told by a dot and a word.
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

// What happens on a first scan, for the account that has not taken one yet.
// Three plain sentences, no promises the app does not keep.
const FIRST_SCAN = [
  'Take one photo of the rack.',
  'RackTrack reads the equipment mounted in it.',
  'Whatever does not match your records is shown as a difference.',
];

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

/* ──────────────────────────────────────────────────────────────────────
   Who is looking at this page.

   The app has one home and four kinds of person opening it, and until 22 Sep
   2026 they all got the same screen: a dark card saying "Ready to scan a
   rack". An organization admin does not scan racks, and a single point of
   contact opening the app to see what is with them had to read past the scan
   card, two figures and a notice to find it.

   The role is what the server already says it is. /api/approvals/me answers
   with what this account may do - `spoc` is true for whoever is the contact
   of a Site, whatever their role, which is the whole point of the SPOC work -
   and the account's own role covers the rest. Nothing is inferred from a
   name, and an account the approvals API refuses simply reads as a
   technician, which is what such an account is.
   ────────────────────────────────────────────────────────────────────── */
export function roleOf(user, can) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'owner') return { key: 'admin', word: 'Platform owner' };
  if (can?.admin || role === 'org_admin') return { key: 'admin', word: 'Organization admin' };
  if (can?.spoc) return { key: 'spoc', word: 'Single point of contact' };
  if (role === 'site_manager') return { key: 'manager', word: 'Site manager' };
  return { key: 'tech', word: 'Technician' };
}

/* Morning, afternoon, evening. A greeting that is true at the hour it is read
   costs nothing and is the one place this screen is allowed to be warm. */
export function greetingAt(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The one dark card, by role. Each is the same four things - a figure, what
 * it counts, what to do about it, and the control - so the page keeps its
 * shape while saying a different true thing to each person.
 *
 *   admin      the checks nobody holds, because that is the only part of the
 *              drift workflow that waits on an admin; when none do, the
 *              estate they are responsible for
 *   spoc       the checks that are with them, and the way straight into the
 *              newest one
 *   otherwise  the job: scan a rack
 *
 * A figure that has not arrived is null and is left out; nothing here counts
 * anything the server did not answer.
 */
export function leadFor({ role, scanned, waiting = 0, triage = 0, newest = null, sites = 0 }) {
  if (role === 'admin') {
    if (triage > 0) {
      return {
        figure: triage,
        label: `Check${triage === 1 ? '' : 's'} with nobody yet`,
        title: 'Somebody has to say who these go to',
        words: 'A check whose Site names no single point of contact waits for an admin to choose one.',
        action: 'Open the console',
        to: '/dashboard',
      };
    }
    return {
      figure: scanned,
      label: 'Racks read',
      title: sites > 1 ? `Your estate, across ${sites} sites` : 'Your estate',
      words: 'Every check has somebody. The console has the racks, the sites and the people.',
      action: 'Open the console',
      to: '/dashboard',
    };
  }
  if (role === 'spoc') {
    if (waiting > 0) {
      return {
        figure: waiting,
        label: `Check${waiting === 1 ? '' : 's'} with you`,
        title: waiting === 1 ? 'A check is waiting for you' : 'Checks are waiting for you',
        words: 'Read what the rack holds against your record, then approve, change it or send it back.',
        action: 'Open the newest',
        to: newest ? `/results/${encodeURIComponent(newest)}/drift` : '/history',
      };
    }
    return {
      figure: scanned,
      label: 'Racks read',
      title: 'Nothing is with you',
      words: 'A drift check reaches you as soon as somebody sends one from a rack at your Site.',
      action: 'Start a scan',
      to: '/scan',
    };
  }
  return {
    figure: scanned,
    label: 'Racks scanned',
    title: 'Ready to scan a rack',
    words: 'One photo and RackTrack reads the rack, then checks it against your records.',
    action: 'Start a scan',
    to: '/scan',
  };
}

/* The two letters on the round mark, from whatever name the account has. */
export function initialsOf(user) {
  const name = String(user?.username || user?.email || '').trim();
  if (!name) return '?';
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
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
  const [can, setCan] = useState(null);       // what the server says this account may do

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
    // What this account may do, in the server's own words. Refused means this
    // person has no part in the approval workflow, which reads as a technician.
    authFetch(apiUrl('/api/approvals/me'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && d.can) setCan(d.can); })
      .catch(() => { /* the role falls back to the account's own */ });
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

  // The checks that have nobody: an admin's only part of the workflow.
  const triage = useMemo(
    () => (plans || []).filter((p) => p && p.status === 'triage').length,
    [plans],
  );
  const role = useMemo(() => roleOf(user, can), [user, can]);
  const greeting = useMemo(() => greetingAt(), []);

  const loading = scans === null;
  const nothingYet = !loading && (scans || []).length === 0;
  const org = user?.organization?.name || null;
  const where = user?.tenant?.name || null;

  // The figure the dark card carries. Held back until /api/scans has answered,
  // so the card never shows a 0 it is about to replace.
  const scanned = loading || nothingYet ? null : (scans || []).length;

  // What the dark card says, by role. The newest check with this person is
  // what its control opens for a SPOC.
  const lead = leadFor({
    role: role.key,
    scanned,
    waiting: waiting.length,
    triage,
    newest: waiting[0]?.rackId || null,
    sites: (sites || []).length,
  });

  // The two that belong together, because they are the same kind of thing:
  // drift work. Either can be absent - the dashboard is refused outright for
  // an account with no part in the approval workflow, and nobody has an
  // incident until a check is with them - and one on its own goes full width.
  const pair = [];
  if (scanned != null) {
    if (openCount != null) {
      pair.push({ key: 'open', value: openCount, label: 'Differences waiting' });
    }
    if (incidents > 0) {
      pair.push({ key: 'incidents', value: incidents, label: 'Incidents with you' });
    }
  }

  return (
    <div className={styles.home}>
      <main className={styles.main}>
        {/* ── 1. Who you are: the hour, your name, what you are here, and
               where. The mark on the right is the one round thing on the page
               and gives the line something to sit against. ── */}
        <header className={styles.greet}>
          <div className={styles.greetText}>
            <p className={styles.welcome}>{greeting}</p>
            <h1 className={styles.who}>{user?.username || 'there'}</h1>
            <p className={styles.place}>
              <span className={styles.roleWord}>{role.word}</span>
              {(org || where) ? <span className={styles.dot} aria-hidden="true" /> : null}
              {org}
              {org && where ? <span className={styles.dot} aria-hidden="true" /> : null}
              {where}
            </p>
          </div>
          <span className={styles.mark} aria-hidden="true">{initialsOf(user)}</span>
        </header>

        {/* ── 2. The one dark object, and the only part of the page that
               changes with who is looking: the figure that matters to this
               person, what it means, and the one thing to do about it. ── */}
        <section className={styles.start} aria-labelledby="home-start">
          {lead.figure != null && (
            <p className={styles.startFigure}>
              <span className={styles.startValue}>{lead.figure}</span>
              <span className={styles.startLabel}>{lead.label}</span>
            </p>
          )}
          <h2
            className={`${styles.startTitle} ${lead.figure == null ? styles.startLead : ''}`}
            id="home-start"
          >
            {lead.title}
          </h2>
          <p className={styles.startWords}>{lead.words}</p>
          <button type="button" className={styles.startBtn} onClick={() => navigate(lead.to)}>
            {lead.action}
            <Icon name="arrow_forward" className={styles.startArrow} />
          </button>
          {/* Whatever the card leads with, scanning stays one tap from home for
              anybody who may scan - it is what the app is for. */}
          {lead.to !== '/scan' && (
            <button type="button" className={styles.startAlt} onClick={() => navigate('/scan')}>
              Start a scan
            </button>
          )}
        </section>

        {/* ── 3. The pair of drift figures, under the card that leads them. ── */}
        {pair.length > 0 && (
          <ul className={`${styles.figures} ${pair.length === 1 ? styles.figuresOne : ''}`}>
            {pair.map((f) => (
              <li key={f.key} className={styles.figure}>
                <span className={styles.figureValue}>{f.value}</span>
                <span className={styles.figureLabel}>{f.label}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Anything an admin or a SPOC has put on this person - the app's
            existing notices card, the same one the Scan screen shows. It draws
            nothing when there is nothing, so it never leaves a gap. The wrapper
            cancels the card's own margins, which were written for a page with
            no gutter; without it the notice sits 16px narrower than everything
            else in this column. */}
        <div className={styles.notice}>
          <AssignedNotice />
        </div>

        {/* ── 4. Nothing scanned yet. Still a screen somebody can read: what
               is missing, and what the first scan does. ── */}
        {nothingYet && (
          <div className={styles.blank}>
            <span className={styles.slot} aria-hidden="true">
              <Icon name="rack" className={styles.slotGlyph} />
            </span>
            <p className={styles.blankLead}>
              {scansFailed ? 'Your racks could not be loaded just now' : 'No racks yet'}
            </p>
            <p className={styles.blankWords}>
              {scansFailed
                ? 'Pull up again in a moment.'
                : 'Your racks will appear here after the first scan.'}
            </p>
            {!scansFailed && (
              <ol className={styles.steps}>
                {FIRST_SCAN.map((line, i) => (
                  <li key={line} className={styles.step}>
                    <span className={styles.stepNo} aria-hidden="true">{i + 1}</span>
                    {line}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* ── 5. What is waiting on this person. Only when there is something,
               and on a ground of its own when there is. ── */}
        {waiting.length > 0 && (
          <section className={`${styles.sect} ${styles.waiting}`} aria-labelledby="home-waiting">
            <div className={styles.sectTop}>
              <h2 className={`${styles.sectTitle} ${styles.sectTitleLoud}`} id="home-waiting">
                Waiting on you
              </h2>
              <span className={styles.count}>{waiting.length}</span>
            </div>
            <ul className={styles.rows}>
              {waiting.slice(0, WAITING_SHOWN).map((p) => {
                const named = p.rackName && !UNNAMED.test(p.rackName) ? String(p.rackName) : null;
                const place = places.get(String(p.rackId)) || {};
                return (
                  <li key={p.id} className={styles.rowItem}>
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

        {/* ── 6. Your racks. The substance of the page: a list, not a stack of
               cards. ── */}
        {!nothingYet && !loading && recent.length > 0 && (
          <section className={styles.sect} aria-labelledby="home-racks">
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle} id="home-racks">Your racks</h2>
              <button type="button" className={styles.seeAll} onClick={() => navigate('/history')}>
                See all
              </button>
            </div>
            <ul className={styles.rows}>
              {recent.map((r) => (
                <li key={r.rackId} className={styles.rowItem}>
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
                        {/* The Site gives way first: how long ago a rack was
                            read is short and always worth the room, a Site's
                            name is neither. */}
                        {r.where && <span className={styles.metaGives}>{r.where}</span>}
                        {r.where && r.when ? <span className={styles.dot} aria-hidden="true" /> : null}
                        {r.when && <span className={styles.metaKeeps}>{r.when}</span>}
                      </span>
                    </span>
                    <span className={`${styles.state} ${styles[r.state.key]}`}>
                      <span className={styles.stateDot} aria-hidden="true" />
                      {r.state.label}
                    </span>
                    <Icon name="chevron_right" className={styles.chev} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
