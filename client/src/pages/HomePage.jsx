import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { useScanSite } from '../hooks/useScanSite.js';
import { apiUrl, authFetch } from '../utils/api';
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
 *   the banner    a rack drawn in geometry, and beside it what this person is
 *                 here for. The main thing on the page is a design, not the
 *                 person's own scan - the owner's direction on 22 Sep 2026 -
 *                 and the photographs stay with the racks they belong to.
 *   one action    one filled control in ink on white: scan a rack, or read
 *                 the checks that are with you, with scanning beside it.
 *   four ways on  the screens that are otherwise two taps inside More. None
 *                 repeats the bottom bar or a section of this page.
 *   needs you     only when something does: the checks that are with you, by
 *                 incident number and rack.
 *   your racks    a short list with the photographs in it, each rack's state
 *                 told by a dot and a word.
 *
 * Every figure is one the server already answers, and one that has not
 * arrived is left out rather than shown as a zero:
 *
 *   racks and their photographs   GET /api/scans
 *   a rack's name and its Site    GET /api/scan-sites
 *   the checks and their state    GET /api/approvals/plans
 *   what this account may do      GET /api/approvals/me
 *
 * Class names avoid card / tile / panel / hero / chip / surface / badge /
 * pill: index.css auto-elevates and re-tones anything whose class contains
 * those words, which would put a lift shadow under half of this page.
 */

// How much of each list a landing screen carries. The rest is one tap away:
// Scan history for the racks, the Desk for the checks.
const RACKS_SHOWN = 3;
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
export function actionsFor({ role, waiting = 0, newest = null }) {
  const scan = { text: 'Scan a rack', to: '/scan' };
  // Somebody holding checks is told to read them, because that is what is
  // waiting on them and it is work nobody else can do; scanning moves beside
  // it. Everybody else gets scanning and nothing else. The console button
  // came off on 22 Sep 2026, and "Open this rack" with it: the racks are a
  // list further down the page, each one already a way in.
  if (role === 'spoc' && waiting > 0) {
    return {
      lead: {
        text: waiting === 1 ? 'Read the check waiting for you' : `Read ${waiting} checks waiting for you`,
        to: newest ? `/results/${encodeURIComponent(newest)}/drift` : '/history',
      },
      alt: scan,
    };
  }
  return { lead: scan, alt: null };
}

export function RackArt({ className = '' }) {
  const shelves = [
    { y: 30, ports: 8, read: false },
    { y: 60, ports: 8, read: true },
    { y: 90, ports: 0, read: false },
    { y: 120, ports: 0, read: false },
  ];
  return (
    <svg className={className} viewBox="0 0 168 200" fill="none" role="img"
      aria-label="A rack, drawn, with one shelf read through a viewfinder">
      <defs>
        <pattern id="ra-grid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" stroke="#E9ECF1" strokeWidth="1" fill="none" />
        </pattern>
        {/* The grid is texture, not a box: it is strongest behind the rack and
            gone by the edges, so the drawing sits on the page rather than in a
            frame of its own. */}
        <radialGradient id="ra-fade" cx="50%" cy="48%" r="52%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="62%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id="ra-mask">
          <rect x="0" y="0" width="168" height="200" fill="url(#ra-fade)" />
        </mask>
        {/* A wash under the read shelf alone, not behind the whole rack: a
            halo round the body read as a smudge on the screen. */}
        <radialGradient id="ra-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0F7B4F" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#0F7B4F" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ra-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#FBFBFD" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="168" height="200" fill="url(#ra-grid)" mask="url(#ra-mask)" />
      <ellipse cx="84" cy="72" rx="62" ry="26" fill="url(#ra-glow)" />

      {/* The rack: a body with rails, four shelves, and the one that has been
          read carrying lit ports and a tick. */}
      <rect x="30" y="14" width="108" height="162" rx="14"
        fill="url(#ra-body)" stroke="#C6CCD6" strokeWidth="2" />
      <line x1="41" y1="22" x2="41" y2="168" stroke="#EBEEF2" strokeWidth="1.4" />
      <line x1="127" y1="22" x2="127" y2="168" stroke="#EBEEF2" strokeWidth="1.4" />
      {shelves.map((sh) => (
        <g key={sh.y}>
          <rect x="46" y={sh.y} width="76" height="23" rx="6.5"
            fill={sh.read ? '#E8F3EC' : '#F4F5F8'}
            stroke={sh.read ? '#B9DAC9' : '#E6E9EE'} strokeWidth="1.2" />
          {Array.from({ length: sh.ports }, (_, i) => (
            <rect key={i} x={52 + i * 7.6} y={sh.y + 13.5} width="5" height="4.5" rx="1.3"
              fill={sh.read ? '#5CA47E' : '#D6DAE1'} />
          ))}
          {sh.read && (
            <path d={`M108 ${sh.y + 10.5} l2.6 2.8 5-5.8`} stroke="#0F7B4F" strokeWidth="2.1"
              strokeLinecap="round" strokeLinejoin="round" fill="none" />
          )}
        </g>
      ))}
      {/* One cable, leaving the read shelf. A rack is never only boxes. */}
      <path d="M122 72 C 142 78, 144 108, 130 130" stroke="#CDD2DB" strokeWidth="1.8"
        strokeLinecap="round" fill="none" />
      <line x1="50" y1="176" x2="50" y2="186" stroke="#C6CCD6" strokeWidth="2.8" strokeLinecap="round" />
      <line x1="118" y1="176" x2="118" y2="186" stroke="#C6CCD6" strokeWidth="2.8" strokeLinecap="round" />
      {/* What it stands on, so it is not floating. */}
      <ellipse cx="84" cy="190" rx="50" ry="4" fill="#0B0B0C" opacity="0.05" />

      {/* The viewfinder: the one motif that says photograph without printing
          one. Longer arms than corners alone, so it reads as framing. */}
      <g stroke="#0F7B4F" strokeWidth="2.3" strokeLinecap="round" fill="none">
        <path d="M8 30 V10 H28" />
        <path d="M140 10 H160 V30" />
        <path d="M160 170 V190 H140" />
        <path d="M28 190 H8 V170" />
      </g>
    </svg>
  );
}

/**
 * What the banner says, by role: a heading and a sentence, and on a brand-new
 * account the three lines saying what a first scan does. No counts - the
 * owner took the row of figures off the way in on 22 Sep 2026, and every
 * number this page used to print there is said where it can be acted on.
 */
export function bannerFor({ role, racks = 0, waiting = 0, triage = 0,
  loading = false, failed = false }) {
  // The racks could not be read. Say that, rather than "scan your first rack"
  // at somebody who has a hundred.
  if (failed) {
    return {
      title: 'Your racks could not be loaded just now',
      words: 'Pull up again in a moment.',
      steps: [],
    };
  }
  if (role === 'admin') {
    return {
      title: triage > 0
        ? (triage === 1 ? 'One check has nobody' : `${triage} checks have nobody`)
        : 'Your estate is covered',
      words: triage > 0
        ? 'A check whose Site names no single point of contact waits for an admin to choose one.'
        : 'Every check has somebody. Scan a rack and RackTrack reads it against your records.',
      steps: [],
    };
  }
  if (role === 'spoc' && waiting > 0) {
    return {
      title: waiting === 1 ? 'A check is waiting for you' : `${waiting} checks are waiting for you`,
      words: 'Read what the rack holds against your record, then approve it, change it or send it back.',
      steps: [],
    };
  }
  // Nobody has scanned yet. The three things a first scan does are kept, as
  // three lines under the words rather than a numbered list: the owner does
  // not want steps numbered anywhere in the app.
  if (racks === 0 && !loading) {
    return {
      title: 'Scan your first rack',
      words: 'One photo, and RackTrack reads the equipment mounted in the rack.',
      steps: FIRST_SCAN,
    };
  }
  return {
    title: 'Ready to scan a rack',
    words: 'One photo and RackTrack reads the rack, then checks it against your records.',
    steps: [],
  };
}

/**
 * The four ways on, as a grid rather than a menu.
 *
 * None of them repeats something this page or the bottom bar already offers:
 * scanning is the raised control on the bar and the banner's own button, the
 * racks are a list further down, and the Desk is on the bar. What is left are
 * the screens that are otherwise two taps inside More, and the last two
 * change with the role.
 */
export function waysFor(role) {
  const ways = [
    { key: 'ports', label: 'Port history', icon: 'history', to: '/port-history' },
    { key: 'switches', label: 'Switches', icon: 'dns', to: '/switch-info' },
  ];
  if (role === 'admin') {
    ways.push({ key: 'org', label: 'Organization', icon: 'apartment', to: '/organizations' });
    ways.push({ key: 'people', label: 'Your account', icon: 'person_check', to: '/profile' });
  } else {
    ways.push({ key: 'help', label: 'How it works', icon: 'book', to: '/help' });
    ways.push({ key: 'you', label: 'Your account', icon: 'person_check', to: '/profile' });
  }
  return ways;
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

  // A check opens inside the app. The Desk is where the people who decide go,
  // and it is one row at the foot of that page.
  const openCheck = useCallback((planId) => {
    navigate(`/checks/${encodeURIComponent(planId)}`);
  }, [navigate]);

  const loading = scans === null;
  const org = user?.organization?.name || null;
  const where = user?.tenant?.name || null;
  const role = useMemo(() => roleOf(user, can), [user, can]);
  const greeting = useMemo(() => greetingAt(), []);

  const ways = waysFor(role.key);

  const banner = bannerFor({
    role: role.key,
    racks: racks.length,
    waiting: needs.length,
    triage,
    loading,
    failed: scansFailed,
  });

  const { lead, alt } = actionsFor({
    role: role.key,
    waiting: needs.length,
    newest: needs[0]?.rackId || null,
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

        {/* ── The banner: the drawn rack, and what this person is here for.
               The main thing on the page is a design, not somebody's own
               photograph - the owner's direction on 22 Sep 2026. The
               photographs stay where they belong, on the racks themselves. ── */}
        <section className={styles.lead} aria-labelledby="home-lead">
          <div className={styles.banner}>
            <div className={styles.bannerText}>
              <h2 className={styles.bannerTitle} id="home-lead">{banner.title}</h2>
              <p className={styles.bannerWords}>{banner.words}</p>
              {banner.steps.length > 0 && (
                <ul className={styles.bannerSteps}>
                  {banner.steps.map((l) => <li key={l}>{l}</li>)}
                </ul>
              )}
            </div>
            <RackArt className={styles.bannerArt} />
          </div>

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

        {/* The four ways on. The figures that sat above them - Sites, racks
            read, differences waiting, checks with you - were taken off on 22
            Sep 2026: the owner did not want a row of counts on the way in,
            and every one of them is said where it can be acted on. */}
        <nav className={styles.ways} aria-label="Ways on">
          {ways.map((w) => (
            <button key={w.key} type="button" className={styles.way} onClick={() => navigate(w.to)}>
              <span className={styles.wayGlyph} aria-hidden="true"><Icon name={w.icon} /></span>
              <span className={styles.wayLabel}>{w.label}</span>
            </button>
          ))}
        </nav>

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
