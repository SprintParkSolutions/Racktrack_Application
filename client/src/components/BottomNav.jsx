import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import styles from './BottomNav.module.css';
import { useShutter } from '../ShutterContext.jsx';
import { useAuth } from '../AuthContext.jsx';
import { usePrimaryNav, MoreIcon, ScanIcon } from '../nav/navLinks.jsx';
import MoreSheet from './MoreSheet.jsx';
import ScanTabBar from './ScanTabBar.jsx';
import { useRackFlow } from '../hooks/useRackFlow.js';
import { setRackFlow, NETWORK, PORT } from '../utils/rackFlow.js';
import ExternalLink from './ExternalLink.jsx';

/* ──────────────────────────────────────────────────────────────────────
   BottomNav - the phone navigation: a floating pill with four items around a
   raised centre action.

   The permanent slots come from the shared destination list in
   nav/navLinks.jsx, and MENU opens a sheet with everything else that list
   contains. This used to be three hardcoded constants while the sidebar
   built eight role-gated links, which is how Lab and Marketplace ended up
   with no tappable route on a phone at all.

   The centre action is the camera, because taking a scan is what the app is
   for. It is the same action the Scan slot has always fired - including the
   shutter hijack while the viewfinder is live - given the prominence it
   deserves; the slot stays, because it is also how you get to that screen
   when you are not ready to shoot yet.

   The items are laid out around the centre by splitting the list down the
   middle, so this keeps working whatever that list ends up holding.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Inside a rack, the bar is the rack's own tabs.
 *
 * The results page renders that bar itself; its sub-pages - Network, Report,
 * Topology and the rest - are separate routes, and they used to fall through
 * to the app's navigation instead. Tapping Network therefore swapped the whole
 * bottom bar underneath you, which is exactly the kind of thing that makes an
 * app feel like several apps. Same bar on every page of a rack.
 *
 * Which tabs that is depends on the job the person chose on the rack's
 * Overview - analyse the network, or look up a port. The choice is READ here,
 * from the rack's own memory of it (utils/rackFlow.js), rather than guessed
 * from the page: guessing is what made the bar change shape between the port
 * result and every screen it led to.
 */
function RackTabs({ rackId, pathname, hash }) {
  const navigate = useNavigate();
  const flow = useRackFlow(rackId);
  const base = `/results/${encodeURIComponent(rackId)}`;
  // Which screen this is. The rack's root is the port lookup while the rack is
  // in that workflow - that is what the results page opens there - and the
  // plain Overview otherwise.
  const active = pathname.endsWith('/network') ? 'network'
    : pathname.endsWith('/report') ? 'report'
      : pathname.endsWith('/topology') ? 'topology'
        : pathname.endsWith('/drift') ? 'drift'
          : pathname.startsWith('/switch-info') ? 'switches'
            : hash === '#port' || flow === PORT ? 'result'
              : 'overview';
  const go = (key) => {
    // Both of the rack's own screens are the results page: Overview is the
    // rack, Port is the same page in its port lookup. The hash says which,
    // because the page is already mounted when the tap comes from it.
    if (key === 'overview') { setRackFlow(rackId, NETWORK); navigate(base); return; }
    if (key === 'result')   { setRackFlow(rackId, PORT);    navigate(`${base}#port`); return; }
    navigate(key === 'switches' ? `/switch-info/${encodeURIComponent(rackId)}` : `${base}/${key}`);
  };
  return <ScanTabBar flow={flow} activeTab={active} onTabChange={go} />;
}

export default function BottomNav() {
  const navigate = useNavigate();
  const { fn: shutterFn, canShoot } = useShutter();
  const { isAuthed } = useAuth();
  const links = usePrimaryNav();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  // A rack's own pages keep the rack's tabs. (/results/:rackId itself draws
  // them inside the page, so it never reaches here.)
  const rack = location.pathname.match(/^\/(?:results|switch-info)\/([^/]+)/);
  if (!isAuthed) return null;

  if (rack) {
    return (
      <RackTabs
        rackId={decodeURIComponent(rack[1])}
        pathname={location.pathname}
        hash={location.hash}
      />
    );
  }

  const barLinks = links.filter((l) => l.inBar);
  const overflow = links.filter((l) => !l.inBar);

  // While the camera viewfinder is live on the Scan page, ScanPage registers
  // a shutter handler. We hijack the SCAN tab onClick to fire it instead of
  // navigating, so the user can capture without losing this nav.
  const handleScanClick = (e) => {
    if (typeof shutterFn === 'function') {
      e.preventDefault();
      if (canShoot) shutterFn();
    }
  };

  // Highlight MORE while the user is actually on one of the pages it holds,
  // so the bar never looks like nothing is selected.
  const onOverflowPage = overflow.some(
    (l) => l.to && (location.pathname === l.to || location.pathname.startsWith(l.to + '/')),
  );

  const tabBody = (l) => (
    <>
      <span className={styles.icon} aria-hidden="true">{l.icon}</span>
      {/* barLabel lets a destination carry a shorter name in the bar than in
          the sidebar, where there is room for the full one. */}
      <span className={styles.label}>{(l.barLabel || l.label).toUpperCase()}</span>
    </>
  );

  // A destination outside the app (Approvals) is a link, never the active tab.
  const tab = (l) => (l.href ? (
    <ExternalLink key={l.href} href={l.href} className={styles.tab}>
      {tabBody(l)}
    </ExternalLink>
  ) : (
    <NavLink
      key={l.to}
      to={l.to}
      end={l.end}
      onClick={l.to === '/scan' ? handleScanClick : undefined}
      className={({ isActive }) => `${styles.tab} ${isActive && !moreOpen ? styles.active : ''}`}
    >
      {tabBody(l)}
    </NavLink>
  ));

  // Menu sits LAST, not in the middle. Wedged between Scan and Profile it read
  // as a peer destination and pushed Profile out of the corner people reach
  // for. It is "Menu", not "More": the sheet it opens is the rest of the app,
  // not more of this screen.
  const items = [...barLinks.map(tab)];
  if (overflow.length > 0) {
    items.push(
      <button
        key="menu"
        type="button"
        className={`${styles.tab} ${moreOpen || onOverflowPage ? styles.active : ''}`}
        onClick={() => setMoreOpen((o) => !o)}
        aria-expanded={moreOpen}
        aria-haspopup="dialog"
      >
        <span className={styles.icon} aria-hidden="true"><MoreIcon /></span>
        <span className={styles.label}>MENU</span>
      </button>,
    );
  }
  // Two items, the centre action, then the rest. Splitting the list rather
  // than naming positions means the bar still balances if that list ever
  // holds a different number.
  const half = Math.floor(items.length / 2);

  // The centre action is the camera, and Home is a tab in the row: a person
  // taps Scan far more often than anything else, so it is the raised one.
  const takeScan = () => {
    if (typeof shutterFn === 'function') { if (canShoot) shutterFn(); return; }
    navigate('/scan');
  };

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.bar}>
          {items.slice(0, half)}
          <span className={styles.centreSlot}>
            <button
              type="button"
              className={styles.centre}
              onClick={takeScan}
              aria-label={canShoot && typeof shutterFn === 'function' ? 'Take the photograph' : 'Scan a rack'}
            >
              <ScanIcon />
            </button>
          </span>
          {items.slice(half)}
        </div>
      </nav>

      {moreOpen && <MoreSheet links={overflow} onClose={() => setMoreOpen(false)} />}
    </>
  );
}
