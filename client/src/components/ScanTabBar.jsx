import { getRackFlow } from '../utils/rackFlow';
import styles from './ScanTabBar.module.css';

// The rack's tab bar on a phone. A rack is worked in one of two ways, chosen on
// the review page, and each has its own row of five:
//
//   Analyse the network   Overview, Network, Drift, Report, Timeline
//   Look up a port        Result, Switches, Network, Topology, Timeline
//
// Every tab is a page the app already had. There used to be one row for both
// jobs with a More tab at the end, and Topology, Switches and Timeline sat in
// its sheet; each of them is a tab of the flow it belongs to now, so the More
// tab and its sheet are gone.
//
// Ports is gone. Network IS the live switches now - read from this phone over
// SNMP - which is what Ports was trying to do over SSH from a server that
// could never reach them, and what the Netdisco "Discovery" view only ever
// showed second-hand. Network, Drift and Report open their own screens; the
// page handles that in onTabChange.
//
// Result is the results page in its port mode: the photograph, the device
// list, the "Find a port" card and the located port.
//
// Timeline is the screen that used to be called Drift: what changed on this
// rack's ports over time, and the switches added on the Network page. Drift
// now means the check against the record, and the owner asked where the older
// screen had gone - so it keeps its place under a name of its own.
const TABS = {
  overview: { label: 'Overview', icon: <IconRack /> },
  result:   { label: 'Result',   icon: <IconRack /> },
  network:  { label: 'Network',  icon: <IconNetwork /> },
  drift:    { label: 'Drift',    icon: <IconDrift /> },
  report:   { label: 'Report',   icon: <IconReport /> },
  timeline: { label: 'Timeline', icon: <IconDrift /> },
  switches: { label: 'Switches', icon: <IconSwitch /> },
  topology: { label: 'Topology', icon: <IconTopology /> },
};
export const FLOW_TABS = {
  analyse: ['overview', 'network', 'drift', 'report', 'timeline'],
  port:    ['result', 'switches', 'network', 'topology', 'timeline'],
};

// `flow` comes from the page when the page holds it (the results page knows its
// own port mode); every other rack page leaves it out and the bar reads what
// was remembered for this rack.
export default function ScanTabBar({ rackId, flow, activeTab, onTabChange, badges = {} }) {
  const inFlow = FLOW_TABS[flow] ? flow : getRackFlow(rackId);
  // The results page is one screen with two names: Overview, or Result while a
  // port is being looked up.
  const active = activeTab === 'overview' || activeTab === 'result'
    ? (inFlow === 'port' ? 'result' : 'overview')
    : activeTab;

  const keys = FLOW_TABS[inFlow];
  const item = (key) => {
    const tab = TABS[key];
    const isActive = active === key;
    const badge = badges[key];
    return (
      <button
        key={key}
        role="tab"
        aria-selected={isActive}
        className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
        onClick={() => onTabChange(key)}
        type="button"
      >
        <span className={styles.tabIcon}>{tab.icon}</span>
        <span className={styles.tabLabel}>{tab.label}</span>
        {badge != null && badge > 0 && <span className={styles.tabBadge}>{badge}</span>}
      </button>
    );
  };
  // Two tabs, the centre action, then the rest. Splitting the list rather than
  // naming positions means the bar still balances whatever that list holds.
  const half = Math.floor(keys.length / 2);

  return (
    <nav className={styles.tabBar} role="tablist" aria-label="Scan results tabs">
      <div className={styles.bar}>
        {keys.slice(0, half).map(item)}
        {/* The centre action is the rack's other job. It is not a tab - it does
            not light up and it holds no label - so it answers with its own key
            and the page turns that into what the "Look up a port" button on the
            results page already does: remember the port flow for this rack and
            open the picker. */}
        <span className={styles.centreSlot}>
          <button
            type="button"
            className={styles.centre}
            onClick={() => onTabChange('port')}
            aria-label="Look up a port"
            title="Look up a port"
          >
            <IconPortLookup />
          </button>
        </span>
        {keys.slice(half).map(item)}
      </div>
    </nav>
  );
}

// ── Tab icons (20×20, clean stroke style) ───────────────────────

// The centre action: looking a port up is a search, and this is the magnifier
// the app already uses for one (components/Icon.jsx, 'search'), drawn here in
// this bar's own stroke style so it sits with its neighbours.
function IconPortLookup() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
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

function IconTopology() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="6" rx="1.5"/>
      <rect x="2" y="16" width="6" height="6" rx="1.5"/>
      <rect x="16" y="16" width="6" height="6" rx="1.5"/>
      <path d="M12 8v4M5 16v-4h14v4"/>
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

function IconSwitch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="5" rx="1.5"/>
      <rect x="2" y="10" width="20" height="5" rx="1.5"/>
      <rect x="2" y="17" width="20" height="5" rx="1.5"/>
      <circle cx="18" cy="5.5" r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="12.5" r="1.2" fill="currentColor" stroke="none"/>
      <circle cx="18" cy="19.5" r="1.2" fill="currentColor" stroke="none"/>
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
