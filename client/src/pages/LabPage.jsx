import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext';
import styles from './PortHistoryPage.module.css';

// Owner-only lab view — the client side of /api/lab/*.
//
// Shows the SAME audit the live-switch Ports tab shows (identity, port
// faceplate, PoE, VLANs, LLDP neighbours, MAC table), addressed by
// monitored_devices id: the browser sends only an id and never sees or sends a
// host or credentials. The live Ports page resolves hosts client-side against a
// hardcoded IP; this resolves them server-side from the devices table plus the
// encrypted cred store.
//
// Separate from PortHistoryPage because that page reads /api/ports/devices (any
// authenticated user) and hard-selects devices[0] — it can only ever show one
// switch and can't be scoped to an audience. This reads /api/lab/devices, which
// is requireRole('owner'), keeping the lab invisible to testers.
//
// Results are CACHED PER DEVICE (auditsRef): an audit is a live SSH pass that
// takes seconds and competes with the 60s poller for the switch's single SSH
// session, so flipping between devices must never silently re-run it or throw
// the previous result away. Switching back shows what we last saw, stamped with
// how old it is. Nothing is ever blanked just because a refresh is in flight —
// stale data plus an honest "as of" beats an empty screen.
//
// EXPECT EMPTY SPEED/DUPLEX/PoE ON LAB SWITCHES: Cisco IOL is virtual. It never
// negotiates a link and has no PoE hardware, so those read "—". That is the
// truth, not a parse failure. The real TP-Link fills them in.

function fmtAgo(iso) {
  if (!iso) return 'never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 5)     return 'just now';
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// A device is only healthy once a poll has SUCCEEDED. last_seen is stamped on
// metadata write, so null means "never got data" even with zero failures —
// exactly what a missing-credentials device looks like, because the poller
// early-returns there without recording a failure.
function deviceState(d) {
  if (d.last_error) return { label: 'Offline',  cls: styles.switchStatusOff };
  if (!d.enabled)   return { label: 'Disabled', cls: styles.switchStatusOff };
  if (!d.last_seen) return { label: 'No data',  cls: styles.switchStatusOff };
  return { label: 'Live', cls: styles.switchStatusOk };
}

function operClass(oper) {
  if (oper === 'up')   return styles.up;
  if (oper === 'down') return styles.down;
  return styles.unknown;
}

// parseInterfaceStatus returns { up: boolean, statusRaw: string, ... } — there
// is no `link`/`status` field. Reading those made every port render "—".
function linkOf(s) {
  if (!s || s.up === undefined) return null;
  return s.up ? 'up' : 'down';
}

const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

function Card({ title, count, right, children }) {
  return (
    <section className={styles.card} style={{ marginBottom: 14 }}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          {title}
          {count !== undefined && <span className={styles.muted}>({count})</span>}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// Identity fields vary wildly in length — a MAC, a 32-char IOL image name, a
// firmware string. The shared kvRow is a rigid `160px 1fr` grid, so long values
// overflowed their cell and collided with the next field's label (the live
// "192.168.1.VENDOR" / mangled-firmware bug). Stack label over value instead,
// and let the value wrap, so nothing can ever overlap regardless of length.
const kvTile = {
  display: 'flex', flexDirection: 'column', gap: 2,
  padding: '8px 12px', minWidth: 0,
  borderBottom: '1px solid rgba(128,128,128,.14)',
};
const kvValueStyle = {
  fontWeight: 600, minWidth: 0,
  overflowWrap: 'anywhere', wordBreak: 'break-word',
};

function KV({ label, value, mono }) {
  return (
    <div style={kvTile}>
      <span className={styles.kvLabel}>{label}</span>
      <span className={mono ? styles.kvMono : undefined} style={kvValueStyle}>{dash(value)}</span>
    </div>
  );
}

export default function LabPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';

  const [devices, setDevices] = useState([]);
  const [loadErr, setLoadErr] = useState(null);
  const [selectedId, setSelected] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [, forceRender] = useState(0);

  // deviceId -> { data, at, error }. A ref, not state: it must survive device
  // switches without re-triggering the effects that would refetch.
  const auditsRef = useRef(new Map());
  const bump = () => forceRender((n) => n + 1);

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
        // Keep whatever list we already have — a blip shouldn't empty the page.
        if (!cancelled) setLoadErr(err.message);
      }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isOwner]);

  // Re-render on a timer so the "as of" ages visibly without refetching.
  useEffect(() => { const t = setInterval(bump, 10_000); return () => clearInterval(t); }, []);

  // The poller skips disabled devices entirely, and nothing in the UI could
  // re-enable one — the TP-Link sat Disabled for days with no way to notice why
  // or fix it without hand-editing SQLite. PATCH /api/lab/devices/:id exists;
  // this just reaches it.
  const toggleEnabled = async (d) => {
    try {
      const r = await authFetch(apiUrl(`/api/lab/devices/${d.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !d.enabled }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { device } = await r.json();
      setDevices((list) => list.map((x) => (x.id === device.id ? { ...x, ...device } : x)));
    } catch (err) {
      setLoadErr(`Could not ${d.enabled ? 'disable' : 'enable'} ${d.display_name}: ${err.message}`);
    }
  };

  const runAudit = async (id) => {
    if (!id || busyId) return;
    setBusyId(id);
    try {
      const r = await authFetch(apiUrl(`/api/lab/devices/${id}/audit`), { method: 'POST' });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      auditsRef.current.set(id, { data, at: new Date().toISOString(), error: null });
    } catch (err) {
      // Preserve the previous audit — an error annotates it, never erases it.
      const prev = auditsRef.current.get(id);
      auditsRef.current.set(id, { data: prev?.data || null, at: prev?.at || null, error: err.message });
    } finally {
      setBusyId(null);
      bump();
    }
  };

  if (!isOwner) {
    return (
      <div className={styles.page}>
        <main className={styles.main}><p className={styles.muted}>Restricted to platform owners.</p></main>
      </div>
    );
  }

  const selected = devices.find((d) => d.id === selectedId) || null;
  const entry = selectedId ? auditsRef.current.get(selectedId) : null;
  const audit = entry?.data || null;
  const busy = busyId === selectedId;

  const ifstatus  = audit?.ifstatus || {};
  const ifconfig  = audit?.ifconfig || {};
  const poePorts  = audit?.poe?.ports || {};
  const neighbors = audit?.neighbors || {};
  const ports = Object.keys(ifstatus).length ? Object.keys(ifstatus) : Object.keys(ifconfig);
  const macRows = Object.entries(audit?.macs || {})
    .flatMap(([port, e]) => (e?.macs || []).map((mac) => ({ port, mac, vlan: e.vlan })));

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
        {loadErr && <p className={styles.errorLine}>Device list stale — {loadErr}</p>}

        {/* Device switcher. Purpose-built selectable tiles — NOT the detailTab
            underline-tab class, which is a single-line uppercase tab and mangled
            this multi-line card into a misaligned grey box. Each tile keeps its
            own cached audit, so switching never loses what you were looking at. */}
        <div role="tablist" aria-label="Lab devices"
             style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          {devices.map((d) => {
            const st = deviceState(d);
            const active = d.id === selectedId;
            const cached = auditsRef.current.get(d.id);
            return (
              <button key={d.id} role="tab" aria-selected={active}
                      onClick={() => setSelected(d.id)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                        minWidth: 150, padding: '10px 14px', borderRadius: 12, cursor: 'pointer',
                        font: 'inherit', textAlign: 'left', background: 'transparent',
                        border: '1px solid rgba(128,128,128,.28)',
                        outline: active ? '2px solid currentColor' : 'none',
                        outlineOffset: -1,
                      }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{d.display_name}</span>
                <span className={styles.muted} style={{ fontSize: 11 }}>{d.host}</span>
                <span className={`${styles.switchStatus} ${st.cls}`}>
                  <span className={styles.switchStatusDot} />
                  {busyId === d.id ? 'Connecting…' : st.label}
                </span>
                {cached?.data && (
                  <span className={styles.muted} style={{ fontSize: 10 }}>audit {fmtAgo(cached.at)}</span>
                )}
              </button>
            );
          })}
          {!devices.length && !loadErr && <p className={styles.muted}>No lab devices registered.</p>}
        </div>

        {selected && (
          <div className={styles.switchHero} style={{ marginBottom: 14 }}>
            {/* Plain flex row, NOT switchHeroRow — that class is a `44px 1fr auto`
                grid whose first column expects a device icon. With no icon the
                name/subtitle got crushed into 44px (the live "192.168 / · cisc…"
                wrap) and the buttons ballooned to fill 1fr. */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div className={styles.switchHeroName}>{selected.display_name}</div>
                <div className={styles.switchHeroSub}>
                  {selected.host} · {selected.vendor} · polled {fmtAgo(selected.last_seen)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button className={styles.ghostBtn} onClick={() => toggleEnabled(selected)}>
                  {selected.enabled ? 'Disable polling' : 'Enable polling'}
                </button>
                <button className={styles.ghostBtn} disabled={busy || !selected.enabled}
                        title={!selected.enabled ? 'Polling is disabled for this device' : undefined}
                        onClick={() => runAudit(selectedId)}>
                  {busy ? 'Connecting…' : audit ? 'Refresh audit' : 'Run full audit'}
                </button>
              </div>
            </div>

            {!selected.enabled && (
              <p className={styles.errorLine} style={{ marginTop: 10 }}>
                Polling is disabled — the poller skips this device entirely, so its data will go
                stale and no drift is recorded. Enable it to resume.
              </p>
            )}

            {selected.last_error && (
              <p className={styles.errorLine} style={{ marginTop: 10 }}>
                Poller can’t reach it ({selected.consecutive_failures} attempts): <code>{selected.last_error}</code>
              </p>
            )}
            {entry?.error && (
              <p className={styles.errorLine} style={{ marginTop: 10 }}>
                Last audit failed — {entry.error}
                {audit && ' · showing the previous result below'}
              </p>
            )}
            {audit && (
              <p className={styles.muted} style={{ marginTop: 10, fontSize: 11 }}>
                {busy ? 'Refreshing…' : `Audit as of ${fmtAgo(entry.at)}`} · live SSH pass, not polled
              </p>
            )}
          </div>
        )}

        {!audit && !busy && selected && (
          <Card title="No audit yet">
            <p className={styles.muted} style={{ margin: 0 }}>
              Hit <strong>Run full audit</strong> for identity, ports, PoE, VLANs, LLDP and the MAC
              table. It opens a live SSH session, so it runs on demand rather than on a timer —
              these switches allow only one session and the poller is already using it.
            </p>
          </Card>
        )}

        {audit && (
          <>
            <Card title="Identity">
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                border: '1px solid rgba(128,128,128,.2)', borderRadius: 10, overflow: 'hidden',
              }}>
                <KV label="Name"     value={audit.identity?.name} />
                <KV label="Model"    value={audit.identity?.model} />
                <KV label="Serial"   value={audit.identity?.serial} mono />
                <KV label="MAC"      value={audit.identity?.mac} mono />
                <KV label="Firmware" value={audit.identity?.firmware} />
                <KV label="Hardware" value={audit.identity?.hardware} />
                <KV label="Host"     value={audit.host} mono />
                <KV label="Vendor"   value={audit.vendor} />
              </div>
            </Card>

            <Card title="Ports" count={ports.length}
                  right={<span className={styles.legend}>
                    <span className={`${styles.dot} ${styles.up}`} /> up
                    <span className={`${styles.dot} ${styles.down}`} /> down
                  </span>}>
              {/* Faceplate first — the shape of the switch at a glance. */}
              <div className={styles.portGrid} style={{ marginBottom: 12 }}>
                {ports.map((p) => {
                  const l = linkOf(ifstatus[p]);
                  return (
                    <div key={p} className={`${styles.portCell} ${l === 'up' ? styles.up : l === 'down' ? styles.down : styles.unknown}`}
                         title={`${p} — ${dash(l)}`}>
                      <span className={styles.portName}>{p}</span>
                    </div>
                  );
                })}
              </div>
              <div className={styles.offsetTableWrap}>
                <table className={styles.offsetTable}>
                  <thead><tr>
                    {['Port', 'Link', 'Admin', 'Speed', 'Duplex', 'Type', 'PoE (W)', 'Description', 'Neighbour'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {ports.map((p) => {
                      const s = ifstatus[p] || {}, c = ifconfig[p] || {};
                      const pe = poePorts[p] || {}, n = neighbors[p] || {};
                      const l = linkOf(s);
                      return (
                        <tr key={p}>
                          <td style={{ padding: '6px 10px' }} className={styles.kvMono}>{p}</td>
                          <td style={{ padding: '6px 10px' }}><span className={operClass(l)}>{dash(l)}</span></td>
                          <td style={{ padding: '6px 10px' }}>{c.enabled === undefined ? '—' : (c.enabled ? 'enabled' : 'disabled')}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(s.speed)}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(s.duplex)}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(s.medium)}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(pe.power)}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(c.description)}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(n.system_name || n.chassis_id)}</td>
                        </tr>
                      );
                    })}
                    {!ports.length && <tr><td colSpan={9} style={{ padding: 10 }} className={styles.muted}>No ports returned.</td></tr>}
                  </tbody>
                </table>
              </div>
              {audit.poe?.budget != null && (
                <p className={styles.muted} style={{ marginTop: 8, fontSize: 11 }}>
                  PoE budget {audit.poe.budget}W · used {audit.poe.used ?? 0}W
                </p>
              )}
            </Card>

            <Card title="VLANs" count={audit.vlans?.length || 0}>
              {audit.vlans?.length ? (
                <div className={styles.offsetTableWrap}>
                  <table className={styles.offsetTable}>
                    <thead><tr>{['VLAN', 'Name', 'Status', 'Ports'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>{h}</th>))}</tr></thead>
                    <tbody>
                      {audit.vlans.map((v) => (
                        <tr key={v.id}>
                          <td style={{ padding: '6px 10px' }} className={styles.kvMono}>{v.id}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(v.name)}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(v.status)}</td>
                          <td style={{ padding: '6px 10px' }}>
                            {(v.ports || []).map((p) => (typeof p === 'string' ? p : `${p.port}${p.tagged ? ' (T)' : ''}`)).join(', ') || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.muted} style={{ margin: 0 }}>
                  None. Expected on CoreSW — it runs the L3 IOL image, where interfaces are routed
                  and there are no switchports to put in a VLAN.
                </p>
              )}
            </Card>

            <Card title="LLDP neighbours" count={Object.keys(neighbors).length}>
              {Object.keys(neighbors).length ? (
                <div className={styles.offsetTableWrap}>
                  <table className={styles.offsetTable}>
                    <thead><tr>{['Local port', 'System', 'Chassis', 'Remote port'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>{h}</th>))}</tr></thead>
                    <tbody>
                      {Object.entries(neighbors).map(([p, n]) => (
                        <tr key={p}>
                          <td style={{ padding: '6px 10px' }} className={styles.kvMono}>{p}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(n.system_name)}</td>
                          <td style={{ padding: '6px 10px' }} >{dash(n.chassis_id)}</td>
                          <td style={{ padding: '6px 10px' }} className={styles.kvMono}>{dash(n.port_id)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.muted} style={{ margin: 0 }}>
                  None. IOS needs <code>lldp run</code> globally, and the IOL l2-ipbase image may not
                  support LLDP at all — Cisco defaults to CDP.
                </p>
              )}
            </Card>

            <Card title="MAC table" count={macRows.length}>
              {macRows.length ? (
                <div className={styles.offsetTableWrap}>
                  <table className={styles.offsetTable}>
                    <thead><tr>{['Port', 'MAC', 'VLAN'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>{h}</th>))}</tr></thead>
                    <tbody>
                      {macRows.map((m, i) => (
                        <tr key={`${m.port}-${m.mac}-${i}`}>
                          <td style={{ padding: '6px 10px' }} className={styles.kvMono}>{m.port}</td>
                          <td style={{ padding: '6px 10px' }} className={styles.kvMono}>{dash(m.mac)}</td>
                          <td style={{ padding: '6px 10px' }}>{dash(m.vlan)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={styles.muted} style={{ margin: 0 }}>No MAC entries returned.</p>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
