import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import styles from './BottomNav.module.css';
import { useShutter } from '../ShutterContext.jsx';
import { useAuth } from '../AuthContext.jsx';
import { usePrimaryNav, MoreIcon, HomeIcon } from '../nav/navLinks.jsx';
import MoreSheet from './MoreSheet.jsx';
import ScanTabBar from './ScanTabBar.jsx';
import ExternalLink from './ExternalLink.jsx';

/* ──────────────────────────────────────────────────────────────────────
   BottomNav - the phone navigation: a floating pill with four items around a
   raised centre action.

   The permanent slots come from the shared destination list in
   nav/navLinks.jsx, and MENU opens a sheet with everything else that list
   contains. This used to be three hardcoded constants while the sidebar
   built eight role-gated links, which is how Lab and Marketplace ended up
   with no tappable route on a phone at all.

   The centre action is Home, the app's landing screen, because that is what
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
 * Which five tabs that is depends on the job the person chose on the review
 * page - analyse the network, or look up a port. Network and
 * Timeline are in both, so the choice is read here rather than guessed from
 * the page.
 */
function RackTabs({ rackId, pathname, hash }) {
  const navigate = useNavigate();
  const active = pathname.endsWith('/network') ? 'network'
    : pathname.endsWith('/report') ? 'report'
      : pathname.endsWith('/topology') ? 'topology'
        : pathname.endsWith('/drift') ? 'drift'
          : pathname.startsWith('/switch-info') ? 'switches'
            : hash === '#drift' ? 'timeline'
              : 'overview';
  const base = `/results/${encodeURIComponent(rackId)}`;
  const go = (key) => {
    // 'port' is the bar's centre action, not a tab: it puts the rack in the
    // port flow and opens the results page, which reads that flow on mount and
    // comes up with the port picker open. Same thing the "Look up a port"
    // button on the results page fires.
    if (key === 'port') { navigate(`${base}#port`); return; }
    navigate(
      // Result is the results page again, which opens in its port mode while
      // the rack is in that flow.
      key === 'overview' || key === 'result' ? base
        : key === 'drift' ? `${base}/drift`
          : key === 'timeline' ? `${base}#drift`
          : key === 'switches' ? `/switch-info/${encodeURIComponent(rackId)}`
            : `${base}/${key}`,
    );
  };
  return <ScanTabBar rackId={rackId} activeTab={active} onTabChange={go} />;
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
  // The flow a rack is in lasts while the person moves between that rack's
  // pages. Anywhere else it is forgotten, so a rack opened again - after a new
  // scan, from History, from Profile - starts on Analyse the network.
  const onRack = !!rack;

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

  // The centre action is Home, at the owner's word (22 Sep): the app's landing
  // screen, where a person sees their racks and starts a scan. It is a button
  // rather than a link only so it sits in the same slot the bar draws for it.
  const goHome = () => navigate('/');

  return (
    <>
      <nav className={styles.nav}>
        <div className={styles.bar}>
          {items.slice(0, half)}
          <span className={styles.centreSlot}>
            <button
              type="button"
              className={styles.centre}
              onClick={goHome}
              aria-label="Home"
            >
              <HomeIcon />
            </button>
          </span>
          {items.slice(half)}
        </div>
      </nav>

      {moreOpen && <MoreSheet links={overflow} onClose={() => setMoreOpen(false)} />}
    </>
  );
}
