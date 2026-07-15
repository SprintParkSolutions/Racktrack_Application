import { useEffect, useRef, useState, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/api';
import styles from './DashboardPage.module.css';

// A short, human label for each audit action so the feed reads in plain
// English instead of dotted machine keys.
const ACTION_LABELS = {
  'scan.create':            'Scanned a rack',
  'scan.select_port':       'Located a port',
  'scan.analyze_for_ticket':'Analyzed for ticket',
  'scan.share.outlook':     'Shared (Outlook)',
  'scan.share.teams':       'Shared (Teams)',
  'feedback.submit':        'Gave feedback',
  'console.run_manual':     'Ran console command',
  'incident.verify_rack':   'Verified rack (incident)',
  'auth.login':             'Signed in',
  'auth.signup.start':      'Started sign-up',
  'auth.signup.verify':     'Verified sign-up',
  'auth.resend':            'Resent verification',
  'auth.forgot_password.start':  'Requested reset',
  'auth.forgot_password.verify': 'Reset password',
  'invite.accept':          'Accepted invite',
  'member.create':          'Added a member',
  'member.update':          'Updated a member',
  'member.remove':          'Removed a member',
  'org.approve':            'Approved an org',
  'org.remove':             'Removed an org',
};

const labelFor = (a) => ACTION_LABELS[a] || a;

// audit_log timestamps are UTC "YYYY-MM-DD HH:MM:SS" (no zone) → parse as UTC.
function parseTs(ts) {
  if (!ts) return null;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function relTime(ts) {
  const d = parseTs(ts);
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 5)     return 'just now';
  if (s < 60)    return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60)    return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24)    return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

function StatCard({ label, value, sub, tone }) {
  return (
    <div className={`${styles.stat} ${tone ? styles[tone] : ''}`}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
      {sub != null && <div className={styles.statSub}>{sub}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [live,    setLive]    = useState(true);
  const [tick,    setTick]    = useState(0);   // re-render so "x ago" stays fresh
  const liveRef = useRef(live);
  liveRef.current = live;

  const load = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/admin/dashboard'));
      if (res.status === 403) { setError('Owner access required to view this dashboard.'); setLoading(false); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll every 5s while "live" is on.
  useEffect(() => {
    const id = setInterval(() => { if (liveRef.current) load(); }, 5000);
    return () => clearInterval(id);
  }, [load]);

  // Independent 1s tick keeps relative timestamps current between polls.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return <div className={styles.page}><div className={styles.center}>Loading dashboard…</div></div>;
  }
  if (error && !data) {
    return <div className={styles.page}><div className={styles.center}>{error}</div></div>;
  }

  const t  = data?.totals   || {};
  const fb = data?.feedback || {};

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Live Operations</h1>
          <p className={styles.subtitle}>
            Everything happening across RackTrack — who's scanning, what's working, what's failing.
          </p>
        </div>
        <div className={styles.headerRight}>
          <button
            className={`${styles.liveBtn} ${live ? styles.liveOn : ''}`}
            onClick={() => setLive(v => !v)}
            title={live ? 'Auto-refresh on (every 5s)' : 'Auto-refresh paused'}
          >
            <span className={styles.liveDot} />
            {live ? 'Live' : 'Paused'}
          </button>
          <button className={styles.refreshBtn} onClick={load}>Refresh</button>
        </div>
      </header>

      {/* Headline stats */}
      <section className={styles.stats}>
        <StatCard label="Scans today"      value={t.scansToday ?? 0} tone="accent" />
        <StatCard label="Active users today" value={t.activeToday ?? 0} />
        <StatCard label="Total scans"      value={t.scansOk ?? 0} sub={t.scansFail ? `${t.scansFail} failed` : null} />
        <StatCard label="Success rate"     value={t.successRate != null ? `${t.successRate}%` : '—'}
                  tone={t.successRate != null && t.successRate < 90 ? 'warn' : 'good'} />
        <StatCard label="Accuracy (feedback)" value={fb.accuracy != null ? `${fb.accuracy}%` : '—'}
                  sub={fb.right + fb.wrong ? `${fb.right} right · ${fb.wrong} wrong` : 'no feedback yet'}
                  tone={fb.accuracy != null && fb.accuracy < 80 ? 'warn' : 'good'} />
        <StatCard label="Users"            value={t.users ?? 0} />
        <StatCard label="Organizations"    value={t.orgs ?? 0} />
        <StatCard label="Failures (all)"   value={t.totalFails ?? 0} tone={t.totalFails ? 'warn' : undefined} />
      </section>

      <div className={styles.grid}>
        {/* Live activity feed */}
        <section className={`${styles.card} ${styles.feedCard}`}>
          <div className={styles.cardHead}>
            <h2>Live activity</h2>
            <span className={styles.cardMeta}>
              {data?.generatedAt ? `updated ${relTime(data.generatedAt)}` : ''}
            </span>
          </div>
          <div className={styles.feed}>
            {(data?.recent || []).map((e, i) => (
              <div key={i} className={styles.feedRow}>
                <span className={`${styles.statusPill} ${e.status === 'fail' ? styles.pillFail : styles.pillOk}`}>
                  {e.status === 'fail' ? 'fail' : 'ok'}
                </span>
                <div className={styles.feedBody}>
                  <div className={styles.feedLine}>
                    <span className={styles.feedUser}>{e.username || 'anonymous'}</span>
                    <span className={styles.feedAction}>{labelFor(e.action)}</span>
                    {e.org && <span className={styles.feedOrg}>{e.org}</span>}
                  </div>
                  {e.status === 'fail' && e.error && <div className={styles.feedError}>{e.error}</div>}
                  {e.target_id && e.status !== 'fail' && <div className={styles.feedTarget}>{e.target_id}</div>}
                </div>
                <span className={styles.feedTime}>{relTime(e.ts)}</span>
              </div>
            ))}
            {!(data?.recent || []).length && <div className={styles.empty}>No activity yet.</div>}
          </div>
        </section>

        <div className={styles.sideCol}>
          {/* Recent errors */}
          <section className={styles.card}>
            <div className={styles.cardHead}><h2>Recent errors</h2></div>
            <div className={styles.errorList}>
              {(data?.errors || []).map((e, i) => (
                <div key={i} className={styles.errorRow}>
                  <div className={styles.errorTop}>
                    <span className={styles.errorAction}>{labelFor(e.action)}</span>
                    <span className={styles.feedTime}>{relTime(e.ts)}</span>
                  </div>
                  <div className={styles.errorMsg}>{e.error}</div>
                  <div className={styles.errorWho}>
                    {e.username || 'anonymous'}{e.org ? ` · ${e.org}` : ''}
                  </div>
                </div>
              ))}
              {!(data?.errors || []).length && <div className={styles.empty}>No errors. 🎉</div>}
            </div>
          </section>

          {/* Top scanners */}
          <section className={styles.card}>
            <div className={styles.cardHead}><h2>Top scanners</h2></div>
            <div className={styles.rankList}>
              {(data?.topUsers || []).map((u, i) => (
                <div key={i} className={styles.rankRow}>
                  <span className={styles.rankName}>{u.username}</span>
                  <span className={styles.rankBarWrap}>
                    <span className={styles.rankBar}
                      style={{ width: `${Math.max(6, (u.scans / (data.topUsers[0]?.scans || 1)) * 100)}%` }} />
                  </span>
                  <span className={styles.rankNum}>{u.scans}</span>
                </div>
              ))}
              {!(data?.topUsers || []).length && <div className={styles.empty}>—</div>}
            </div>
          </section>

          {/* Scans by org */}
          <section className={styles.card}>
            <div className={styles.cardHead}><h2>Scans by organization</h2></div>
            <div className={styles.rankList}>
              {(data?.byOrg || []).map((o, i) => (
                <div key={i} className={styles.rankRow}>
                  <span className={styles.rankName}>{o.org}</span>
                  <span className={styles.rankBarWrap}>
                    <span className={styles.rankBar}
                      style={{ width: `${Math.max(6, (o.scans / (data.byOrg[0]?.scans || 1)) * 100)}%` }} />
                  </span>
                  <span className={styles.rankNum}>{o.scans}</span>
                </div>
              ))}
              {!(data?.byOrg || []).length && <div className={styles.empty}>—</div>}
            </div>
          </section>

          {/* Action mix */}
          <section className={styles.card}>
            <div className={styles.cardHead}><h2>What users are doing</h2></div>
            <div className={styles.actionList}>
              {(data?.actions || []).map((a, i) => {
                const total = a.ok + a.fail;
                const failPct = total ? (a.fail / total) * 100 : 0;
                return (
                  <div key={i} className={styles.actionRow}>
                    <span className={styles.actionName}>{labelFor(a.action)}</span>
                    <span className={styles.actionMeter}>
                      <span className={styles.actionOk}  style={{ width: `${100 - failPct}%` }} />
                      <span className={styles.actionFail} style={{ width: `${failPct}%` }} />
                    </span>
                    <span className={styles.actionNum}>
                      {total}{a.fail ? <em className={styles.actionFailNum}> · {a.fail} fail</em> : null}
                    </span>
                  </div>
                );
              })}
              {!(data?.actions || []).length && <div className={styles.empty}>—</div>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
