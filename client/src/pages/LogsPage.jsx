import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, authFetch } from '../utils/api';
import styles from './LogsPage.module.css';

// Levels the server persists, lowest→highest. Picking one filters to that
// level *and above* (warn also shows error + fatal), matching how you triage.
const LEVELS = [
  { key: '',      label: 'All' },
  { key: 'info',  label: 'Info' },
  { key: 'warn',  label: 'Warnings' },
  { key: 'error', label: 'Errors' },
];

const LEVEL_TONE = {
  trace: 'trace', debug: 'debug', info: 'info',
  warn: 'warn', error: 'error', fatal: 'fatal',
};

// Server stamps ISO-8601 (pino isoTime). Render local time + relative age.
function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}
function relTime(ts) {
  const d = parseTs(ts);
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function clockTime(ts) {
  const d = parseTs(ts);
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function StatTile({ label, value, tone }) {
  return (
    <div className={`${styles.tile} ${tone ? styles[`tile_${tone}`] : ''}`}>
      <div className={styles.tileValue}>{value ?? 0}</div>
      <div className={styles.tileLabel}>{label}</div>
    </div>
  );
}

function LogRow({ row, expanded, onToggle }) {
  const tone = LEVEL_TONE[row.level_label] || 'info';
  const http = row.method && row.url;
  return (
    <>
      <tr className={`${styles.row} ${styles[`row_${tone}`]}`} onClick={onToggle}>
        <td className={styles.cTime} title={row.ts}>
          <span className={styles.clock}>{clockTime(row.ts)}</span>
          <span className={styles.rel}>{relTime(row.ts)}</span>
        </td>
        <td className={styles.cLevel}>
          <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>{row.level_label}</span>
        </td>
        <td className={styles.cMsg}>
          <span className={styles.msg}>{row.msg || row.event || '(no message)'}</span>
          {http && (
            <span className={styles.httpMeta}>
              {row.method} {shorten(row.url)} {row.status ? `→ ${row.status}` : ''}
              {row.duration_ms != null ? ` · ${Math.round(row.duration_ms)}ms` : ''}
            </span>
          )}
          {row.err && <span className={styles.errText}>{row.err}</span>}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailRow}>
          <td colSpan={3}>
            <LogDetail id={row.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function shorten(url = '', max = 48) {
  return url.length > max ? url.slice(0, max) + '…' : url;
}

// Lazily fetch the full JSON line only when a row is expanded.
function LogDetail({ id }) {
  const [full, setFull] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch(apiUrl(`/api/logs/${id}`));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (alive) setFull(json.log);
      } catch (e) { if (alive) setErr(e.message); }
    })();
    return () => { alive = false; };
  }, [id]);
  if (err) return <div className={styles.detailErr}>Couldn’t load detail: {err}</div>;
  if (!full) return <div className={styles.detailLoading}>Loading…</div>;
  const pretty = full.metaParsed
    ? JSON.stringify(full.metaParsed, null, 2)
    : (full.meta || '');
  return (
    <div className={styles.detail}>
      {full.request_id && <div className={styles.detailMeta}>request&nbsp;id: <code>{full.request_id}</code></div>}
      <pre className={styles.pre}>{pretty}</pre>
    </div>
  );
}

// Embeddable logs view — the shared console (DashboardPage) owns the outer
// page chrome, the title, and the Live / Refresh controls, and drives this
// via the `live` and `refreshTick` props. Level filtering and search stay
// here because they are logs-specific.
export function LogsView({ live = true, refreshTick = 0 }) {
  const [logs, setLogs]       = useState([]);
  const [stats, setStats]     = useState(null);
  const [total, setTotal]     = useState(0);
  const [level, setLevel]     = useState('');
  const [q, setQ]             = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [, setTick]           = useState(0);

  const liveRef = useRef(live);   liveRef.current = live;
  const levelRef = useRef(level); levelRef.current = level;
  const qRef = useRef(q);         qRef.current = q;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '300' });
      if (levelRef.current) params.set('level', levelRef.current);
      if (qRef.current)     params.set('q', qRef.current);
      const [logsRes, statsRes] = await Promise.all([
        authFetch(apiUrl(`/api/logs?${params}`)),
        authFetch(apiUrl('/api/logs/stats')),
      ]);
      if (logsRes.status === 403) { setError('Admin access required to view logs.'); setLoading(false); return; }
      if (!logsRes.ok) throw new Error(`HTTP ${logsRes.status}`);
      const json = await logsRes.json();
      setLogs(json.logs || []);
      setTotal(json.total || 0);
      if (statsRes.ok) setStats(await statsRes.json());
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // Reload immediately when the level or committed search changes.
  useEffect(() => { load(); }, [level, q, load]);
  // Reload when the console's Refresh button is pressed.
  useEffect(() => { if (refreshTick) load(); }, [refreshTick, load]);
  // Poll every 4s while live.
  useEffect(() => {
    const id = setInterval(() => { if (liveRef.current) load(); }, 4000);
    return () => clearInterval(id);
  }, [load]);
  // Keep relative times fresh.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const submitSearch = (e) => { e.preventDefault(); setQ(queryInput.trim()); };
  const clearSearch = () => { setQueryInput(''); setQ(''); };

  // Wipe every stored log line. Destructive and not undoable, so confirm first.
  const clearLogs = async () => {
    const n = stats?.total ?? logs.length;
    if (!window.confirm(`Delete all ${n} stored log entries and start fresh?\n\nThis cannot be undone.`)) return;
    setClearing(true);
    try {
      const res = await authFetch(apiUrl('/api/logs/clear'), { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e.message || 'Could not clear the log');
    } finally {
      setClearing(false);
    }
  };

  const byLevel = stats?.byLevel || {};

  if (loading) {
    return <div className={styles.center}>Loading logs…</div>;
  }
  if (error && !logs.length) {
    return <div className={styles.center}>{error}</div>;
  }

  return (
    <div className={styles.logsWrap}>
      <div className={styles.tiles}>
        <StatTile label="Total kept" value={stats?.total} />
        <StatTile label="Info"  value={byLevel.info}  tone="info" />
        <StatTile label="Warn"  value={byLevel.warn}  tone="warn" />
        <StatTile label="Error" value={(byLevel.error || 0) + (byLevel.fatal || 0)} tone="error" />
      </div>

      <div className={styles.controls}>
        <div className={styles.levelTabs}>
          {LEVELS.map(l => (
            <button
              key={l.key || 'all'}
              className={`${styles.levelTab} ${level === l.key ? styles.levelTabActive : ''}`}
              onClick={() => setLevel(l.key)}
            >{l.label}</button>
          ))}
        </div>
        <form className={styles.searchWrap} onSubmit={submitSearch}>
          <input
            className={styles.search}
            placeholder="Search messages, URLs, errors…"
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
          />
          {q && <button type="button" className={styles.clearBtn} onClick={clearSearch} aria-label="Clear the search box">✕</button>}
        </form>
      </div>

      <div className={styles.countLine}>
        <span>
          Showing {logs.length}{total > logs.length ? ` of ${total}` : ''} entries
          {q ? ` matching “${q}”` : ''}
          {stats?.retentionDays ? ` · kept ${stats.retentionDays} days` : ''}
        </span>
        <button
          type="button"
          className={styles.clearLogsBtn}
          disabled={clearing || !logs.length}
          onClick={clearLogs}
          title="Delete every stored log entry and start fresh"
        >
          {clearing ? 'Clearing…' : 'Clear log'}
        </button>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <tbody>
            {logs.length === 0 && (
              <tr><td className={styles.empty}>No log entries match.</td></tr>
            )}
            {logs.map(row => (
              <LogRow
                key={row.id}
                row={row}
                expanded={expanded === row.id}
                onToggle={() => setExpanded(x => x === row.id ? null : row.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
