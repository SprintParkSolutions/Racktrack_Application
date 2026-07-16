import { useParams } from 'react-router-dom';
import { useRackGroup } from '../components/useRackGroup';
import ResultsPage from './ResultsPage.jsx';
import styles from './SideBySideRacks.module.css';

// The Overview route. When the rack is part of a multi-rack group we render the
// SAME full ResultsPage (rack photo + device boxes + picker) once per rack,
// side by side. A standalone rack falls through to the normal single page.
export default function RackResultsRoute() {
  const { rackId } = useParams();
  const { data, loading } = useRackGroup(rackId);
  const members = data?.members || [];
  const isGroup = members.length >= 2;

  if (loading || !isGroup) return <ResultsPage />;

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
