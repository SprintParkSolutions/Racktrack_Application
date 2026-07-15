import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import styles from './MultiRackReportPage.module.css';

// The report tabs. Topology jumps to the existing 3D combined view; the rest
// render both racks side by side here.
const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'ports',    label: 'Ports' },
  { key: 'switches', label: 'Switches' },
  { key: 'network',  label: 'Network' },
  { key: 'drift',    label: 'Drift' },
  { key: 'topology', label: 'Topology' },
];

const CABLE_COLOR = {
  black: '#1c1c1e', blue: '#2f6bd8', brown: '#8b5a2b', green: '#1f9d55',
  grey: '#9aa0a6', gray: '#9aa0a6', orange: '#e8792b', pink: '#e86fa6',
  red: '#d0342c', white: '#f4f4f6', yellow: '#e6b800', violet: '#8b5cf6', aqua: '#22c3d6',
};
const cableCss = (c) => (c && CABLE_COLOR[String(c).toLowerCase()]) || '#8a8082';

// Aggregate a device's connected ports into connector+colour chips (same idea
// as the single-rack device cards).
function cableChips(dev) {
  const map = new Map();
  for (const lst of [dev?.ports, dev?.sfp_ports, dev?.other_ports]) {
    if (!Array.isArray(lst)) continue;
    for (const p of lst) {
      if (!p || p.status !== 'connected') continue;
      const connector = p.cable_connector || '';
      const color = p.cable_color || '';
      if (!connector && !color) continue;
      const key = `${connector}|${color}`;
      const cur = map.get(key) || { connector, color, count: 0 };
      cur.count += 1; map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function fmtUnits(units = []) {
  const nums = (units || []).map(u => parseInt(String(u).replace(/\D/g, ''), 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (!nums.length) return '—';
  return nums.length === 1 ? `U${String(nums[0]).padStart(2, '0')}`
    : `U${String(nums[0]).padStart(2, '0')}–U${String(nums[nums.length - 1]).padStart(2, '0')}`;
}

// ── One rack's report column ─────────────────────────────────────────
function OverviewColumn({ member, scan, error }) {
  const devices = scan?.devices || [];
  const totals = useMemo(() => {
    let ports = 0, connected = 0, sfp = 0;
    for (const d of devices) {
      ports += d.port_count || (Array.isArray(d.ports) ? d.ports.length : 0);
      connected += (d.connected_ports?.length) || (Array.isArray(d.ports) ? d.ports.filter(p => p.status === 'connected').length : 0);
      sfp += d.sfp_ports?.length || 0;
    }
    return { devices: devices.length, ports, connected, sfp };
  }, [devices]);

  return (
    <div className={styles.col}>
      <div className={styles.colHead}>
        <span className={styles.colPos}>#{member.position}</span>
        <span className={styles.colTitle}>{member.label || member.rack_id}</span>
        <code className={styles.colId}>{member.rack_id}</code>
      </div>

      {error ? <div className={styles.err}>{error}</div> : (
        <>
          <div className={styles.summaryRow}>
            <div className={styles.sum}><b>{totals.devices}</b><span>devices</span></div>
            <div className={styles.sum}><b>{totals.ports}</b><span>ports</span></div>
            <div className={styles.sum}><b>{totals.connected}</b><span>connected</span></div>
            <div className={styles.sum}><b>{totals.sfp}</b><span>SFP</span></div>
          </div>

          <div className={styles.devList}>
            {devices.map((d, i) => {
              const chips = cableChips(d);
              return (
                <div key={i} className={styles.dev}>
                  <div className={styles.devTop}>
                    <span className={styles.devUnit}>{fmtUnits(d.units)}</span>
                    <span className={styles.devClass}>{d.class_name}</span>
                    <span className={styles.devPorts}>
                      {d.port_count > 0 && <span className={styles.pill}>{d.port_count}p</span>}
                      {d.sfp_ports?.length > 0 && <span className={styles.pillS}>{d.sfp_ports.length}s</span>}
                      {d.console_ports?.length > 0 && <span className={styles.pillC}>{d.console_ports.length}c</span>}
                    </span>
                  </div>
                  {chips.length > 0 && (
                    <div className={styles.chips}>
                      {chips.map((ch, k) => (
                        <span key={k} className={styles.chip}>
                          <span className={styles.swatch} style={{ background: cableCss(ch.color) }} />
                          {[ch.connector, ch.color].filter(Boolean).join(' ')}<b>×{ch.count}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!devices.length && <div className={styles.empty}>No devices detected.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// Placeholder for tabs not yet built side-by-side — links to each rack's page.
function ComingSoonColumn({ member, tab, navigate }) {
  const route = {
    ports:    `/results/${member.rack_id}/ports`,
    switches: `/switch-info/${member.rack_id}`,
    network:  `/results/${member.rack_id}/netdisco`,
    drift:    `/results/${member.rack_id}#drift`,
  }[tab];
  return (
    <div className={styles.col}>
      <div className={styles.colHead}>
        <span className={styles.colPos}>#{member.position}</span>
        <span className={styles.colTitle}>{member.label || member.rack_id}</span>
      </div>
      <div className={styles.soon}>
        <p>Side-by-side {tab} view is coming here.</p>
        {route && <button className={styles.linkBtn} onClick={() => navigate(route)}>Open this rack’s {tab} →</button>}
      </div>
    </div>
  );
}

export default function MultiRackReportPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'overview';

  const [group, setGroup] = useState(null);
  const [scans, setScans] = useState({});   // rackId → scan | {error}
  const [loading, setLoading] = useState(true);
  const [groupErr, setGroupErr] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await authFetch(apiUrl(`/api/rack-group/${encodeURIComponent(groupId)}`));
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Group not found');
        if (!alive) return;
        setGroup(j);
        const out = {};
        await Promise.all((j.members || []).map(async (m) => {
          try {
            const sr = await authFetch(apiUrl(`/api/scan/${m.rack_id}`));
            const sj = await sr.json().catch(() => ({}));
            out[m.rack_id] = sr.ok ? sj : { error: sj.error || `HTTP ${sr.status}` };
          } catch (e) { out[m.rack_id] = { error: e.message }; }
        }));
        if (alive) setScans(out);
      } catch (e) {
        if (alive) setGroupErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [groupId]);

  const members = group?.members || [];
  const setTab = (k) => {
    if (k === 'topology') { navigate(`/multi-rack/${groupId}/topology`); return; }
    setParams({ tab: k });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="Back">←</button>
        <div className={styles.headMid}>
          <h1>Two-rack report</h1>
          <span className={styles.headSub}>{members.length} racks · side by side</span>
        </div>
        <a className={styles.dl}
           href={apiUrl(`/api/rack-group/${encodeURIComponent(groupId)}/report?format=html`)}
           target="_blank" rel="noopener noreferrer">Download report</a>
      </header>

      <nav className={styles.tabs}>
        {TABS.map(t => (
          <button key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabOn : ''}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </nav>

      <main className={styles.body}>
        {loading && <div className={styles.center}>Loading both racks…</div>}
        {groupErr && <div className={styles.center}>{groupErr}</div>}
        {!loading && !groupErr && (
          <div className={styles.cols}>
            {members.map(m => (
              tab === 'overview'
                ? <OverviewColumn key={m.rack_id} member={m} scan={scans[m.rack_id]} error={scans[m.rack_id]?.error} />
                : <ComingSoonColumn key={m.rack_id} member={m} tab={tab} navigate={navigate} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
