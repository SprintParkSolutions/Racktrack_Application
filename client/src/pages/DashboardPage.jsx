import { useEffect, useRef, useState, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/api';
import { LogsView } from './LogsPage.jsx';
import styles from './DashboardPage.module.css';
import PageHeader from '../components/PageHeader.jsx';
import { HeaderActions } from '../components/ShellHeader.jsx';

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
  'org.create':             'Created an org',
  'org.update':             'Updated an org',
  'org.reject':             'Rejected an org',
  'invite.create':          'Created an invite',
  'rack_group.create':      'Grouped two racks',
  'report.regen':           'Regenerated a report',
  'scan.confirm_layout':    'Confirmed rack layout',
  'scan.ocr_devices':       'Read device labels',
  'scan.analyze_for_ticket.rack_mismatch': 'Ticket rack didn’t match',
  'feedback.verified_ports':'Verified ports',
  'console.run_auto':       'Ran a check',
  'console.run_auto_stream':'Ran a live check',
  'auth.forgot_password.login_with_code': 'Signed in with a code',
  'active_learning.cycle':  'Retrained the model',
  'agent.post_work_note':   'Posted a work note',
  'agent.feedback_refresh': 'Refreshed feedback',
  'agent.proactive_refresh':'Refreshed data',
  'logs.clear':             'Cleared the log',
  'port_poller.reset':      'Reset a switch poll',
  'orphan_gc.run':          'Cleaned up storage',
  'orphan_gc.scheduled':    'Scheduled cleanup',
};

// Anything still unmapped becomes readable rather than raw ("rack_group.create"
// → "Rack group create") - no dotted machine names leak into the dashboard.
const humanizeAction = (a) =>
  String(a || '')
    .replace(/[._]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

const labelFor = (a) => ACTION_LABELS[a] || humanizeAction(a);

/* The audit log stores a code, not a sentence. This screen printed the code
   straight out, so the operations console read "no_token", "unknown_token",
   "revoked" - the product's own status page speaking to an operator in the
   field names of its auth module. Most of these are not faults at all: a
   session that ran out is what is supposed to happen to a session.

   Anything not in this list falls through unchanged rather than being hidden,
   because a code nobody has named yet is still better than nothing. */
const ERROR_WORDS = {
  no_token: 'Signed out, no session to refresh',
  expired: 'Session expired',
  revoked: 'Session was signed out elsewhere',
  unknown_token: 'Session no longer recognised',
  deactivated: 'Account is deactivated',
  user_inactive: 'Account is not active',
  missing_fields: 'Sign-in form was incomplete',
  bad_credentials: 'Wrong username or password',
};
const errorWords = (code) => {
  if (!code) return 'No detail recorded';
  const k = String(code).trim();
  return ERROR_WORDS[k] || k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

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

/* ── A figure ───────────────────────────────────────────────────────────
   One number, its label on a single line, and - where there is a second
   fact worth carrying - a note under it. Two of these fit across a phone;
   four fitted nowhere, which is why "ORGANIZATIONS" was arriving clipped to
   "ORGANIZATION" and every box in the row was a different height.
   The note line is always drawn, so the boxes match whether it is used. */
function Figure({ label, value, note = null, tone }) {
  return (
    <div className={`${styles.figure} ${tone ? styles[tone] : ''}`} data-figure>
      <div className={styles.figValue}>{value}</div>
      <div className={styles.figLabel}>{label}</div>
      <div className={styles.figNote}>{note}</div>
    </div>
  );
}

/* A long list shows its first few rows and says how many more there are, so
   a phone reaches the next section without scrolling through everything. */
function useLimit(items, limit) {
  const [open, setOpen] = useState(false);
  const all = items || [];
  return {
    shown: open ? all : all.slice(0, limit),
    open,
    total: all.length,
    limit,
    toggle: () => setOpen((o) => !o),
  };
}

function More({ state, what }) {
  if (state.total <= state.limit) return null;
  return (
    <button type="button" className={styles.more} onClick={state.toggle}>
      {state.open ? 'Show fewer' : `View all ${state.total} ${what}`}
    </button>
  );
}

/* ── Live activity ─────────────────────────────────────────────────────
   One event, one line: who, what they did, and when. The org and the guest
   mark stay in that line; a failure keeps its own line underneath, which is
   the only place a row is ever two lines tall. The time sits in its own
   column on the right, so it is no longer pushed out of the card. */
function ActivityCard({ rows, generatedAt }) {
  const list = useLimit(rows, 6);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Live activity</h2>
        <span className={styles.cardMeta}>
          {generatedAt ? `updated ${relTime(generatedAt)}` : ''}
        </span>
      </div>
      <div className={styles.rows}>
        {list.shown.map((e, i) => {
          const failed = e.status === 'fail';
          const who = e.username || 'guest';
          const guest = !e.actor_id && e.guest;
          const line = [who, labelFor(e.action), e.org || null, guest ? 'not signed in' : null]
            .filter(Boolean).join(' · ');
          return (
            <div key={i} className={styles.row} data-row>
              <span className={styles.rowLine} title={line}>
                {failed && <span className={styles.failTag}>Failed</span>}
                <span className={styles.rowWho}>{who}</span>
                <span className={styles.rowWhat}>
                  {labelFor(e.action)}
                  {e.org ? ` · ${e.org}` : ''}
                  {guest ? ' · not signed in' : ''}
                </span>
              </span>
              <span className={styles.rowTime}>{relTime(e.ts)}</span>
              {failed && e.error && <span className={styles.rowFail}>{errorWords(e.error)}</span>}
            </div>
          );
        })}
        {!list.total && <div className={styles.empty}>No activity yet.</div>}
      </div>
      <More state={list} what="events" />
    </section>
  );
}

function ErrorsCard({ rows }) {
  const list = useLimit(rows, 4);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Recent errors</h2>
        {list.total > 0 && <span className={styles.cardMeta}>{list.total}</span>}
      </div>
      <div className={styles.rows}>
        {list.shown.map((e, i) => (
          <div key={i} className={styles.row} data-row>
            <span className={styles.rowLine}>
              <span className={styles.rowWho}>{labelFor(e.action)}</span>
              <span className={styles.rowWhat}>
                {e.username || 'anonymous'}{e.org ? ` · ${e.org}` : ''}
              </span>
            </span>
            <span className={styles.rowTime}>{relTime(e.ts)}</span>
            <span className={styles.rowFail}>{errorWords(e.error)}</span>
          </div>
        ))}
        {!list.total && <div className={styles.empty}>No errors.</div>}
      </div>
      <More state={list} what="errors" />
    </section>
  );
}

/* Top scanners, scans by organization, scans by site - the same row three
   times over: a name, how it compares, and the count. */
function RankCard({ title, rows, what }) {
  const list = useLimit(rows, 5);
  const top = rows[0]?.value || 1;
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        {list.total > 0 && <span className={styles.cardMeta}>{list.total}</span>}
      </div>
      <div className={styles.rankList}>
        {list.shown.map((r, i) => (
          <div key={i} className={styles.rankRow}>
            <span className={styles.rankName} title={r.name}>{r.name}</span>
            <span className={styles.rankBarWrap}>
              <span className={styles.rankBar} style={{ width: `${Math.max(6, (r.value / top) * 100)}%` }} />
            </span>
            <span className={styles.rankNum}>{r.value}</span>
          </div>
        ))}
        {!list.total && <div className={styles.empty}>Nothing yet.</div>}
      </div>
      <More state={list} what={what} />
    </section>
  );
}

function ActionMixCard({ rows }) {
  const list = useLimit(rows, 5);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>What people are doing</h2>
        {list.total > 0 && <span className={styles.cardMeta}>{list.total}</span>}
      </div>
      <div className={styles.rankList}>
        {list.shown.map((a, i) => {
          const total = a.ok + a.fail;
          const failPct = total ? (a.fail / total) * 100 : 0;
          const name = labelFor(a.action);
          return (
            <div key={i} className={styles.rankRow}>
              <span className={styles.rankName} title={name}>{name}</span>
              <span className={styles.actionMeter}>
                <span className={styles.actionOk}  style={{ width: `${100 - failPct}%` }} />
                <span className={styles.actionFail} style={{ width: `${failPct}%` }} />
              </span>
              <span className={styles.rankNum}>
                {total}{a.fail ? <em className={styles.actionFailNum}> · {a.fail} failed</em> : null}
              </span>
            </div>
          );
        })}
        {!list.total && <div className={styles.empty}>Nothing yet.</div>}
      </div>
      <More state={list} what="actions" />
    </section>
  );
}

/* The scans themselves. Was a five-column table that a phone could only read
   sideways; it is the rack, then who and where, with the time on the right. */
function ScansCard({ rows }) {
  const list = useLimit(rows, 6);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>Recent scans</h2>
        {list.total > 0 && <span className={styles.cardMeta}>{list.total}</span>}
      </div>
      <div className={styles.rows}>
        {list.shown.map((s, i) => {
          const where = [s.username, s.site, s.org].filter(Boolean).join(' · ') || '-';
          return (
            <div key={i} className={styles.row} data-row>
              <span className={`${styles.rowLine} ${styles.rowMono}`}>{s.rack || '-'}</span>
              <span className={styles.rowTime}>{relTime(s.ts)}</span>
              <span className={styles.rowWhere} title={where}>{where}</span>
            </div>
          );
        })}
        {!list.total && <div className={styles.empty}>No scans yet.</div>}
      </div>
      <More state={list} what="scans" />
    </section>
  );
}

// Sign-ins and the rest: a label and a number on one line each, which is what
// five figures side by side were trying to be.
function AuthCard({ auth }) {
  const rows = [
    ['Sign-ins',        auth?.logins_ok ?? 0,   false],
    ['Failed sign-ins', auth?.logins_fail ?? 0, true],
    ['Sign-ups',        auth?.signups ?? 0,     false],
    ['Invites accepted',auth?.invites ?? 0,     false],
    ['Password resets', auth?.resets ?? 0,      false],
  ];
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}><h2>Signing in</h2></div>
      <div className={styles.pairList}>
        {rows.map(([label, value, bad]) => (
          <div key={label} className={styles.pairRow}>
            <span className={styles.pairLabel}>{label}</span>
            <span className={`${styles.pairValue} ${bad && value ? styles.authFail : ''}`}>{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function UsersCard({ rows }) {
  const list = useLimit(rows, 8);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>All people</h2>
        <span className={styles.cardMeta}>{list.total} in total</span>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>ID</th><th>Person</th><th>Role</th><th>Organization</th><th className={styles.thNum}>Scans</th><th className={styles.thNum}>Events</th><th className={styles.thNum}>Failed</th><th>Last active</th></tr></thead>
          <tbody>
            {list.shown.map((u, i) => (
              <tr key={i}>
                <td><code className={styles.userId}>{u.public_id || '-'}</code></td>
                <td>{u.username}{u.active === 0 && <span className={styles.inactive}> · inactive</span>}</td>
                <td><span className={styles.roleTag}>{u.role}</span></td>
                <td>{u.org || '-'}</td>
                <td className={styles.num}>{u.scans}</td>
                <td className={styles.num}>{u.events}</td>
                <td className={styles.num}>{u.fails ? <b className={styles.authFail}>{u.fails}</b> : 0}</td>
                <td className={styles.dim}>{u.last_active ? relTime(u.last_active) : 'never'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.total && <div className={styles.empty}>No people yet.</div>}
      </div>
      <More state={list} what="people" />
    </section>
  );
}

function OrgsCard({ rows }) {
  const list = useLimit(rows, 8);
  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>All organizations</h2>
        <span className={styles.cardMeta}>{list.total} in total</span>
      </div>
      <div className={styles.rows}>
        {list.shown.map((o, i) => (
          <div key={i} className={styles.row} data-row>
            <span className={styles.rowLine} title={o.name}>
              <span className={styles.rowWho}>{o.name}</span>
              <span className={styles.rowWhat}>
                <span className={styles.roleTag}>{o.status}</span>
                {` ${o.members} ${o.members === 1 ? 'person' : 'people'}`}
              </span>
            </span>
            <span className={styles.rowCount}>{o.scans}</span>
          </div>
        ))}
        {!list.total && <div className={styles.empty}>No organizations.</div>}
      </div>
      <More state={list} what="organizations" />
    </section>
  );
}

// The operations view - headline figures, live activity, errors, rankings,
// people and organizations. The console (below) owns the page chrome and the
// Live / Refresh controls, driving this via `live` and `refreshTick`.
function OperationsView({ live = true, refreshTick = 0 }) {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [, setTick]           = useState(0);   // re-render so "x ago" stays fresh
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

  // Reload when the console's Refresh button is pressed.
  useEffect(() => { if (refreshTick) load(); }, [refreshTick, load]);

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
    return <div className={styles.center}>Loading dashboard…</div>;
  }
  if (error && !data) {
    return <div className={styles.center}>{error}</div>;
  }

  const t  = data?.totals   || {};
  const fb = data?.feedback || {};
  const feedback = (fb.right || 0) + (fb.wrong || 0)
    ? `${fb.right} right · ${fb.wrong} wrong`
    : 'no feedback yet';

  return (
    <div className={styles.opsWrap}>
      {/* Six figures, two across. The people and organization counts used to
          be two more boxes here; they are the counts on "All people" and
          "All organizations" further down, which is where they are read. */}
      <section className={styles.figures}>
        <Figure label="Scans today" value={t.scansToday ?? 0} tone="accent" />
        <Figure label="Active today" value={t.activeToday ?? 0} note="people" />
        <Figure label="Total scans" value={t.scansOk ?? 0}
                note={t.scansFail ? `${t.scansFail} failed` : null} />
        <Figure label="Success rate" value={t.successRate != null ? `${t.successRate}%` : '-'}
                tone={t.successRate != null && t.successRate < 90 ? 'warn' : undefined} />
        <Figure label="Feedback accuracy" value={fb.accuracy != null ? `${fb.accuracy}%` : '-'}
                note={feedback}
                tone={fb.accuracy != null && fb.accuracy < 80 ? 'warn' : undefined} />
        <Figure label="Failures" value={t.totalFails ?? 0}
                note={t.totalEvents ? `of ${t.totalEvents} events` : null}
                tone={t.totalFails ? 'warn' : undefined} />
      </section>

      <div className={styles.grid}>
        <ActivityCard rows={data?.recent} generatedAt={data?.generatedAt} />

        <div className={styles.sideCol}>
          <ErrorsCard rows={data?.errors} />
          <RankCard title="Top scanners" what="people"
            rows={(data?.topUsers || []).map(u => ({ name: u.username, value: u.scans }))} />
          <RankCard title="Scans by organization" what="organizations"
            rows={(data?.byOrg || []).map(o => ({ name: o.org, value: o.scans }))} />
          <RankCard title="Scans by site" what="sites"
            rows={(data?.bySite || []).map(s => ({ name: s.site, value: s.scans }))} />
          <ActionMixCard rows={data?.actions || []} />
        </div>
      </div>

      <ScansCard rows={data?.recentScans} />
      <AuthCard auth={data?.auth} />
      <UsersCard rows={data?.allUsers} />
      <OrgsCard rows={data?.allOrgs} />
    </div>
  );
}

// No per-tab subtitle: each described in a sentence what the tab beneath it was
// already showing, and the tab's own label named it.
const TABS = [
  { key: 'ops',  label: 'Operations' },
  { key: 'logs', label: 'Logs' },
];

// The owner console: one place for all operations AND logs. The header carries
// the page's name and the Live switch; one row under it holds the two tabs and
// Refresh. Each tab mounts its own self-contained view, so only the visible tab
// polls.
export default function DashboardPage() {
  const [tab,  setTab]  = useState('ops');
  const [live, setLive] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const liveBtn = (
    <button
      type="button"
      className={`${styles.liveBtn} ${live ? styles.liveOn : ''}`}
      onClick={() => setLive(v => !v)}
      aria-pressed={live}
      title={live ? 'Auto-refresh on' : 'Auto-refresh paused'}
    >
      <span className={styles.liveDot} />
      {live ? 'Live' : 'Paused'}
    </button>
  );
  const refreshBtn = (
    <button type="button" className={styles.refreshBtn} onClick={() => setRefreshTick(n => n + 1)}>
      Refresh
    </button>
  );

  return (
    <div className={styles.page}>
      {/* On a wide screen the shared shell draws the header, so the page's own
          one is hidden and these controls portal into the shell's right slot.
          No-op on a phone, so nothing is drawn twice. */}
      <HeaderActions>
        {liveBtn}
        {refreshBtn}
      </HeaderActions>

      <PageHeader
        title="Operations Console"
        backFallback="/"
        className={styles.ownHeader}
        action={liveBtn}
      />

      <div className={styles.body}>
        {/* The tabs and Refresh in one row that does not wrap. */}
        <div className={styles.controls}>
          <nav className={styles.tabBar}>
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <span className={styles.controlsEnd}>{refreshBtn}</span>
        </div>

        {tab === 'ops'
          ? <OperationsView live={live} refreshTick={refreshTick} />
          : <LogsView live={live} refreshTick={refreshTick} />}
      </div>
    </div>
  );
}
