import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import styles from './DesktopShell.module.css';
import ThemeToggle from './ThemeToggle.jsx';
import { useAuth } from '../AuthContext';

// Persistent record of the last rack the user opened. Once an image has
// been scanned and the user lands on /results/<rackId>, that rackId is
// remembered here so the sidebar can keep showing the rack-context links
// (Topology, Network, Switches, etc.) even when the user navigates back
// to Home or Scan. Cleared only when the user starts a brand-new scan
// flow that hasn't produced a rackId yet.
// The rackId is held in module-level memory only — NOT in sessionStorage
// or localStorage. That way the RACK section in the sidebar only appears
// after the user actively uploads an image in the current view (which
// fires the rt:rack-id-changed event). A browser refresh wipes this
// state, so a stale rack from a previous visit doesn't leak back into
// the sidebar until the user uploads again.
let _liveRackId = null;
function readLiveRackId() { return _liveRackId; }
function writeLiveRackId(id) { _liveRackId = id || null; }

// DesktopShell — full landscape SaaS layout for ≥1024px renders.
// Portalled to <body> so it escapes #root's max-width:540px.
//
// Structure: persistent left sidebar (240px) + top breadcrumb bar +
// FULL-WIDTH main canvas. No embedded mobile frame, no centered card.
// Each page renders across the entire content area.
//
// Pages that don't yet have a dedicated landscape layout will appear
// at full viewport width; their mobile components were designed for
// narrow widths, so their internal max-width / centering still works
// — they just sit in a wider, sidebar-anchored canvas.

const HomeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>
    <path d="M9 21V12h6v9"/>
  </svg>
);
const ScanIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);
const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);
// Rack-context icons — used for the contextual section nav that appears
// in the sidebar when the user is viewing a specific rack's results.
const OverviewIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1.5"/>
    <rect x="14" y="3" width="7" height="5" rx="1.5"/>
    <rect x="14" y="12" width="7" height="9" rx="1.5"/>
    <rect x="3" y="16" width="7" height="5" rx="1.5"/>
  </svg>
);
const PortsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="10" rx="2"/>
    <line x1="6" y1="11" x2="6" y2="13"/>
    <line x1="10" y1="11" x2="10" y2="13"/>
    <line x1="14" y1="11" x2="14" y2="13"/>
    <line x1="18" y1="11" x2="18" y2="13"/>
  </svg>
);
const TopologyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="6" rx="1.5"/>
    <rect x="2" y="16" width="6" height="6" rx="1.5"/>
    <rect x="16" y="16" width="6" height="6" rx="1.5"/>
    <path d="M12 8v4M5 16v-4h14v4"/>
  </svg>
);
const NetworkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <circle cx="5" cy="5" r="2"/>
    <circle cx="19" cy="5" r="2"/>
    <circle cx="5" cy="19" r="2"/>
    <circle cx="19" cy="19" r="2"/>
    <line x1="7" y1="7" x2="10" y2="10"/>
    <line x1="17" y1="7" x2="14" y2="10"/>
    <line x1="7" y1="17" x2="10" y2="14"/>
    <line x1="17" y1="17" x2="14" y2="14"/>
  </svg>
);
const SwitchesIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="5" rx="1.5"/>
    <rect x="2" y="10" width="20" height="5" rx="1.5"/>
    <rect x="2" y="17" width="20" height="5" rx="1.5"/>
    <circle cx="18" cy="5.5" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="12.5" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="19.5" r="1.2" fill="currentColor" stroke="none"/>
  </svg>
);
const DriftIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17h3v-5h4v-4h4v8h4v-3h3"/>
    <line x1="3" y1="21" x2="21" y2="21"/>
  </svg>
);
const MarketIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7l1.5-3h15L21 7"/>
    <path d="M3 7v12a1 1 0 001 1h16a1 1 0 001-1V7"/>
    <path d="M8 7v3a4 4 0 008 0V7"/>
  </svg>
);

// Extract rackId from any /results/<id>/* or /switch-info/<id> path so we
// can build contextual rack-section links in the sidebar.
function extractRackId(pathname) {
  const m = pathname.match(/^\/(?:results|switch-info)\/([^/]+)/);
  return m ? m[1] : null;
}

const PAGE_TITLE = {
  '/':                 { title: 'Home',                sub: 'Overview' },
  '/scan':             { title: 'New scan',            sub: 'Upload, camera, or video' },
  '/profile':          { title: 'Profile',             sub: 'Account & history' },
  '/connections':      { title: 'Connections',         sub: 'Active data sources' },
  '/results':          { title: 'Scan results',        sub: 'Devices & ports' },
  '/specifications':   { title: 'Specifications',      sub: 'Vendor & model lookup' },
  '/firmware':         { title: 'Firmware',            sub: 'Version & CVE check' },
  '/switch-info':      { title: 'Switch info',         sub: 'CMDB switch list' },
  '/port-history':     { title: 'Port history',        sub: 'Change log' },
  '/marketplace':      { title: 'Marketplace',         sub: 'Buy, sell & swap surplus gear' },
  '/marketplace/new':  { title: 'New listing',         sub: 'List surplus equipment' },
};

function deriveTitle(pathname) {
  if (PAGE_TITLE[pathname]) return PAGE_TITLE[pathname];
  if (pathname.startsWith('/results') && pathname.endsWith('/topology'))
    return { title: 'Topology', sub: '3D rack & cabling' };
  if (pathname.startsWith('/results') && pathname.endsWith('/netdisco'))
    return { title: 'Network view',  sub: 'Live device + port table' };
  if (pathname.startsWith('/results') && pathname.endsWith('/ports'))
    return { title: 'Ports',         sub: 'Available ports' };
  if (pathname.startsWith('/results') && pathname.endsWith('/vr'))
    return { title: 'VR walkthrough',sub: 'Immersive rack' };
  if (pathname.startsWith('/results'))
    return { title: 'Scan results',  sub: 'Devices & ports' };
  if (pathname.startsWith('/switch-info'))
    return { title: 'Switch info',   sub: 'CMDB-driven' };
  if (pathname.startsWith('/multi-rack'))
    return { title: 'Multi-rack',    sub: 'Combined view' };
  return { title: 'RackTrack', sub: '' };
}

export default function DesktopShell({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const crumb = deriveTitle(location.pathname);
  const { user } = useAuth();
  const isAdmin = user?.role === 'org_admin' || user?.role === 'owner';

  const links = [
    { to: '/',            label: 'Home',        icon: <HomeIcon />,    end: true  },
    { to: '/scan',        label: 'Scan',        icon: <ScanIcon />,    end: false },
    // Marketplace is organization-admin only.
    ...(isAdmin ? [{ to: '/marketplace', label: 'Marketplace', icon: <MarketIcon />, end: false }] : []),
    { to: '/profile',     label: 'Profile',     icon: <ProfileIcon />, end: false },
  ];

  // Rack-context links — show OVERVIEW / PORTS / TOPOLOGY / NETWORK /
  // SWITCHES / DRIFT in the sidebar after the user has uploaded an image
  // in this browser session. We use sessionStorage so the RACK section
  // doesn't show on a fresh tab — it only appears once the user lands on
  // a /results/<rackId> URL (which happens immediately after upload).
  // The rackId then persists across in-app navigation (Home, Scan) so
  // the user can jump back to Topology/Network without re-uploading.
  const urlRackId = extractRackId(location.pathname);
  // Only two paths populate the rackId:
  //   1. The URL carries it (/results/<id> or /switch-info/<id>) — the
  //      user is actively viewing a rack.
  //   2. ResultsPage just fired rt:rack-id-changed because an upload
  //      finished. The rackId is held in module-level memory only —
  //      a full page refresh wipes it, so stale racks from prior visits
  //      don't leak into the sidebar.
  const [liveRackId, setLiveRackId] = useState(() => readLiveRackId());
  useEffect(() => {
    if (urlRackId && urlRackId !== liveRackId) {
      writeLiveRackId(urlRackId);
      setLiveRackId(urlRackId);
    }
  }, [urlRackId, liveRackId]);
  useEffect(() => {
    const onChange = (e) => {
      const id = e.detail || null;
      writeLiveRackId(id);
      setLiveRackId(id);
    };
    window.addEventListener('rt:rack-id-changed', onChange);
    return () => window.removeEventListener('rt:rack-id-changed', onChange);
  }, []);
  // Landing on the Scan page means the user is starting a NEW scan — drop the
  // remembered rack so the sidebar's rack tabs (Overview / Ports / Topology /
  // Network / Switches / Drift) stop showing the PREVIOUS scan's data. This is
  // deterministic (runs on every navigation to /scan), unlike ScanPage's
  // mount-time event which can be missed on a fast route swap.
  useEffect(() => {
    if (location.pathname === '/scan' && liveRackId) {
      writeLiveRackId(null);
      setLiveRackId(null);
    }
  }, [location.pathname, liveRackId]);
  const rackId = urlRackId || liveRackId;
  // Overview and Drift share the same pathname (/results/<id>) and differ only
  // by the #drift hash — NavLink ignores the hash, so we resolve their active
  // state manually. (Without this, Drift's end:false prefix-matched every rack
  // sub-page and showed active everywhere.)
  const onRackRoot  = location.pathname === `/results/${rackId}`;
  const isDriftView = onRackRoot && location.hash === '#drift';
  const rackLinks = rackId ? [
    { to: `/results/${rackId}`,           label: 'Overview', icon: <OverviewIcon />, end: true,  active: onRackRoot && !isDriftView },
    { to: `/results/${rackId}/ports`,     label: 'Ports',    icon: <PortsIcon />,    end: false },
    { to: `/results/${rackId}/topology`,  label: 'Topology', icon: <TopologyIcon />, end: false },
    { to: `/results/${rackId}/netdisco`,  label: 'Network',  icon: <NetworkIcon />,  end: false },
    { to: `/switch-info/${rackId}`,       label: 'Switches', icon: <SwitchesIcon />, end: false },
    // Drift has no separate route today — it's a sub-view inside ResultsPage
    // activated by the #drift hash; its active state comes from that hash.
    { to: `/results/${rackId}#drift`,     label: 'Drift',    icon: <DriftIcon />,    end: false, active: isDriftView },
  ] : [];

  return createPortal(
    <div className={styles.shell}>
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <a className={styles.brand} onClick={(e) => { e.preventDefault(); navigate('/'); }} href="/">
          <span className={styles.brandMark}>R</span>
          <span>RackTrack</span>
        </a>

        <div className={styles.navSection}>Workflow</div>
        <ul className={styles.navLinks}>
          {links.map(l => (
            <li key={l.to}>
              <NavLink end={l.end} to={l.to}
                className={({ isActive }) => `${styles.navLink} ${isActive ? styles.active : ''}`}>
                {l.icon}{l.label}
              </NavLink>
            </li>
          ))}
        </ul>

        {rackLinks.length > 0 && (
          <>
            <div className={styles.navSection}>Rack · {rackId}</div>
            <ul className={styles.navLinks}>
              {rackLinks.map(l => (
                <li key={l.to}>
                  <NavLink end={l.end} to={l.to}
                    className={({ isActive }) => `${styles.navLink} ${(l.active !== undefined ? l.active : isActive) ? styles.active : ''}`}>
                    {l.icon}{l.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className={styles.sidebarBottom}>
          <ThemeToggle />
        </div>
      </aside>

      {/* ── Main area ───────────────────────────────────────────── */}
      <section className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.crumbBlock}>
            <span className={styles.crumbTitle}>{crumb.title}</span>
            {crumb.sub && <span className={styles.crumbSub}>{crumb.sub}</span>}
          </div>
        </header>

        <div className={styles.fluid}>{children}</div>
      </section>
    </div>,
    document.body
  );
}
