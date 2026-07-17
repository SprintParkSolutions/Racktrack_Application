import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext';
import styles from './PortHistoryPage.module.css';

// Owner-only lab view — the client side of /api/lab/*.
//
// Shows the SAME audit the live-switch Ports tab shows (identity, port
// faceplate, PoE, VLANs, LLDP neighbours, MAC table), but addressed by
// monitored_devices id: the browser sends only an id and never sees or sends a
// host or credentials. The live Ports page resolves hosts client-side against a
// hardcoded IP; this path resolves them server-side from the devices table plus
// the encrypted cred store.
//
// Why separate from PortHistoryPage: that page reads /api/ports/devices (any
// authenticated user) and hard-selects devices[0], so it can only ever show one
// switch and can't be scoped to an audience. This reads /api/lab/devices, which
// is requireRole('owner'), keeping the EVE-NG lab invisible to testers.
//
// EXPECT EMPTY COLUMNS ON LAB SWITCHES: Cisco IOL is virtual. It never
// negotiates a real link, so `show interfaces status` reports speed/duplex/type
// as auto/auto/unknown, and there is no PoE hardware at all. Blank there is
// correct, not a parse failure. The real TP-Link fills these in.

function fmtAgo(iso) {
  if (!iso) return 'never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 0)     return 'just now';
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// A device is only healthy once a poll has SUCCEEDED. last_seen is stamped on
// metadata write, so null means "never got data" even with zero failures —
// which is exactly what a missing-credentials device looks like, because the
// poller early-returns there without recording a failure.
function deviceState(d) {
  if (d.last_error) return { label: 'Failing',  cls: styles.down };
  if (!d.last_seen) return { label: 'No data',  cls: styles.unknown };
  if (!d.enabled)   return { label: 'Disabled', cls: styles.unknown };
  return { label: 'Polling', cls: styles.up };
}

function operClass(oper) {
  if (oper === 'up')   return styles.up;
  if (oper === 'down') return styles.down;
  return styles.unknown;
}

const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

const cell = { padding: '6px 10px', verticalAlign: 'top' };
const head = { ...cell, textAlign: 'left', borderBottom: '1px solid rgba(128,128,128,.4)', whiteSpace: 'nowrap' };
const card = {
  border: '1px solid rgba(128,128,128,.3)', borderRadius: 10,
  padding: '12px 14px', marginBottom: 16,
};

function Section({ title, count, children }) {
  return (
    <section style={card}>
      <h2 style={{ margin: '0 0 10px', fontSize: '1rem' }}>
        {title}
        {count !== undefined && <span style={{ opacity: .6, fontWeight: 400 }}> ({count})</span>}
      </h2>
      {children}
    </section>
  );
}

export default function LabPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [devices, setDevices]   = useState([]);
  const [loadErr, setLoadErr]   = useState(null);
  const [selectedId, setSelected] = useState(null);
  const [audit, setAudit]       = useState(null);
  const [auditErr, setAuditErr] = useState(null);
  const [busy, setBusy]         = useState(false);

  // Device list refreshes on a timer so last_seen / last_error track the 60s
  // poller without a manual reload.
  useEffect(() => {
    if (!isOwner) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await authFetch(apiUrl('/api/lab/devices'));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
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

  // The audit is an on-demand SSH pass, NOT polled: these switches allow ~1 SSH
  // session, and the server yields the background poller for 60s while it runs.
  // Firing it on a timer would fight the poller for the session.
  const runAudit = async (id) => {
    if (!id) return;
    setBusy(true); setAuditErr(null);
    try {
      const r = await authFetch(apiUrl(`/api/lab/devices/${id}/audit`), { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (!data.ok) throw new Error(data.error || 'audit failed');
      setAudit(data);
    } catch (err) {
      setAuditErr(err.message); setAudit(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { setAudit(null); setAuditErr(null); }, [selectedId]);

  if (!isOwner) {
    return (
      <div className={styles.page}>
        <main className={styles.main}><p>This page is restricted to platform owners.</p></main>
      </div>
    );
  }

  const selected = devices.find((d) => d.id === selectedId) || null;
  const ifstatus = audit?.ifstatus || {};
  const ifconfig = audit?.ifconfig || {};
  const poePorts = audit?.poe?.ports || {};
  const neighbors = audit?.neighbors || {};
  const ports = Object.keys(ifstatus).length
    ? Object.keys(ifstatus)
    : Object.keys(ifconfig);
  const macs = audit?.macs || {};
  const macRows = Object.entries(macs).flatMap(([port, list]) =>
    (Array.isArray(list) ? list : [list]).map((m) => ({ port, ...(typeof m === 'string' ? { mac: m } : m) })));

  return (
    <div className={styles.page}>
      <div className={styles.amb} aria-hidden />
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">‹</button>
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
              <button key={d.id} role="tab" aria-selected={active}
                      onClick={() => setSelected(d.id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                        padding: '8px 12px', borderRadius: 8, cursor: 'pointer', font: 'inherit',
                        textAlign: 'left', background: 'transparent',
                        border: active ? '2px solid currentColor' : '1px solid rgba(128,128,128,.4)',
                      }}>
                <strong>{d.display_name}</strong>
                <span style={{ fontSize: '.75em', opacity: .7 }}>{d.host} · {d.vendor}</span>
                <span style={{ fontSize: '.75em' }} className={st.cls}>
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

        {selected && (
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => runAudit(selectedId)} disabled={busy}
                    style={{
                      padding: '8px 14px', borderRadius: 8, cursor: busy ? 'wait' : 'pointer',
                      border: '1px solid currentColor', background: 'transparent', font: 'inherit',
                    }}>
              {busy ? 'Auditing…' : `Run full audit on ${selected.display_name}`}
            </button>
            <span style={{ marginLeft: 10, opacity: .65, fontSize: '.85em' }}>
              Live SSH pass — identity, ports, PoE, VLANs, LLDP, MAC table
            </span>
          </div>
        )}

        {auditErr && <p role="alert">Audit failed: {auditErr}</p>}

        {audit && (
          <>
            <Section title="Identity">
              <table><tbody>
                {[
                  ['Name', audit.identity?.name], ['Model', audit.identity?.model],
                  ['Serial', audit.identity?.serial], ['MAC', audit.identity?.mac],
                  ['Firmware', audit.identity?.firmware], ['Hardware', audit.identity?.hardware],
                  ['Host', audit.host], ['Vendor', audit.vendor],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...cell, opacity: .65, whiteSpace: 'nowrap' }}>{k}</td>
                    <td style={cell}>{dash(v)}</td>
                  </tr>
                ))}
              </tbody></table>
            </Section>

            <Section title="Ports" count={ports.length}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
                  <thead><tr>
                    {['Port', 'Link', 'Admin', 'Speed', 'Duplex', 'Type', 'PoE (W)', 'Description', 'Neighbour'].map((h) => (
                      <th key={h} style={head}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {ports.map((p) => {
                      const s = ifstatus[p] || {};
                      const c = ifconfig[p] || {};
                      const pe = poePorts[p] || {};
                      const n = neighbors[p] || {};
                      return (
                        <tr key={p}>
                          <td style={cell}><code>{p}</code></td>
                          <td style={cell}><span className={operClass(s.link || s.status)}>{dash(s.link || s.status)}</span></td>
                          <td style={cell}>{c.enabled === undefined ? '—' : (c.enabled ? 'enabled' : 'disabled')}</td>
                          <td style={cell}>{dash(s.speed)}</td>
                          <td style={cell}>{dash(s.duplex)}</td>
                          <td style={cell}>{dash(s.medium || s.type)}</td>
                          <td style={cell}>{dash(pe.power ?? pe.watts)}</td>
                          <td style={cell}>{dash(c.description || s.description)}</td>
                          <td style={cell}>{dash(n.system_name || n.name)}</td>
                        </tr>
                      );
                    })}
                    {!ports.length && <tr><td colSpan={9} style={cell}>No ports returned.</td></tr>}
                  </tbody>
                </table>
              </div>
              {audit.poe?.budget != null && (
                <p style={{ marginTop: 8, opacity: .7, fontSize: '.85em' }}>
                  PoE budget {audit.poe.budget}W · used {audit.poe.used ?? 0}W
                </p>
              )}
            </Section>

            <Section title="VLANs" count={audit.vlans?.length || 0}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
                  <thead><tr>{['VLAN', 'Name', 'Status', 'Ports'].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                  <tbody>
                    {(audit.vlans || []).map((v) => (
                      <tr key={v.id}>
                        <td style={cell}><code>{v.id}</code></td>
                        <td style={cell}>{dash(v.name)}</td>
                        <td style={cell}>{dash(v.status)}</td>
                        <td style={cell}>
                          {(v.ports || []).map((p) => (typeof p === 'string' ? p : `${p.port}${p.tagged ? ' (T)' : ''}`)).join(', ') || '—'}
                        </td>
                      </tr>
                    ))}
                    {!audit.vlans?.length && <tr><td colSpan={4} style={cell}>No VLANs returned.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="LLDP neighbours" count={Object.keys(neighbors).length}>
              {Object.keys(neighbors).length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
                    <thead><tr>{['Local port', 'System', 'Chassis', 'Remote port'].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                    <tbody>
                      {Object.entries(neighbors).map(([p, n]) => (
                        <tr key={p}>
                          <td style={cell}><code>{p}</code></td>
                          <td style={cell}>{dash(n.system_name || n.name)}</td>
                          <td style={cell}>{dash(n.chassis_id || n.chassis)}</td>
                          <td style={cell}>{dash(n.port_id || n.port)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ opacity: .7, margin: 0 }}>
                  None. IOS needs <code>lldp run</code> globally, and the IOL l2-ipbase image
                  may not support LLDP at all — Cisco defaults to CDP.
                </p>
              )}
            </Section>

            <Section title="MAC table" count={macRows.length}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
                  <thead><tr>{['Port', 'MAC', 'VLAN'].map((h) => <th key={h} style={head}>{h}</th>)}</tr></thead>
                  <tbody>
                    {macRows.map((m, i) => (
                      <tr key={`${m.port}-${m.mac}-${i}`}>
                        <td style={cell}><code>{m.port}</code></td>
                        <td style={cell}><code>{dash(m.mac)}</code></td>
                        <td style={cell}>{dash(m.vlan)}</td>
                      </tr>
                    ))}
                    {!macRows.length && <tr><td colSpan={3} style={cell}>No MAC entries returned.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
      </main>
    </div>
  );
}
