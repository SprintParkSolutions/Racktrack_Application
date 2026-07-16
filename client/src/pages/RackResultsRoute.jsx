import { useParams, useLocation } from 'react-router-dom';
import { useRackGroup } from '../components/useRackGroup';
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
  const { data, loading } = useRackGroup(rackId);
  const isDesktop = useIsDesktop();
  const members = data?.members || [];
  const isGroup = members.length >= 2;
  const isDrift = location.hash === '#drift';

  // Mobile / standalone → normal single page (its own rack switcher + tabs).
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
