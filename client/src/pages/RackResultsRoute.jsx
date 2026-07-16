import { useParams, useLocation } from 'react-router-dom';
import { useGroupView } from '../hooks/useGroupView';
import { useIsDesktop } from '../hooks/useIsDesktop';
import ResultsPage from './ResultsPage.jsx';
import { RackToggle } from './SideBySideRacks.jsx';
import styles from './SideBySideRacks.module.css';

// The Overview route.
//   Desktop + group → the full ResultsPage (photo + device boxes + picker) for
//                     BOTH racks, side by side.
//   Mobile / standalone → the normal single ResultsPage, which already carries
//                     a rack-switcher (RackTabs) to toggle between racks — side
//                     by side is too cramped on a phone.
export default function RackResultsRoute() {
  const { rackId } = useParams();
  const location = useLocation();
  const { data, loading, isGroup, members } = useGroupView(rackId);
  const isDesktop = useIsDesktop();
  const isDrift = location.hash === '#drift';

  // Single scan (or no ?group signal) → normal single page. Group view is only
  // shown when the two-rack workflow opted in via ?group.
  if (loading || !isGroup || !isDesktop) return <ResultsPage />;
  // Drift → toggle between racks (not side by side), same as the other tabs.
  if (isDrift) {
    return <RackToggle Single={ResultsPage}
      render={(rid) => <ResultsPage rackId={rid} embedded />} />;
  }

  // Desktop Overview → both racks side by side.
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
            <div className={styles.colBody}>
              <ResultsPage rackId={m.rack_id} embedded />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
