import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useRackGroup } from '../components/useRackGroup';
import ResultsPage, { AllDevicesView } from './ResultsPage.jsx';
import styles from './SideBySideRacks.module.css';

// The Overview route. When the rack is part of a multi-rack group we render the
// SAME AllDevicesView the single-rack Overview uses — once per rack, side by
// side. A standalone rack falls through to the normal ResultsPage untouched.
export default function RackResultsRoute() {
  const { rackId } = useParams();
  const { data, loading } = useRackGroup(rackId);
  const members = data?.members || [];
  const isGroup = members.length >= 2;

  const [scans, setScans] = useState({});
  useEffect(() => {
    if (!isGroup) return;
    let alive = true;
    (async () => {
      const out = {};
      await Promise.all(members.map(async (m) => {
        try {
          const r = await authFetch(apiUrl(`/api/scan/${m.rack_id}`));
          out[m.rack_id] = r.ok ? await r.json() : { error: `HTTP ${r.status}` };
        } catch (e) { out[m.rack_id] = { error: e.message }; }
      }));
      if (alive) setScans(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, members.map(m => m.rack_id).join(',')]);

  // Standalone rack → the normal single-rack Overview.
  if (loading || !isGroup) return <ResultsPage />;

  return (
    <div className={styles.wrap}>
      <div className={styles.cols}>
        {members.map((m) => {
          const scan = scans[m.rack_id];
          return (
            <section key={m.rack_id} className={styles.col}>
              <header className={styles.colHead}>
                <span className={styles.pos}>#{m.position}</span>
                <span className={styles.title}>{m.label || m.rack_id}</span>
                <code className={styles.id}>{m.rack_id}</code>
              </header>
              {!scan ? (
                <div className={styles.center}>Loading rack…</div>
              ) : scan.error ? (
                <div className={styles.err}>{scan.error}</div>
              ) : (
                <AllDevicesView
                  devices={scan.devices || []}
                  labels={scan.labels || []}
                  rackId={m.rack_id}
                  scanId={m.rack_id}
                  originalExt={scan.originalExt}
                  onBack={() => {}}
                  embedded
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
