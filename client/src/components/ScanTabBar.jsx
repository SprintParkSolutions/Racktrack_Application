import { useEffect, useRef, useState } from 'react';
import styles from './ScanTabBar.module.css';

// The rack's tab bar on a phone: Overview, Network, Report, Drift.
//
// One bar, four tabs, the same four on every page of a rack. It was briefly two
// rows of five - one for analysing the network, one for looking up a port - and
// before that one row of four with a More button holding Topology, Switches and
// Timeline. Both are gone: the bar is the four places a technician goes, and
// nothing hides behind a menu.
//
// Ports is gone too. Network IS the live switches now - read from this phone
// over SNMP - which is what Ports was trying to do over SSH from a server that
// could never reach them.
//
// Where the other screens live:
//   Timeline   a section of the Network page - what changed on these ports.
//   Topology   and Switches: opened from the Overview page, and on a desktop
//              from the sidebar. The bar lights Overview while one of them is
//              up, because that is the page they belong to and the page Back
//              returns to.
//   Port lookup   the Overview page's own "Look up a port" button.
//
// Network, Report and Drift open their own screens; the page handles that in
// onTabChange.
const TABS = [
  { key: 'overview', label: 'Overview', icon: <IconRack /> },
  { key: 'network',  label: 'Network',  icon: <IconNetwork /> },
  { key: 'report',   label: 'Report',   icon: <IconReport /> },
  { key: 'drift',    label: 'Drift',    icon: <IconDrift /> },
];

export const TAB_KEYS = TABS.map((t) => t.key);

/* Looking a port up is its own job, so while a person is in it the bar is the
   places that job leads to. Report and Drift are about the whole rack and had
   no business on a screen about one socket. */
const PORT_TABS = [
  { key: 'overview', label: 'Rack',     icon: <IconRack /> },
  { key: 'result',   label: 'Port',     icon: <IconPort /> },
  { key: 'switches', label: 'Switches', icon: <IconSwitch /> },
  { key: 'network',  label: 'Network',  icon: <IconNetwork /> },
  { key: 'drift',    label: 'Drift',    icon: <IconDrift /> },
  { key: 'topology', label: 'Topology', icon: <IconTopology /> },
  { key: 'report',   label: 'Report',   icon: <IconReport /> },
];

/** Screens that belong to Overview, so the bar lights Overview on them. */
const UNDER_OVERVIEW = ['result', 'topology', 'switches'];

export default function ScanTabBar({ activeTab, onTabChange, badges = {}, flow = 'rack' }) {
  const port = flow === 'port';
  const tabs = port ? PORT_TABS : TABS;
  const active = port ? activeTab
    : (UNDER_OVERVIEW.includes(activeTab) ? 'overview' : activeTab);

  // The bar holds five slots. With more ways on than that, four are tabs and
  // the fifth opens the rest over the bar. A bar that scrolls sideways under
  // the thumb hides half of itself and never says so.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const away = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [moreOpen]);

  const shown = tabs.length > 5 ? tabs.slice(0, 4) : tabs;
  const rest = tabs.length > 5 ? tabs.slice(4) : [];
  const restHolds = rest.some((t) => t.key === active);

  const tabButton = (tab) => (
    <button
      key={tab.key}
      role="tab"
      aria-selected={active === tab.key}
      className={`${styles.tab} ${active === tab.key ? styles.tabActive : ''}`}
      onClick={() => onTabChange(tab.key)}
      type="button"
    >
      <span className={styles.tabIcon}>{tab.icon}</span>
      <span className={styles.tabLabel}>{tab.label}</span>
      {badges[tab.key] > 0 && <span className={styles.tabBadge}>{badges[tab.key]}</span>}
    </button>
  );

  return (
    <nav className={styles.tabBar} role="tablist" aria-label="Scan results tabs">
      <div className={styles.bar}>
        {shown.map(tabButton)}
        {rest.length > 0 && (
          <div className={styles.moreWrap} ref={moreRef}>
            <button
              type="button"
              className={`${styles.tab} ${restHolds ? styles.tabActive : ''}`}
              aria-haspopup="true"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              <span className={styles.tabIcon}><IconMore /></span>
              <span className={styles.tabLabel}>More</span>
            </button>
            {moreOpen && (
              <div className={styles.moreSheet} role="menu">
                {rest.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="menuitem"
                    className={`${styles.moreItem} ${active === tab.key ? styles.moreItemActive : ''}`}
                    onClick={() => { setMoreOpen(false); onTabChange(tab.key); }}
                  >
                    <span className={styles.moreItemIcon}>{tab.icon}</span>
                    <span className={styles.moreItemLabel}>{tab.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

function IconMore() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" />
    </svg>
  );
}

// ── Tab icons (20×20, clean stroke style) ───────────────────────

function IconPort() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  );
}

function IconSwitch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="8" rx="1.5"/>
      <path d="M7 12h.01"/><path d="M10 12h.01"/><path d="M13 12h.01"/><path d="M16.5 12h1"/>
    </svg>
  );
}

function IconTopology() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="5" rx="1"/>
      <rect x="3" y="16" width="6" height="5" rx="1"/>
      <rect x="15" y="16" width="6" height="5" rx="1"/>
      <path d="M12 8v4"/><path d="M6 16v-4h12v4"/>
    </svg>
  );
}

function IconRack() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="8" y1="10" x2="16" y2="10"/>
      <line x1="8" y1="14" x2="16" y2="14"/>
      <line x1="8" y1="18" x2="16" y2="18"/>
    </svg>
  );
}


function IconNetwork() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
      <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
      <line x1="7" y1="7" x2="10" y2="10"/><line x1="17" y1="7" x2="14" y2="10"/>
      <line x1="7" y1="17" x2="10" y2="14"/><line x1="17" y1="17" x2="14" y2="14"/>
    </svg>
  );
}


function IconReport() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/>
    </svg>
  );
}

function IconDrift() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17h3v-5h4v-4h4v8h4v-3h3"/>
      <line x1="3" y1="21" x2="21" y2="21"/>
    </svg>
  );
}
