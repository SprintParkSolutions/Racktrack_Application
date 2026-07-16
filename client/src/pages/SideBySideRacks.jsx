import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useRackGroup } from '../components/useRackGroup';
import { NetdiscoContent } from './NetdiscoPage.jsx';
import NetdiscoPage from './NetdiscoPage.jsx';
import { SwitchInfoContent } from './SwitchInformationPage.jsx';
import SwitchInformationPage from './SwitchInformationPage.jsx';
import { PortsContent } from './PortsPage.jsx';
import PortsPage from './PortsPage.jsx';
import styles from './SideBySideRacks.module.css';

// Rack TOGGLE: for a multi-rack group, show ONE rack's content at a time with a
// pill toggle to switch between racks. Rendering one at a time keeps live-probe
// pages (Ports) correct — no two simultaneous probes. Standalone rack → the
// normal single page.
export function RackToggle({ Single, render }) {
  const { rackId } = useParams();
  const { data, loading } = useRackGroup(rackId);
  const [active, setActive] = useState(0);
  const members = data?.members || [];

  if (loading || members.length < 2) return <Single />;
  const idx = Math.min(active, members.length - 1);
  const m = members[idx];

  return (
    <div className={styles.wrap}>
      <div className={styles.rackToggleBar}>
        {members.map((mem, i) => (
          <button
            key={mem.rack_id}
            className={`${styles.rackTgl} ${i === idx ? styles.rackTglOn : ''}`}
            onClick={() => setActive(i)}
          >
            <span className={styles.rackTglPos}>#{mem.position}</span>
            {mem.label || mem.rack_id}
          </button>
        ))}
      </div>
      {/* key forces a clean remount on switch so per-rack state/probes reset */}
      <div key={m.rack_id}>{render(m.rack_id)}</div>
    </div>
  );
}

// ── Per-page route wrappers (one rack at a time + toggle) ────────────
export function RackSwitchesRoute() {
  return <RackToggle Single={SwitchInformationPage}
    render={(rid) => <SwitchInfoContent rackId={rid} />} />;
}

export function RackNetworkRoute() {
  return <RackToggle Single={NetdiscoPage}
    render={(rid) => <NetdiscoContent rackId={rid} />} />;
}

export function RackPortsRoute() {
  return <RackToggle Single={PortsPage}
    render={(rid) => <PortsContent rackId={rid} />} />;
}
