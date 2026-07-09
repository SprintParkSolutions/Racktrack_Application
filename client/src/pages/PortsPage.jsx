import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import {
  subscribeProbe,
  triggerBackgroundProbe,
  logicalVerdict,
} from '../utils/portsProbe';
import RackTabs from '../components/RackTabs.jsx';
import styles from './PortsPage.module.css';

function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  return `${(ms / 1000).toFixed(2)} s`;
}

// ── Port classification ─────────────────────────────────────
function classifyPorts(probePorts, scan) {
  if (!probePorts?.length) return { rj45: [], sfp: [] };

  // Best signal: the switch told us the medium (TP-Link Active-Medium column)
  const hasMedium = probePorts.some(p => p.medium === 'fiber' || p.medium === 'copper');
  if (hasMedium) {
    const rj45 = [], sfp = [];
    for (const p of probePorts) {
      if (p.medium === 'fiber') sfp.push(p);
      else rj45.push(p);
    }
    return { rj45, sfp };
  }

  // Cisco-style: classify by interface prefix
  const hasCiscoNames = probePorts.some(p =>
    /^(Gi|Fa|Te|Fo|Hu)/i.test(p.iface)
  );
  if (hasCiscoNames) {
    const rj45 = [], sfp = [];
    for (const p of probePorts) {
      if (/^(Te|Fo|Hu)/i.test(p.iface)) sfp.push(p);
      else rj45.push(p);
    }
    return { rj45, sfp };
  }

  // Fallback: use scan data's CV-detected port_count to find split point
  const switchDev = scan?.devices?.find(d =>
    d.class_name === 'Switch' && d.port_count > 0
  );
  const cvMainCount = switchDev?.port_count || 0;
  const cvSfpCount = switchDev?.sfp_ports?.length || 0;
  const total = probePorts.length;

  let splitAt;
  if (cvMainCount > 0 && cvMainCount < total) {
    splitAt = cvMainCount;
  } else if (cvSfpCount > 0 && (total - cvSfpCount) > 0) {
    splitAt = total - cvSfpCount;
  } else if (total > 24) {
    splitAt = total - 4;
  } else if (total > 8) {
    splitAt = total - 2;
  } else {
    splitAt = total;
  }

  return {
    rj45: probePorts.slice(0, splitAt),
    sfp: probePorts.slice(splitAt),
  };
}

function shortLabel(iface) {
  const tpMatch = iface.match(/^1\/0\/(\d+)$/);
  if (tpMatch) return tpMatch[1];
  const ciscoMatch = iface.match(/^[A-Za-z]{1,2}\d+\/\d+\/(\d+)$/);
  if (ciscoMatch) return ciscoMatch[1];
  const nums = iface.match(/(\d+)$/);
  return nums ? nums[1] : iface;
}

function countByVerdict(portList) {
  let avail = 0, used = 0, reserved = 0;
  for (const p of portList) {
    const v = logicalVerdict(p);
    if (v === 'available') avail++;
    else if (v === 'used') used++;
    else reserved++;
  }
  return { avail, used, reserved };
}

// ── Ports summary card ───────────────────────────────────────
function PortsSummaryCard({ totalPorts, sfpCount, availableCount, availablePorts, sfpPortIfaces }) {
  const [showTable, setShowTable] = useState(false);

  // Breakdown so the card can show ETH vs SFP availability at a glance
  // — a single "5 ports free" doesn't tell you whether you can plug in
  // an SFP+ uplink.
  const availSfp = availablePorts.filter(p => sfpPortIfaces.has(p.iface)).length;
  const availEth = availableCount - availSfp;
  const usedCount = Math.max(0, totalPorts - availableCount);
  const utilizationPct = totalPorts > 0
    ? Math.round((usedCount / totalPorts) * 100)
    : 0;
  const hasAny = availableCount > 0;

  return (
    <section className={styles.summaryCard}>
      <div className={styles.summaryHero}>
        {/* Big count badge */}
        <div className={`${styles.heroBadge} ${hasAny ? '' : styles.heroBadgeEmpty}`}>
          <span className={styles.heroCount}>{availableCount}</span>
          <span className={styles.heroOf}>of {totalPorts}</span>
        </div>

        {/* Label + breakdown chips */}
        <div className={styles.heroBody}>
          <span className={styles.heroLabel}>Available ports</span>
          <div className={styles.heroChips}>
            <span className={`${styles.heroChip} ${styles.heroChipEth}`}>
              <span className={styles.heroChipDot} />
              <span className={styles.heroChipNum}>{availEth}</span>
              <span className={styles.heroChipLabel}>ETH</span>
            </span>
            {sfpCount > 0 && (
              <span className={`${styles.heroChip} ${styles.heroChipSfp}`}>
                <span className={styles.heroChipDot} />
                <span className={styles.heroChipNum}>{availSfp}</span>
                <span className={styles.heroChipLabel}>SFP</span>
              </span>
            )}
            <span className={styles.heroUsed}>· {usedCount} in use</span>
          </div>
        </div>

        {/* Toggle to show full list */}
        {hasAny && (
          <button
            type="button"
            className={`${styles.summaryInlineToggle} ${showTable ? styles.summaryInlineToggleOpen : ''}`}
            onClick={() => setShowTable(v => !v)}
            aria-label={showTable ? 'Hide port list' : 'Show port list'}
            aria-expanded={showTable}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showTable ? 'rotate(180deg)' : 'none', transition: 'transform .2s ease' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Utilization bar — visual context for "how full is this switch" */}
      {totalPorts > 0 && (
        <div className={styles.utilWrap} role="img" aria-label={`${utilizationPct}% utilized`}>
          <div className={styles.utilBar}>
            <div
              className={styles.utilFill}
              style={{ width: `${utilizationPct}%` }}
            />
          </div>
          <span className={styles.utilPct}>{utilizationPct}%</span>
        </div>
      )}

      {/* Available ports table — only shown when toggled */}
      {showTable && (
        availableCount === 0
          ? <div className={styles.summaryNone}>None available</div>
          : (
            <div className={styles.portTable}>
              <div className={styles.portTableHead}>
                <span>Port</span>
                <span>Type</span>
                <span>Interface</span>
                <span>Status</span>
              </div>
              {availablePorts.map((p, i) => {
                const isSfp = sfpPortIfaces.has(p.iface);
                return (
                  <div key={p.iface} className={`${styles.portTableRow} ${i % 2 === 1 ? styles.portTableRowAlt : ''}`}>
                    <span className={styles.portTableNum}>{shortLabel(p.iface)}</span>
                    <span className={`${styles.portTableType} ${isSfp ? styles.portTableTypeSfp : styles.portTableTypeEth}`}>
                      {isSfp ? 'SFP' : 'ETH'}
                    </span>
                    <span className={styles.portTableIface}>{p.iface}</span>
                    <span className={styles.portTableStatus}>Available</span>
                  </div>
                );
              })}
            </div>
          )
      )}
    </section>
  );
}

// ── Embeddable content (used as a tab in ResultsPage) ────────
export function PortsContent({ rackId }) {
  const [scan, setScan] = useState(null);
  const [scanErr, setScanErr] = useState(null);

  const [probe, setProbe] = useState({ status: 'idle' });
  useEffect(() => subscribeProbe(setProbe), []);
  useEffect(() => {
    triggerBackgroundProbe();
  }, []);

  useEffect(() => {
    if (!rackId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch(apiUrl(`/api/scan/${rackId}/result`));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!cancelled) setScan(data);
      } catch (err) {
        if (!cancelled) setScanErr(err.message || 'Failed to load scan');
      }
    })();
    return () => { cancelled = true; };
  }, [rackId]);

  if (scanErr) return <div className={styles.error}>Failed to load scan: {scanErr}</div>;
  if (!scan) return <div className={styles.loading}>Loading rack...</div>;

  return <LogicalView probe={probe} scan={scan} scanDurationMs={null} />;
}

// ── Standalone page (used by /results/:rackId/ports route) ───
export default function PortsPage() {
  const { rackId } = useParams();
  const navigate = useNavigate();
  const { state } = useLocation();

  const [scan, setScan] = useState(null);
  const [scanErr, setScanErr] = useState(null);

  const scanDurationMs = state?.result?.timings?.total_ms ?? null;

  const [probe, setProbe] = useState({ status: 'idle' });
  useEffect(() => subscribeProbe(setProbe), []);
  useEffect(() => {
    triggerBackgroundProbe();
  }, []);

  useEffect(() => {
    if (!rackId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch(apiUrl(`/api/scan/${rackId}/result`));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!cancelled) setScan(data);
      } catch (err) {
        if (!cancelled) setScanErr(err.message || 'Failed to load scan');
      }
    })();
    return () => { cancelled = true; };
  }, [rackId]);

  if (scanErr) {
    return (
      <div className={styles.page}>
        <PageHeader rackId={rackId} onBack={() => navigate(-1)} />
        <div className={styles.error}>Failed to load scan: {scanErr}</div>
      </div>
    );
  }
  if (!scan) {
    return (
      <div className={styles.page}>
        <PageHeader rackId={rackId} onBack={() => navigate(-1)} />
        <div className={styles.loading}>Loading rack...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader rackId={rackId} onBack={() => navigate(-1)} />
      <LogicalView probe={probe} scan={scan} scanDurationMs={scanDurationMs} />
    </div>
  );
}

// ── Header ───────────────────────────────────────────────────
function PageHeader({ rackId, onBack }) {
  return (
    <>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>← Back</button>
        <div className={styles.headerCenter}>
          <h2>Available Ports</h2>
          <span className={styles.headerMono}>{rackId}</span>
        </div>
        <div style={{ width: 64 }} />
      </header>
      {/* Renders nothing when this rack is standalone */}
      <RackTabs rackId={rackId} />
    </>
  );
}

// ── Filter chip ──────────────────────────────────────────────
function FilterChip({ active, onClick, label, count, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
    >
      {color && <span className={styles.filterChipDot} style={{ background: color }} />}
      <span>{label}</span>
      <span className={styles.filterChipCount}>{count}</span>
    </button>
  );
}

// ── Port tile ────────────────────────────────────────────────
function PortTile({ port, onClick }) {
  const verdict = logicalVerdict(port);
  const label = shortLabel(port.iface);
  return (
    <button
      type="button"
      className={`${styles.portTile} ${styles[`tile_${verdict}`]}`}
      onClick={onClick}
      title={port.iface}
    >
      <span className={styles.tileLabel}>{label}</span>
    </button>
  );
}

// ── Port detail popover ──────────────────────────────────────
function PortDetail({ port, onClose }) {
  const verdict = logicalVerdict(port);
  const verdictLabel = verdict.charAt(0).toUpperCase() + verdict.slice(1);
  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailCard} onClick={e => e.stopPropagation()}>
        <div className={styles.detailHeader}>
          <span className={`${styles.detailStatus} ${styles[`detail_${verdict}`]}`}>
            {verdictLabel}
          </span>
          <button className={styles.detailClose} onClick={onClose}>&times;</button>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Interface</span>
          <span className={styles.detailVal}>{port.iface}</span>
        </div>
        <div className={styles.detailRow}>
          <span className={styles.detailKey}>Status</span>
          <span className={styles.detailVal}>{port.status || '\u2014'}</span>
        </div>
        {port.description && (
          <div className={styles.detailRow}>
            <span className={styles.detailKey}>Description</span>
            <span className={styles.detailVal}>{port.description}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Logical view ─────────────────────────────────────────────
function LogicalView({ probe, scan, scanDurationMs }) {
  const [filter, setFilter] = useState('all');

  if (probe.status === 'running' || probe.status === 'idle') {
    return <OrbitalLoader startedAt={probe.startedAt} />;
  }
  if (probe.status === 'error') {
    return (
      <div className={styles.errorBox}>
        <span>Probe failed: {probe.error}</span>
        <button className={styles.retryBtn} onClick={() => triggerBackgroundProbe({ force: true })}>Retry</button>
      </div>
    );
  }

  const ports = Array.isArray(probe.ports) ? probe.ports : [];
  const { rj45, sfp } = classifyPorts(ports, scan);
  const sfpPortIfaces = new Set(sfp.map(p => p.iface));

  const verdicts = ports.map(p => ({ p, v: logicalVerdict(p) }));
  const counts = {
    all:       ports.length,
    available: verdicts.filter(x => x.v === 'available').length,
    used:      verdicts.filter(x => x.v === 'used').length,
    reserved:  verdicts.filter(x => x.v === 'reserved').length,
  };

  const filtered = filter === 'all'
    ? ports
    : ports.filter(p => logicalVerdict(p) === filter);

  const ethFiltered = filtered.filter(p => !sfpPortIfaces.has(p.iface));
  const sfpFiltered = filtered.filter(p =>  sfpPortIfaces.has(p.iface));

  return (
    <div className={styles.invWrap}>
      <header className={styles.invHead}>
        <h2 className={styles.invTitle}>Ports Inventory</h2>
        <p className={styles.invSub}>
          {counts.available} available · {counts.used} in use · {counts.all} total
        </p>
      </header>

      <div className={styles.invFilters}>
        <FilterPill label="All Ports"  count={counts.all}       active={filter === 'all'}       onClick={() => setFilter('all')} />
        <FilterPill label="Available"  count={counts.available} active={filter === 'available'} onClick={() => setFilter('available')} />
        <FilterPill label="In Use"     count={counts.used}      active={filter === 'used'}      onClick={() => setFilter('used')} />
        <FilterPill label="Errors"     count={counts.reserved}  active={filter === 'reserved'}  onClick={() => setFilter('reserved')} />
      </div>

      {ethFiltered.length > 0 && (
        <PortGroup
          title="Ethernet (ETH) Modules"
          ports={ethFiltered}
          variant="eth"
        />
      )}

      {sfpFiltered.length > 0 && (
        <PortGroup
          title="SFP Modules"
          ports={sfpFiltered}
          variant="sfp"
        />
      )}

      {ethFiltered.length === 0 && sfpFiltered.length === 0 && (
        <div className={styles.invEmpty}>No ports match this filter.</div>
      )}
    </div>
  );
}

// ── Filter pill ──────────────────────────────────────────────
function FilterPill({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.invPill} ${active ? styles.invPillActive : ''}`}
    >
      <span>{label}</span>
      <span className={styles.invPillCount}>{count}</span>
    </button>
  );
}

// ── Port group (ETH / SFP section) ───────────────────────────
function PortGroup({ title, ports, variant }) {
  return (
    <section className={styles.invSection}>
      <div className={styles.invSectionHead}>
        <h3 className={styles.invSectionTitle}>{title}</h3>
        <span className={styles.invSectionCount}>
          {ports.length} {ports.length === 1 ? 'PORT' : 'PORTS'}
        </span>
      </div>
      <div className={styles.invCardGrid}>
        {ports.map(p => <PortCard key={p.iface} port={p} variant={variant} />)}
      </div>
    </section>
  );
}

// ── Port row — 3-column detail layout with left accent ───────
function PortCard({ port, variant }) {
  const verdict     = logicalVerdict(port);
  const accentClass = verdict === 'available' ? styles.invAccentAvail
                    : verdict === 'used'      ? styles.invAccentUsed
                    :                            styles.invAccentErr;
  const statusClass = verdict === 'available' ? styles.invStatusAvail
                    : verdict === 'used'      ? styles.invStatusUsed
                    :                            styles.invStatusErr;
  const verdictLabel =
      verdict === 'available' ? 'Available'
    : verdict === 'used'      ? 'In use'
    :                            'Reserved';

  // Raw status text from the switch — e.g. "connected", "notconnect",
  // "err-disabled". Title-cased for display, falls back to the verdict.
  const statusRaw  = (port.status || '').trim();
  const statusText = statusRaw
    ? statusRaw
        .replace(/notconnect/i, 'Not connected')
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase())
    : verdictLabel;

  const shortName  = shortLabel(port.iface).padStart(2, '0');
  const medium     = port.medium === 'fiber' ? 'Fiber'
                   : port.medium === 'copper' ? 'Copper'
                   : (variant === 'sfp' ? 'Fiber' : 'Copper');
  const desc = (port.description || '').trim();

  return (
    <article className={styles.invRow} title={`${port.iface} · ${verdictLabel}`}>
      <span className={`${styles.invAccent} ${accentClass}`} aria-hidden="true" />

      {/* Left — port number + interface */}
      <div className={styles.invRowLeft}>
        <span className={styles.invRowNum}>{shortName}</span>
        <span className={styles.invRowIface}>{port.iface}</span>
      </div>

      {/* Center — human-readable description */}
      <div className={styles.invRowMid}>
        <span className={styles.invRowDesc}>{desc || '—'}</span>
        <span className={styles.invRowMedium}>{medium}</span>
      </div>

      {/* Right — status text + verdict label */}
      <div className={styles.invRowRight}>
        <span className={`${styles.invRowStatus} ${statusClass}`}>{statusText}</span>
        <span className={styles.invRowVerdict}>{verdictLabel}</span>
      </div>
    </article>
  );
}

// ── Orbital loader ───────────────────────────────────────────
function OrbitalLoader({ startedAt }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <div className={styles.orbitalWrap}>
      <div className={styles.orbital}>
        <span className={styles.orbitalRing} />
        <span className={styles.orbitalRing} />
        <span className={styles.orbitalCore} />
      </div>
      <div className={styles.orbitalLabel}>
        Loading<span className={styles.dotPulse}>.</span><span className={styles.dotPulse}>.</span><span className={styles.dotPulse}>.</span>
      </div>
      {startedAt && <div className={styles.orbitalElapsed}>{elapsed}s</div>}
    </div>
  );
}
