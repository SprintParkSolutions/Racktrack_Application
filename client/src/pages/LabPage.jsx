import { useEffect, useState } from 'react';
import { useSmartBack } from '../hooks/useSmartBack';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext';
import styles from './PortHistoryPage.module.css';

// Owner-only lab view — the client side of /api/lab/*.
//
// Why this exists separately from PortHistoryPage: that page reads
// /api/ports/devices (any authenticated user) and hard-selects devices[0],
// so it can only ever show one switch and can't be scoped to an audience.
// This page reads /api/lab/devices, which is requireRole('owner'), so the
// EVE-NG lab switches stay invisible to testers while we shake them out.
//
// It deliberately shows `host` — the /api/ports views strip it, but an owner
// debugging a switch that won't poll needs the IP and the error string.
//
// NOTE on the port grid: virtual lab switches (Cisco IOL) report
// speed/duplex/medium as "auto"/"unknown" because they never negotiate a
// real link, so those columns come back null and render as "—". That's the
// hardware being virtual, not a parse failure. PoE is likewise always empty.

function fmtAgo(iso) {
  if (!iso) return 'never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 0)    return 'just now';
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function fmtSpeed(mbps) {
  if (mbps === null || mbps === undefined) return '—';
  return mbps >= 1000 ? `${mbps / 1000}G` : `${mbps}M`;
}

// A device is only healthy if a poll has actually succeeded. last_seen is
// stamped on metadata write, so null means "never got data" even when
// consecutive_failures is 0 — which is exactly what a missing-credentials
// device looks like (the poller early-returns without recording a failure).
function deviceState(d) {
  if (d.last_error)  return { label: 'Failing',  tone: 'bad'  };
  if (!d.last_seen)  return { label: 'No data',  tone: 'warn' };
  if (!d.enabled)    return { label: 'Disabled', tone: 'warn' };
  return { label: 'Polling', tone: 'ok' };
}

export default function LabPage() {
  const goBack = useSmartBack();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [devices, setDevices]   = useState([]);
  const [loadErr, setLoadErr]   = useState(null);
  const [selectedId, setSelected] = useState(null);
  const [ports, setPorts]       = useState(null);
  const [portsErr, setPortsErr] = useState(null);

  // Refresh the device list on a timer so last_seen / last_error track the
  // 60s poller without a manual reload.
  useEffect(() => {
    if (!isOwner) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await authFetch(apiUrl('/api/lab/devices'));
        if (!r.ok) throw new Error(`devices: HTTP ${r.status}`);
        const data = await r.json();
        if (cancelled) return;
        setDevices(data.devices || []);
        setLoadErr(null);
        setSelected((cur) => cur ?? data.devices?.[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setLoadErr(err.message);
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner || !selectedId) { setPorts(null); return undefined; }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await authFetch(apiUrl(`/api/ports/${selectedId}/overview`));
        if (!r.ok) throw new Error(`overview: HTTP ${r.status}`);
        const data = await r.json();
        if (cancelled) return;
        setPorts(data.ports || []);
        setPortsErr(null);
      } catch (err) {
        if (!cancelled) { setPortsErr(err.message); setPorts(null); }
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isOwner, selectedId]);

  if (!isOwner) {
    return (
      <div className={styles.page}>
        <main className={styles.main}>
          <p>This page is restricted to platform owners.</p>
        </main>
      </div>
    );
  }

  const selected = devices.find((d) => d.id === selectedId) || null;

  return (
    <div className={styles.page}>
      <div className={styles.amb} aria-hidden />
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => goBack()} aria-label="Back">‹</button>
        <div className={styles.headerCenter}>
          <h1 className={styles.headerTitle}>Lab</h1>
          <p className={styles.headerSub}>Owner-only · EVE-NG switches</p>
        </div>
        <span className={styles.spacer} />
      </header>

      <main className={styles.main}>
        {loadErr && <p role="alert">Could not load devices: {loadErr}</p>}

        <div role="tablist" aria-label="Lab devices"
             style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {devices.map((d) => {
            const st = deviceState(d);
            const active = d.id === selectedId;
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={active}
                onClick={() => setSelected(d.id)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                  gap: 2, padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                  border: active ? '2px solid currentColor' : '1px solid rgba(128,128,128,.4)',
                  background: 'transparent', font: 'inherit', textAlign: 'left',
                }}
              >
                <strong>{d.display_name}</strong>
                <span style={{ fontSize: '.75em', opacity: .7 }}>
                  {d.host} · {d.vendor}
                </span>
                <span style={{ fontSize: '.75em', opacity: .7 }}>
                  {st.label} · {fmtAgo(d.last_seen)}
                </span>
              </button>
            );
          })}
          {!devices.length && !loadErr && <p>No lab devices registered.</p>}
        </div>

        {selected?.last_error && (
          <p role="alert" style={{ marginBottom: 12 }}>
            <strong>{selected.display_name}</strong> ({selected.host}) is failing after{' '}
            {selected.consecutive_failures} attempt(s): <code>{selected.last_error}</code>
          </p>
        )}

        {portsErr && <p role="alert">Could not load ports: {portsErr}</p>}

        {ports && (
          <>
            <h2 style={{ marginBottom: 8 }}>
              Interfaces <span style={{ opacity: .6, fontWeight: 400 }}>({ports.length})</span>
            </h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 520, width: '100%' }}>
                <thead>
                  <tr>
                    {['Port', 'Oper', 'Admin', 'Speed', 'Duplex', 'Description', 'Neighbour'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px',
                                           borderBottom: '1px solid rgba(128,128,128,.4)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ports.map((p) => (
                    <tr key={p.port}>
                      <td style={{ padding: '6px 10px' }}><code>{p.port}</code></td>
                      <td style={{ padding: '6px 10px' }}>
                        <span className={operClass(p.oper)}>{p.oper}</span>
                      </td>
                      <td style={{ padding: '6px 10px' }}>{p.admin}</td>
                      <td style={{ padding: '6px 10px' }}>{fmtSpeed(p.speed_mbps)}</td>
                      <td style={{ padding: '6px 10px' }}>{p.duplex || '—'}</td>
                      <td style={{ padding: '6px 10px' }}>{p.descr || '—'}</td>
                      <td style={{ padding: '6px 10px' }}>{p.lldp_system || '—'}</td>
                    </tr>
                  ))}
                  {!ports.length && (
                    <tr><td colSpan={7} style={{ padding: '10px' }}>
                      No port data yet — the poller runs every 60s.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

// Same colour mapping PortHistoryPage uses, so up/down reads identically
// across both views.
function operClass(oper) {
  if (oper === 'up')   return styles.up;
  if (oper === 'down') return styles.down;
  return styles.unknown;
}
