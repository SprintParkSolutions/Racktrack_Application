import { useEffect, useRef, useState } from 'react';
import styles from './ScanTabBar.module.css';

// The rack's tab bar on a phone.
//
// A rack holds two jobs, and the Overview asks which one you are here for:
// analyse the network, or look up a port. They want different screens in
// different orders, so each has its own bar - and the whole point of a bar is
// that it is the SAME bar on every screen of the job it belongs to. Which job
// a rack is in is remembered in utils/rackFlow.js, not worked out per screen:
// it used to be page state, so it died on every route change and the bar
// quietly turned into the other workflow's halfway through.
//
// Analysing the network is the rack as a whole - four plain tabs, nothing
// behind a menu. Topology and Switches are opened from the Overview page (and
// on a desktop from the sidebar); they belong to Overview, so the bar lights
// Overview while one of them is up, and Back returns there.
//
// Looking a port up is one socket, and the screens that job leads to are more
// than a bar holds. Four tabs then, and a More for the rest - a bar that
// slides sideways under the thumb hides half of itself and never says so.
//
// Ports - the old page of that name - is gone from both. Network IS the live
// switches now, read from this phone over SNMP, which is what Ports was trying
// to do over SSH from a server that could never reach them.
const NETWORK_TABS = [
  { key: 'overview', label: 'Overview', icon: <IconRack /> },
  { key: 'network',  label: 'Network',  icon: <IconNetwork /> },
  { key: 'report',   label: 'Report',   icon: <IconReport /> },
  { key: 'drift',    label: 'Drift',    icon: <IconDrift /> },
];

/* Looking a port up leads with the rack, then the port itself, then every
   other way on. Report and Drift are about the whole rack and had no business
   in the front row of a screen about one socket, so they are under More. */
const PORT_TABS = [
  { key: 'overview', label: 'Rack',     icon: <IconRack /> },
  { key: 'result',   label: 'Port',     icon: <IconPort /> },
  { key: 'switches', label: 'Switches', icon: <IconSwitch /> },
  { key: 'network',  label: 'Network',  icon: <IconNetwork /> },
  { key: 'drift',    label: 'Drift',    icon: <IconDrift /> },
  { key: 'topology', label: 'Topology', icon: <IconTopology /> },
  { key: 'report',   label: 'Report',   icon: <IconReport /> },
];

/** The tabs of a workflow, in the order the bar has them. */
export const tabsFor = (flow) => (flow === 'port' ? PORT_TABS : NETWORK_TABS);
/** Every screen a workflow's bar can reach. */
export const tabKeysFor = (flow) => tabsFor(flow).map((t) => t.key);

/* Screens that belong to Overview while the rack is being analysed as a whole,
   so the bar lights Overview on them. In the port workflow they are tabs of
   their own and light themselves. */
const UNDER_OVERVIEW = ['result', 'topology', 'switches'];

/** Which tab of this workflow is lit on this screen - always one the bar has. */
export function activeTabFor(flow, activeTab) {
  const keys = tabKeysFor(flow);
  if (keys.includes(activeTab)) return activeTab;
  if (flow !== 'port' && UNDER_OVERVIEW.includes(activeTab)) return 'overview';
  return 'overview';
}

export default function ScanTabBar({ activeTab, onTabChange, badges = {}, flow = 'network' }) {
  const tabs = tabsFor(flow);
  const active = activeTabFor(flow, activeTab);

  // The bar holds five slots. With more ways on than that, four are tabs and
  // the fifth opens the rest over the bar.
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
    <nav className={styles.tabBar} role="tablist"
      aria-label={flow === 'port' ? 'Port lookup tabs' : 'Network analysis tabs'}>
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
