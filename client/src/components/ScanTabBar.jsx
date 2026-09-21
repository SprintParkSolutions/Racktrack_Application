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

/** Screens that belong to Overview, so the bar lights Overview on them. */
const UNDER_OVERVIEW = ['result', 'topology', 'switches'];

export default function ScanTabBar({ activeTab, onTabChange, badges = {} }) {
  const active = UNDER_OVERVIEW.includes(activeTab) ? 'overview' : activeTab;

  return (
    <nav className={styles.tabBar} role="tablist" aria-label="Scan results tabs">
      <div className={styles.bar}>
        {TABS.map((tab) => (
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
        ))}
      </div>
    </nav>
  );
}

// ── Tab icons (20×20, clean stroke style) ───────────────────────

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
