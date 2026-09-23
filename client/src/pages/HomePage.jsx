import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppView } from '../hooks/useAppView.js';
import { VIEW_LABEL } from '../utils/appView.js';
import { useAuth } from '../AuthContext.jsx';
import { useScanSite } from '../hooks/useScanSite.js';
import { apiUrl, authFetch } from '../utils/api';
import { openApprovals } from '../utils/approvals';
import AssignedNotice from '../components/AssignedNotice.jsx';
import AssetImg from '../components/AssetImg.jsx';
import EstateMap from '../components/EstateMap.jsx';
import NoticesSheet, { useNotices } from '../components/NoticesSheet.jsx';
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
const NO_NAME = 'Unidentified rack';

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

/**
 * What this person is here, and where: two facts, one line.
 *
 * It carried the organisation's name as well, which on a real account reads
 * "Single point of contact · NXD-21 - Nexa Data · Hyderabad Central Data
 * Center" and wraps onto two lines under the name - cramped, and saying the
 * same place twice. The Site is the one that matters: it is what a check is
 * routed by and what every rack on this page belongs to. Whoever needs the
 * organisation's name finds it under their account.
 */
export function placeLine(role, org, site) {
  return [role && role.word, site || org].filter(Boolean).join(' · ');
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
export function actionsFor({ role, waiting = 0 }) {
  const scan = { text: 'Scan a rack', to: '/scan' };
  // A single point of contact does not scan racks. Somebody else photographs
  // one, the check reaches them, and their work is to read what has arrived -
  // so their control is their own list, and scanning is not offered at all
  // (the owner's direction, 22 Sep 2026). Everybody else is told to scan,
  // which is what this app is for.
  if (role === 'spoc') {
    return {
      lead: {
        text: waiting === 0 ? 'Open your checks'
          : waiting === 1 ? 'Read the check waiting for you'
            : `Read ${waiting} checks waiting for you`,
        to: '/my-checks',
      },
      alt: null,
    };
  }
  // An admin is not asked to photograph a rack either - they run the estate.
  // If they want the camera they shift the toggle to Employee, and then this
  // is called with 'tech' (utils/appView.js).
  if (role === 'admin' || role === 'manager') {
    return { lead: { text: 'Open your organization', to: '/organizations' }, alt: null };
  }
  return { lead: scan, alt: null };
}

export function RackArt({ className = '' }) {
  /* One rack, photographed rather than diagrammed.
   *
   * A row of three was tried on 22 September 2026 and the two pale cabinets
   * read as cardboard; the owner asked for one black rack and the words
   * beside it. So: a single graphite cabinet, its ports alight behind a glass
   * door, standing on a floor that takes its shadow, holds a pool of its own
   * green light, and gives a little of the cabinet back.
   *
   * One projection throughout. F(u, v) is a point on the front face - u
   * across it, v down it - and S(t, v) one on the side, t back. Every edge,
   * shelf and light is placed through them, so this is a solid rather than a
   * set of shapes that nearly line up.
   */
  const X0 = 26;    // the front-left upright
  const Y0 = 44;
  const FW = 112;   // across the front
  const FS = 33;    // and how far it drops going right
  const H = 150;    // how tall
  const SW = 48;    // the side, going back
  const SS = 29;    // and how far that rises

  const F = (u, v) => [X0 + u * FW, Y0 + u * FS + v];
  const S = (t, v) => [X0 + FW + t * SW, Y0 + FS - t * SS + v];
  const pts = (...list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const FACE = pts(F(0, 0), F(1, 0), F(1, H), F(0, H));
  const SIDE = pts(F(1, 0), S(1, 0), S(1, H), F(1, H));
  const BASE = Y0 + H + FS;   // where the cabinet meets the floor

  /* Six shelves. The top three are read and alight, the rest wait, which is
     what a rack looks like part way through a check. */
  const SHELVES = [
    { v: 12, ports: 8, lit: true },
    { v: 34, ports: 8, lit: true },
    { v: 56, ports: 8, lit: true },
    { v: 78, ports: 8, lit: false },
    { v: 100, ports: 0 },
    { v: 124, ports: 0 },
  ];
  const SH = 16;

  return (
    <svg className={className} viewBox="0 0 210 256" fill="none" role="img"
      aria-label="A rack, drawn: its equipment alight behind a glass door">
      <defs>
        <linearGradient id="rk-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#343C46" />
          <stop offset="52%" stopColor="#242B33" />
          <stop offset="100%" stopColor="#14191F" />
        </linearGradient>
        <linearGradient id="rk-side" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#151A21" />
          <stop offset="100%" stopColor="#0C1015" />
        </linearGradient>
        <linearGradient id="rk-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4A535E" />
          <stop offset="100%" stopColor="#2A313A" />
        </linearGradient>
        {/* the sheen on the glass door */}
        <linearGradient id="rk-glass" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity=".24" />
          <stop offset="34%" stopColor="#FFFFFF" stopOpacity=".05" />
          <stop offset="56%" stopColor="#FFFFFF" stopOpacity=".12" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="rk-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2B5CE0" stopOpacity=".12" />
          <stop offset="70%" stopColor="#2B5CE0" stopOpacity=".025" />
          <stop offset="100%" stopColor="#2B5CE0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="rk-pool" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2B5CE0" stopOpacity=".26" />
          <stop offset="55%" stopColor="#2B5CE0" stopOpacity=".07" />
          <stop offset="100%" stopColor="#2B5CE0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="rk-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0B1524" stopOpacity=".34" />
          <stop offset="62%" stopColor="#0B1524" stopOpacity=".08" />
          <stop offset="100%" stopColor="#0B1524" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="rk-sweep" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5AA9FF" stopOpacity="0" />
          <stop offset="45%" stopColor="#5AA9FF" stopOpacity=".38" />
          <stop offset="100%" stopColor="#5AA9FF" stopOpacity="0" />
        </linearGradient>
        <clipPath id="rk-face"><polygon points={FACE} /></clipPath>
      </defs>

      {/* the light it stands in */}
      <ellipse cx="108" cy="120" rx="104" ry="112" fill="url(#rk-halo)" />

      {/* what it puts on the floor */}
      <ellipse cx={X0 + FW * 0.66} cy={BASE + 14} rx="98" ry="18" fill="url(#rk-shadow)" />
      <ellipse cx={X0 + FW * 0.55} cy={BASE + 14} rx="62" ry="11" fill="url(#rk-pool)" />

      {/* the cabinet: side, top, front */}
      <polygon points={SIDE} fill="url(#rk-side)" stroke="#0C1015" strokeWidth="1" strokeLinejoin="round" />
      <polygon points={pts(F(0, 0), F(1, 0), S(1, 0), [X0 + SW, Y0 - SS])}
        fill="url(#rk-top)" stroke="#0C1015" strokeWidth="1" strokeLinejoin="round" />
      <polygon points={FACE} fill="url(#rk-front)" stroke="#10151B" strokeWidth="1.2" strokeLinejoin="round" />

      {/* the uprights the equipment is bolted to */}
      <line x1={F(0.05, 5)[0]} y1={F(0.05, 5)[1]} x2={F(0.05, H - 5)[0]} y2={F(0.05, H - 5)[1]}
        stroke="#4A545F" strokeWidth="1.7" />
      <line x1={F(0.95, 5)[0]} y1={F(0.95, 5)[1]} x2={F(0.95, H - 5)[0]} y2={F(0.95, H - 5)[1]}
        stroke="#4A545F" strokeWidth="1.7" />

      {/* the equipment, and its lights */}
      {SHELVES.map((sh) => (
        <g key={sh.v}>
          <polygon
            points={pts(F(0.085, sh.v), F(0.915, sh.v), F(0.915, sh.v + SH), F(0.085, sh.v + SH))}
            fill={sh.ports ? '#3A434D' : '#262D35'}
            stroke="#4C5661" strokeWidth=".9" strokeLinejoin="round"
          />
          {Array.from({ length: sh.ports }, (_, i) => {
            const [px, py] = F(0.155 + i * 0.084, sh.v + SH * 0.56);
            const on = sh.lit && i % 3 !== 2;
            return (
              <rect key={i} x={px - 2.7} y={py - 2.1} width="5.4" height="4.2" rx="1.1"
                fill={on ? '#6BB4FF' : '#59636E'} />
            );
          })}
          {sh.lit && (
            <circle cx={F(0.875, sh.v + SH * 0.5)[0]} cy={F(0.875, sh.v + SH * 0.5)[1]} r="2.3" fill="#6BB4FF" />
          )}
        </g>
      ))}

      {/* the glass door, and the reading passing down behind it */}
      <polygon points={FACE} fill="url(#rk-glass)" />
      <g clipPath="url(#rk-face)">
        <polygon className="ra-sweep" points={pts(F(0, -20), F(1, -20), F(1, 4), F(0, 4))}
          fill="url(#rk-sweep)" />
      </g>

      {/* feet */}
      <line x1={F(0.05, H + 4)[0]} y1={F(0.05, H + 4)[1]} x2={F(0.95, H + 4)[0]} y2={F(0.95, H + 4)[1]}
        stroke="#10151B" strokeWidth="2.6" strokeLinecap="round" opacity=".85" />
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
  /* Four, in one order: what this person's own work is, the assistant, the
     racks or the estate, their account. The owner set the order on 22 Sep
     2026 - second the assistant, fourth the account.

     What fills the first and third places is the job, not the person's rank.
     An employee's third is their scan history; an admin's is the estate's own
     records, because an admin never took a photograph and a history of their
     scans is an empty page (the owner, 23 Sep 2026). An admin or SPOC who
     shifts the toggle to Employee is called with 'tech' here and gets the
     employee's four.

     None of them repeats the bottom bar. */
  if (role === 'spoc') {
    /* The estate is not one of them. "Your sites" opened the organization's
       own screens, and a single point of contact does not run the estate:
       they decide the checks for their site. A tile that leaves their work is
       worse than a gap.
       What fills that place instead is the tickets raised to them: a SPOC can
       also be asked to go and look at a rack, which the owner settled on
       23 September 2026. It is the one piece of the employee's app they keep,
       and nav/navLinks.jsx says the same thing - the test in
       roleConsistency.test.js fails if the two ever disagree. */
    return [
      // Not the clock: scan history is a clock with an arrow round it, and two
      // tiles in the same row read as the same thing. A check arrives for this
      // person and waits to be read, so it is the envelope.
      { key: 'mine', label: 'Your checks', icon: 'mail', to: '/my-checks' },
      { key: 'dot', label: 'Ask DOT', icon: 'chat', to: '/help' },
      { key: 'tasks', label: 'Tickets for you', icon: 'book', to: '/tasks' },
      { key: 'you', label: 'Your account', icon: 'person_check', to: '/profile' },
    ];
  }
  if (role === 'admin' || role === 'manager') {
    return [
      { key: 'org', label: 'Organization', icon: 'apartment', to: '/organizations' },
      { key: 'dot', label: 'Ask DOT', icon: 'chat', to: '/help' },
      { key: 'sources', label: 'Data sources', icon: 'dns', to: '/connections' },
      { key: 'you', label: 'Your account', icon: 'person_check', to: '/profile' },
    ];
  }
  return [
    /* A technician's own work: what has been asked of them. Switches is one
       tap further on, in the menu - somebody waiting on you comes first
       (23 September 2026). */
    { key: 'tasks', label: 'Tickets for you', icon: 'mail', to: '/tasks' },
    { key: 'dot', label: 'Ask DOT', icon: 'chat', to: '/help' },
    { key: 'racks', label: 'Scan history', icon: 'history', to: '/history' },
    { key: 'you', label: 'Your account', icon: 'person_check', to: '/profile' },
  ];
}


export default function HomePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The Sites this person may scan for. It is the only thing that knows a
  // rack's name, the room it stands in and which Site it belongs to -
  // /api/scans knows none of the three, and the floor is drawn from it.
  const { sites } = useScanSite();

  const [scans, setScans] = useState(null);      // null until it has answered
  const [scansFailed, setScansFailed] = useState(false);
  const [plans, setPlans] = useState(null);
  const [can, setCan] = useState(null);          // what the server says this account may do
  // Which Site's floor is drawn. Empty means the first one the server named.
  const [floorSite, setFloorSite] = useState('');
  /* What has arrived for this person, and whether they are looking at it.
     The owner asked on 23 September 2026 for a bell beside the account mark
     and for the notices to be there rather than on a screen of their own. */
  const notices = useNotices();
  const [noticesOpen, setNoticesOpen] = useState(false);

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
    /* The estate's own name first, then the check's, then the scan's - which
       the server now resolves from whoever confirmed the rack, so a rack a
       person identified is called by its name here too (23 September 2026). */
    const named = place.name
      || (plan && plan.rackName && !UNNAMED.test(plan.rackName) ? String(plan.rackName) : null)
      || (s.rackName && !UNNAMED.test(s.rackName) ? String(s.rackName) : null);
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

  /* ── The floor ──────────────────────────────────────────────────────
     Which Site is drawn, and the cabinets standing on it. A Site's own setup
     is the truth about what is in it - the racks bolted in, the rooms they
     stand in - so the floor is built from that, and each cabinet takes the
     state of its own newest check. An organisation with no setup yet falls
     back to what has actually been photographed, so somebody who has scanned
     still sees their own floor. */
  const site = useMemo(() => {
    const list = sites || [];
    if (!list.length) return null;
    const chosen = list.find((s) => String(s.id) === String(floorSite));
    if (chosen) return chosen;
    /* Nothing chosen yet: the Site this person belongs to, not whichever one
       the server named first. An admin of two Sites opened on the other one,
       while the line under their name said they were at this one. */
    const own = user?.tenant?.id;
    return list.find((s) => own != null && String(s.id) === String(own)) || list[0];
  }, [sites, floorSite, user]);

  const floor = useMemo(() => {
    const rooms = new Map((site?.spaces || []).map((sp) => [String(sp.id), sp.name]));
    // A cabinet opens its own page only if that rack has actually been read.
    // A rack bolted in during setup and never photographed has no page yet.
    const seen = new Set((scans || []).map((s) => String(s.rackId)));
    const taken = new Set();
    const out = [];

    // What the Site's own setup says stands in it.
    (site?.racks || []).forEach((r, i) => {
      const plan = r.rackId ? byRack.get(r.rackId) : null;
      const st = stateOf(plan);
      const name = String(r.name || '').trim();
      if (r.rackId) taken.add(String(r.rackId));
      out.push({
        key: `s${r.id ?? i}`,
        rackId: r.rackId || null,
        name: name && !UNNAMED.test(name) ? name : null,
        room: rooms.get(String(r.spaceId)) || null,
        state: st.key,
        word: st.label,
        open: seen.has(String(r.rackId)),
      });
    });

    /* And the racks photographed into this Site that its setup does not list.
       On the demo estate a Site had one rack registered and a dozen
       photographed, and a floor drawn from the setup alone showed one
       cabinet where the person had read twelve. */
    if (site) {
      for (const r of racks) {
        if (!r.rackId || taken.has(String(r.rackId))) continue;
        if (!r.where || !site.name || r.where !== site.name) continue;
        taken.add(String(r.rackId));
        out.push({
          key: `r${r.rackId}`,
          rackId: r.rackId,
          name: r.name,
          room: null,
          state: r.state.key,
          word: r.state.label,
          open: true,
        });
      }
      return out;
    }

    // No estate set up at all: what this person has photographed is the floor.
    return racks.map((r, i) => ({
      key: `r${r.rackId || i}`,
      rackId: r.rackId,
      name: r.name,
      room: r.where,
      state: r.state.key,
      word: r.state.label,
      open: true,
    }));
  }, [site, byRack, racks, scans]);

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

  // Where a check opens depends on who is looking. Somebody who decides works
  // in the Desk and is sent there; the technician who sent it gets the
  // check's own page in the app, because the Desk has nothing for them.
  const openCheck = useCallback((planId) => {
    if (can && (can.admin || can.spoc)) {
      openApprovals(`/approvals/drifts/${encodeURIComponent(planId)}`)
        .catch(() => { /* openApprovals falls back to the plain address itself */ });
      return;
    }
    navigate(`/checks/${encodeURIComponent(planId)}`);
  }, [navigate, can]);

  const loading = scans === null;
  const org = user?.organization?.name || null;
  const where = user?.tenant?.name || null;
  const held = useMemo(() => roleOf(user, can), [user, can]);
  const { view, views, shift } = useAppView(held.key, user && user.id);
  /* What this person is here TODAY. An admin or a SPOC who has shifted the
     toggle to Employee gets the employee's page - the camera, their racks,
     their own checks - because that is what they said they are doing. The
     role they hold has not changed; only the view has. */
  const role = useMemo(
    () => (view === 'employee' && held.key !== 'tech'
      ? { key: 'tech', word: 'Employee' }
      : held),
    [view, held],
  );
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

  const { lead, alt } = actionsFor({ role: role.key, waiting: needs.length });

  // Everything that is waiting: the checks this person holds first, and for
  // an admin the ones that have nobody at all, which is their own part.
  const waitingOn = useMemo(() => {
    const mine = needs.map((p) => ({ plan: p, why: 'With you' }));
    if (role.key !== 'admin' && role.key !== 'manager') return mine;
    const me = String(user?.username || '');
    const nobody = (plans || [])
      .filter((p) => p && p.status === 'triage' && p.holder !== me)
      .map((p) => ({ plan: p, why: 'Nobody yet' }));
    return [...mine, ...nobody];
  }, [needs, plans, role, user]);

  return (
    <div className={styles.home}>
      <main className={styles.main}>
        {/* ── The line: the hour, who you are, and what you are here ── */}
        <header className={styles.line}>
          <div className={styles.lineText}>
            {/* Which pair of eyes the app is in. Only drawn when there is
               something to shift to: an employee holds one job and a row of
               one is a label pretending to be a choice. */}
            {views.length > 1 && (
              <div className={styles.views} role="tablist" aria-label="How you are working today">
                {views.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={view === v}
                    className={`${styles.viewTab} ${view === v ? styles.viewOn : ''}`}
                    onClick={() => shift(v)}
                  >
                    {VIEW_LABEL[v]}
                  </button>
                ))}
              </div>
            )}
            <p className={styles.hour}>{greeting}</p>
            <h1 className={styles.who}>{user?.username || 'there'}</h1>
            <p className={styles.place}>{placeLine(role, org, where)}</p>
          </div>
          {/* The bell, then the account. Both in the corner a phone keeps
              for them, and the bell carries how many are waiting. */}
          <button
            type="button"
            className={styles.profile}
            onClick={() => setNoticesOpen(true)}
            aria-label={notices.unread
              ? `Notifications, ${notices.unread} unread`
              : 'Notifications'}
          >
            <Icon name="bell" />
            {notices.unread > 0 && (
              <span className={styles.waiting} aria-hidden="true">
                {notices.unread > 9 ? '9' : notices.unread}
              </span>
            )}
          </button>
          <button
            type="button"
            className={styles.profile}
            onClick={() => navigate('/profile')}
            aria-label="Your profile"
          >
            <Icon name="person" />
          </button>
        </header>

        {/* ── The lead: what this person is here for, the drawn rack, and
               the one thing to press. The three figures that stood here for a
               day came off again on 23 September 2026 - the owner does not
               want counts on the way in, and every one of them is said where
               it can be acted on. ── */}
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

        {/* The four ways on. No heading and no container round them: four
            marks with their words are already objects, and the owner asked on
            23 Sep 2026 for four and nothing framing them. */}
        <nav
          className={styles.ways}
          style={{ '--ways': ways.length }}
          aria-label="Ways on"
        >
          {ways.map((w) => (
            <button key={w.key} type="button" className={styles.way} onClick={() => navigate(w.to)}>
              <span className={styles.wayGlyph} aria-hidden="true"><Icon name={w.icon} /></span>
              <span className={styles.wayLabel}>{w.label}</span>
            </button>
          ))}
        </nav>

        {/* ── The floor. Every cabinet is a rack the server knows, in the
               colour of its own newest check, and it opens its own page. ── */}
        {floor.length > 0 && (
          <section className={`${styles.sect} ${styles.floorSect}`} aria-labelledby="home-floor">
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle} id="home-floor">Your datacenter</h2>
              {/* The Site's name, unless the picker under it is already
                  saying which one is drawn. */}
              {site && (sites || []).length <= 1 && <span className={styles.open}>{site.name}</span>}
            </div>
            {/* More than one Site, and the floor is one of them at a time. */}
            {(sites || []).length > 1 && (
              <div className={styles.sitePick} role="tablist" aria-label="Which site to draw">
                {sites.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={site && String(s.id) === String(site.id)}
                    className={`${styles.siteOne} ${site && String(s.id) === String(site.id) ? styles.siteOn : ''}`}
                    onClick={() => setFloorSite(String(s.id))}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            <EstateMap
              racks={floor}
              where={site ? site.name : where}
              onRack={(rackId) => navigate(`/results/${encodeURIComponent(rackId)}`)}
            />
          </section>
        )}

        {/* Anything an admin or a SPOC has put on this person: the app's own
            notices, the same ones the Scan screen shows. It draws nothing when
            there is nothing, so it never leaves a gap. */}
        <div className={styles.notice}>
          <AssignedNotice />
        </div>

        {/* ── Waiting for you. A standing section: when nothing is waiting it
               says so, because a section that vanishes leaves a person
               wondering whether they missed it. ── */}
        <section className={styles.sect} aria-labelledby="home-waiting">
          <div className={styles.sectTop}>
            <h2 className={styles.sectTitle} id="home-waiting">Waiting for you</h2>
            {waitingOn.length > 0 && <span className={styles.count}>{waitingOn.length}</span>}
          </div>
          {waitingOn.length === 0 ? (
            <p className={styles.nothing}>
              {loading ? 'Reading what is waiting.' : 'Nothing is waiting for you right now.'}
            </p>
          ) : (
            <ul className={styles.rows}>
              {waitingOn.slice(0, NEEDS_SHOWN).map(({ plan: p, why }) => {
                const named = p.rackName && !UNNAMED.test(p.rackName) ? String(p.rackName) : null;
                const place = places.get(String(p.rackId)) || {};
                const st = stateOf(p);
                return (
                  <li key={p.id} className={styles.rowItem}>
                    <button type="button" className={styles.row} onClick={() => openCheck(p.id)}>
                      <span className={`${styles.pip} ${styles[st.key]}`} aria-hidden="true" />
                      <span className={styles.rowText}>
                        <span className={`${styles.inc} ${p.incidentNumber ? '' : styles.noName}`}>
                          {p.incidentNumber || 'No incident number'}
                        </span>
                        <span className={styles.rowMeta}>
                          <span className={styles.metaGives}>{place.name || named || NO_NAME}</span>
                          <span className={styles.sep} aria-hidden="true" />
                          <span className={styles.metaKeeps}>{why}</span>
                        </span>
                      </span>
                      <Icon name="chevron_right" className={styles.chev} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {waitingOn.length > NEEDS_SHOWN && (
            <p className={styles.rest}>and {waitingOn.length - NEEDS_SHOWN} more waiting</p>
          )}
        </section>

        {/* ── Your racks, as the photographs themselves. A row you push
               through rather than three rows and a See all, because the
               picture is what tells a person which rack it was. ── */}
        {racks.length > 0 && (
          <section className={styles.sect} aria-labelledby="home-racks">
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle} id="home-racks">Your racks</h2>
              <button type="button" className={styles.seeAll} onClick={() => navigate('/history')}>
                See all
              </button>
            </div>
            <ul className={styles.reel}>
              {racks.slice(0, RACKS_SHOWN).map((r) => (
                <li key={r.rackId} className={styles.reelItem}>
                  <button
                    type="button"
                    className={styles.shot}
                    onClick={() => navigate(`/results/${encodeURIComponent(r.rackId)}`)}
                  >
                    <span className={styles.shotArt}>
                      {r.image
                        ? <AssetImg path={r.image} alt="" className={styles.thumb} />
                        : <span className={styles.thumbNone} aria-hidden="true"><Icon name="rack" /></span>}
                      <span className={`${styles.state} ${styles[r.state.key]} ${styles.onArt}`}>
                        <span className={styles.dot} aria-hidden="true" />
                        {r.state.label}
                      </span>
                    </span>
                    <span className={`${styles.rackName} ${r.name ? '' : styles.noName}`}>
                      {r.name || NO_NAME}
                    </span>
                    <span className={styles.rowMeta}>
                      {r.where && <span className={styles.metaGives}>{r.where}</span>}
                      {r.where && r.when ? <span className={styles.sep} aria-hidden="true" /> : null}
                      {r.when && <span className={styles.metaKeeps}>{r.when}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

      </main>

      {/* What has arrived, over the page rather than on one of its own. */}
      {noticesOpen && (
        <NoticesSheet
          notices={notices}
          onClose={() => setNoticesOpen(false)}
          onOpenCheck={openCheck}
        />
      )}
    </div>
  );
}
