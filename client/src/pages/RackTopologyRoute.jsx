import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useRackGroup } from '../components/useRackGroup';
import TopologyPage, { RackElevation } from './TopologyPage.jsx';
import MultiRackTopologyPage from './MultiRackTopologyPage.jsx';
import styles from './SideBySideRacks.module.css';

// Topology for a rack group: a single 2D / 3D toggle over BOTH racks.
//   3D → the existing combined 3D scene (both racks in one space + inter-rack cables)
//   2D → each rack's flat elevation, side by side
// A standalone rack falls through to the normal single-rack TopologyPage.
export default function RackTopologyRoute() {
  const { rackId } = useParams();
  const navigate = useNavigate();
  const { data, loading } = useRackGroup(rackId);
  const members = data?.members || [];
  const isGroup = members.length >= 2;

  const [view, setView] = useState(() => {
    try { return localStorage.getItem('rt_topo_view') || '2d'; } catch { return '2d'; }
  });
  const pick = (v) => { setView(v); try { localStorage.setItem('rt_topo_view', v); } catch (_) {} };

  const [topos, setTopos] = useState({});
  useEffect(() => {
    if (!isGroup || view !== '2d') return;
    let alive = true;
    (async () => {
      const out = {};
      await Promise.all(members.map(async (m) => {
        try {
          const r = await authFetch(apiUrl(`/api/topology/${m.rack_id}`));
          out[m.rack_id] = r.ok ? await r.json() : { __err: `HTTP ${r.status}` };
        } catch (e) { out[m.rack_id] = { __err: e.message }; }
      }));
      if (alive) setTopos(out);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroup, view, members.map(m => m.rack_id).join(',')]);

  if (loading || !isGroup) return <TopologyPage />;

  return (
    <div className={styles.wrap}>
      <header className={styles.topoBar}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="Back">←</button>
        <span className={styles.topoTitle}>Topology · {members.length} racks</span>
        <div className={styles.toggle}>
          <button className={`${styles.tglBtn} ${view !== '3d' ? styles.tglOn : ''}`} onClick={() => pick('2d')}>2D</button>
          <button className={`${styles.tglBtn} ${view === '3d' ? styles.tglOn : ''}`} onClick={() => pick('3d')}>3D</button>
        </div>
      </header>

      {view === '3d' ? (
        <div className={styles.scene3d}>
          <MultiRackTopologyPage groupId={data.group.id} hideHeader />
        </div>
      ) : (
        <div className={styles.cols}>
          {members.map((m) => {
            const topo = topos[m.rack_id];
            return (
              <section key={m.rack_id} className={styles.col}>
                <header className={styles.colHead}>
                  <span className={styles.pos}>#{m.position}</span>
                  <span className={styles.title}>{m.label || m.rack_id}</span>
                  <code className={styles.id}>{m.rack_id}</code>
                </header>
                {!topo ? <div className={styles.center}>Loading topology…</div>
                  : topo.__err ? <div className={styles.err}>{topo.__err === 'HTTP 404' ? 'Topology still generating — refresh shortly.' : topo.__err}</div>
                  : <Rack2D topo={topo} />}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Rack2D({ topo }) {
  const [selected, setSelected] = useState(null);
  return <RackElevation topo={topo} selected={selected} setSelected={setSelected} />;
}
