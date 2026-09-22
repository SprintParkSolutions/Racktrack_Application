import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useScanSite } from '../hooks/useScanSite.js';
import { apiUrl, authFetch } from '../utils/api';
import { openApprovals } from '../utils/approvals';
import AssignedNotice from '../components/AssignedNotice.jsx';
import AssetImg from '../components/AssetImg.jsx';
import Icon from '../components/Icon';
import styles from './HomePage.module.css';

/**
 * Home - where the app opens.
 *
 * Rebuilt from nothing on 22 September 2026. What was here before was a
 * greeting, a near-black card, two big numbers, a notice and two lists: five
 * blocks of roughly equal weight, one of them a black rectangle, and every
 * person got the same one. The owner asked for a page that is white the way
 * Apple's and Google's own screens are, that is worth looking at, and that
 * changes with whoever signed in. So this is a different composition, not the
 * old one repainted:
 *
 *   the line      the hour, your name, and what you are here. Four words
 *                 before anything else, and the one warm thing on the page.
 *   the rack      your newest rack, as you photographed it, at the size a
 *                 photograph deserves. It is the page's picture and its
 *                 subject at once: what this app holds is a real rack, and
 *                 the white ground is there so it can be seen. Somebody who
 *                 has not scanned yet gets the same block, drawn, saying what
 *                 the first scan does.
 *   one action    one filled control in ink on white, one quiet one beside
 *                 it. Which is which is the role's.
 *   needs you     only when something does: the checks that are with you, by
 *                 incident number and rack.
 *   your racks    a list with the photographs in it, each rack's state told
 *                 by a dot and a word.
 *
 * Every figure is one the server already answers, and one that has not
 * arrived is left out rather than shown as a zero:
 *
 *   racks and their photographs   GET /api/scans
 *   a rack's name and its Site    GET /api/scan-sites
 *   the checks and their state    GET /api/approvals/plans
 *   differences still open        GET /api/approvals/dashboard
 *   what this account may do      GET /api/approvals/me
 *
 * Class names avoid card / tile / panel / hero / chip / surface / badge /
 * pill: index.css auto-elevates and re-tones anything whose class contains
 * those words, which would put a lift shadow under half of this page.
 */

// How much of each list a landing screen carries. The rest is one tap away:
// Scan history for the racks, the Desk for the checks.
const RACKS_SHOWN = 4;
const NEEDS_SHOWN = 3;
// Enough checks to name the newest one of every rack a person is likely to
// have, without asking for an organization's whole history.
const PLAN_WINDOW = 100;

// A rack nobody has named is known only by the hash of its photograph, which
// is not something to print. Same test as ReportPage's.
const UNNAMED = /^RK-[0-9A-F]{6,}$/i;
const NO_NAME = 'Rack not identified yet';

// What the first scan does, for the account that has not taken one.
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

/**
 * Who is looking at this page.
 *
 * The role is what the server already says it is. /api/approvals/me answers
 * with what this account may do, and `spoc` is true for whoever is the
 * contact of a Site, whatever their role, which is the point of the SPOC
 * work. Nothing is inferred from a name, and an account the approvals API
 * refuses reads as a technician, which is what such an account is.
 */
export function roleOf(user, can) {
  const role = String(user?.role || '').toLowerCase();
  if (role === 'owner') return { key: 'admin', word: 'Platform owner' };
  if (can?.admin || role === 'org_admin') return { key: 'admin', word: 'Organization admin' };
  if (can?.spoc) return { key: 'spoc', word: 'Single point of contact' };
  if (role === 'site_manager') return { key: 'manager', word: 'Site manager' };
  return { key: 'tech', word: 'Technician' };
}

/* Morning, afternoon, evening. A greeting that is true at the hour it is read
   costs nothing, and it is the one place this screen is allowed to be warm. */
export function greetingAt(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The two letters on the round mark, from whatever name the account has. */
export function initialsOf(user) {
  const name = String(user?.username || user?.email || '').trim();
  if (!name) return '?';
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

/** What this person is here, and where. One line, read once a day. */
export function placeLine(role, org, site) {
  return [role && role.word, org, site].filter(Boolean).join(' · ');
}

/**
 * The two controls under the picture, by role: one filled, one quiet.
 *
 *   admin   the checks nobody holds are the only part of the drift workflow
 *           that waits on an admin, so that leads when any do; otherwise the
 *           console
 *   spoc    the checks that are with them, straight into the newest
 *   others  the job: scan a rack
 *
 * Scanning is always one of the two, because it is what the app is for.
 */
export function actionsFor({ role, waiting = 0, triage = 0, newest = null, rack = null }) {
  const scan = { text: 'Scan a rack', to: '/scan' };
  const open = rack ? { text: 'Open this rack', to: `/results/${encodeURIComponent(rack)}` } : null;
  if (role === 'admin') {
    if (triage > 0) {
      return {
        lead: { text: triage === 1 ? 'Give a check an owner' : `Give ${triage} checks an owner`, to: '/dashboard' },
        alt: scan,
      };
    }
    return { lead: { text: 'Open the console', to: '/dashboard' }, alt: scan };
  }
  if (role === 'spoc' && waiting > 0) {
    return {
      lead: {
        text: waiting === 1 ? 'Read the check waiting for you' : `Read ${waiting} checks waiting for you`,
        to: newest ? `/results/${encodeURIComponent(newest)}/drift` : '/history',
      },
      alt: scan,
    };
  }
  return { lead: scan, alt: open };
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
  const [can, setCan] = useState(null);          // what the server says this account may do

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
    // What this account may do, in the server's own words.
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

  const racks = useMemo(() => (scans || []).map((s) => {
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
      // The photograph the rack was read from. /api/scans answers with it
      // already; a rack whose file is gone simply has none.
      image: s.image || null,
    };
  }), [scans, places, byRack]);

  // The one picture on the page: the newest rack that still has its
  // photograph. A list of names is a list of names; this is a rack.
  const shot = useMemo(() => racks.find((r) => r.image) || null, [racks]);

  // The checks that are with this person. `holder` is a username and
  // usernames are unique, so this is the same set the server's holder=me
  // filter answers, read off a list the page already has.
  const needs = useMemo(() => {
    const me = String(user?.username || '');
    if (!me) return [];
    return (plans || []).filter((p) => p && p.holder === me && OPEN_STATUS.has(p.status));
  }, [plans, user]);

  // The checks that have nobody: an admin's only part of the workflow.
  const triage = useMemo(
    () => (plans || []).filter((p) => p && p.status === 'triage').length,
    [plans],
  );

  const openCheck = useCallback((planId) => {
    openApprovals(`/approvals/drifts/${encodeURIComponent(planId)}`)
      .catch(() => { /* openApprovals falls back to the plain address by itself */ });
  }, []);

  const loading = scans === null;
  const org = user?.organization?.name || null;
  const where = user?.tenant?.name || null;
  const role = useMemo(() => roleOf(user, can), [user, can]);
  const greeting = useMemo(() => greetingAt(), []);

  const { lead, alt } = actionsFor({
    role: role.key,
    waiting: needs.length,
    triage,
    newest: needs[0]?.rackId || null,
    rack: shot?.rackId || null,
  });

  return (
    <div className={styles.home}>
      <main className={styles.main}>
        {/* ── The line: the hour, who you are, and what you are here ── */}
        <header className={styles.line}>
          <div className={styles.lineText}>
            <p className={styles.hour}>{greeting}</p>
            <h1 className={styles.who}>{user?.username || 'there'}</h1>
            <p className={styles.place}>{placeLine(role, org, where)}</p>
          </div>
          <span className={styles.mark} aria-hidden="true">{initialsOf(user)}</span>
        </header>

        {/* ── The rack: your newest one, as you photographed it ── */}
        <section className={styles.lead} aria-labelledby="home-lead">
          {shot ? (
            <button
              type="button"
              className={styles.shot}
              onClick={() => navigate(`/results/${encodeURIComponent(shot.rackId)}`)}
            >
              <AssetImg
                path={shot.image}
                alt={shot.name ? `${shot.name}, as it was photographed` : 'The rack, as it was photographed'}
                className={styles.shotImg}
              />
              <span className={styles.shotText}>
                <span className={styles.shotTop}>
                  <span className={`${styles.shotName} ${shot.name ? '' : styles.noName}`} id="home-lead">
                    {shot.name || NO_NAME}
                  </span>
                  <span className={`${styles.state} ${styles[shot.state.key]}`}>
                    <span className={styles.dot} aria-hidden="true" />
                    {shot.state.label}
                  </span>
                </span>
                <span className={styles.shotMeta}>
                  {[shot.where, shot.when && `read ${shot.when}`].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          ) : (
            <div className={styles.blank}>
              <span className={styles.blankArt} aria-hidden="true">
                <Icon name="rack" className={styles.blankGlyph} />
              </span>
              <h2 className={styles.blankTitle} id="home-lead">
                {loading ? 'Loading your racks'
                  : scansFailed ? 'Your racks could not be loaded just now'
                    : 'Scan your first rack'}
              </h2>
              {!loading && !scansFailed && (
                <ul className={styles.blankLines}>
                  {FIRST_SCAN.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
              {scansFailed && <p className={styles.blankWords}>Pull up again in a moment.</p>}
            </div>
          )}

          {/* One filled control, one quiet one. Which is which is the role's. */}
          <div className={styles.act}>
            <button type="button" className={styles.go} onClick={() => navigate(lead.to)}>
              {lead.text}
              <Icon name="arrow_forward" className={styles.goArrow} />
            </button>
            {alt && (
              <button type="button" className={styles.goAlt} onClick={() => navigate(alt.to)}>
                {alt.text}
              </button>
            )}
          </div>
        </section>

        {/* Anything an admin or a SPOC has put on this person: the app's own
            notices, the same ones the Scan screen shows. It draws nothing when
            there is nothing, so it never leaves a gap. */}
        <div className={styles.notice}>
          <AssignedNotice />
        </div>

        {/* ── What needs you. Only when something does. ── */}
        {needs.length > 0 && (
          <section className={styles.sect} aria-labelledby="home-needs">
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle} id="home-needs">Needs you</h2>
              <span className={styles.count}>{needs.length}</span>
            </div>
            <ul className={styles.rows}>
              {needs.slice(0, NEEDS_SHOWN).map((p) => {
                const named = p.rackName && !UNNAMED.test(p.rackName) ? String(p.rackName) : null;
                const place = places.get(String(p.rackId)) || {};
                return (
                  <li key={p.id} className={styles.rowItem}>
                    <button type="button" className={styles.row} onClick={() => openCheck(p.id)}>
                      <span className={styles.rowText}>
                        <span className={`${styles.inc} ${p.incidentNumber ? '' : styles.noName}`}>
                          {p.incidentNumber || 'No incident number'}
                        </span>
                        <span className={styles.rowMeta}>{place.name || named || NO_NAME}</span>
                      </span>
                      <Icon name="chevron_right" className={styles.chev} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {needs.length > NEEDS_SHOWN && (
              <p className={styles.rest}>and {needs.length - NEEDS_SHOWN} more with you</p>
            )}
          </section>
        )}

        {/* ── Your racks, with the photographs in the list ── */}
        {racks.length > 0 && (
          <section className={styles.sect} aria-labelledby="home-racks">
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle} id="home-racks">Your racks</h2>
              {openCount != null && (
                <span className={styles.open}>
                  {openCount} difference{openCount === 1 ? '' : 's'} waiting
                </span>
              )}
              <button type="button" className={styles.seeAll} onClick={() => navigate('/history')}>
                See all
              </button>
            </div>
            <ul className={styles.rows}>
              {racks.slice(0, RACKS_SHOWN).map((r) => (
                <li key={r.rackId} className={styles.rowItem}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => navigate(`/results/${encodeURIComponent(r.rackId)}`)}
                  >
                    {r.image
                      ? <AssetImg path={r.image} alt="" className={styles.thumb} />
                      : <span className={styles.thumbNone} aria-hidden="true"><Icon name="rack" /></span>}
                    <span className={styles.rowText}>
                      <span className={`${styles.rackName} ${r.name ? '' : styles.noName}`}>
                        {r.name || NO_NAME}
                      </span>
                      <span className={styles.rowMeta}>
                        {/* The Site gives way first: how long ago a rack was
                            read is short and always worth the room, a Site's
                            name is neither. */}
                        {r.where && <span className={styles.metaGives}>{r.where}</span>}
                        {r.where && r.when ? <span className={styles.sep} aria-hidden="true" /> : null}
                        {r.when && <span className={styles.metaKeeps}>{r.when}</span>}
                      </span>
                    </span>
                    <span className={`${styles.state} ${styles[r.state.key]}`}>
                      <span className={styles.dot} aria-hidden="true" />
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
