import { useParams } from 'react-router-dom';
import { useRackGroup } from '../components/useRackGroup';
import { NetdiscoContent } from './NetdiscoPage.jsx';
import NetdiscoPage from './NetdiscoPage.jsx';
import { SwitchInfoContent } from './SwitchInformationPage.jsx';
import SwitchInformationPage from './SwitchInformationPage.jsx';
import styles from './SideBySideRacks.module.css';

// Generic: when the current rack is part of a multi-rack group, render the
// SAME per-rack content component once per member, side by side. A standalone
// rack falls through to its normal single page — untouched.
export function SideBySideRacks({ Single, renderRack }) {
  const { rackId } = useParams();
  const { data, loading } = useRackGroup(rackId);
  const members = data?.members || [];
  if (loading || members.length < 2) return <Single />;
  return (
    <div className={styles.wrap}>
      <div className={styles.cols}>
        {members.map((m) => (
          <section key={m.rack_id} className={styles.col}>
            <header className={styles.colHead}>
              <span className={styles.pos}>#{m.position}</span>
              <span className={styles.title}>{m.label || m.rack_id}</span>
              <code className={styles.id}>{m.rack_id}</code>
            </header>
            <div className={styles.colBody}>{renderRack(m)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Per-page route wrappers ──────────────────────────────────────────
export function RackSwitchesRoute() {
  return <SideBySideRacks Single={SwitchInformationPage}
    renderRack={(m) => <SwitchInfoContent rackId={m.rack_id} />} />;
}

export function RackNetworkRoute() {
  return <SideBySideRacks Single={NetdiscoPage}
    renderRack={(m) => <NetdiscoContent rackId={m.rack_id} />} />;
}
