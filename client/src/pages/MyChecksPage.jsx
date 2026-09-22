import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon';
import { useAuth } from '../AuthContext.jsx';
import { apiUrl, authFetch } from '../utils/api';
import styles from './MyChecksPage.module.css';

/**
 * The checks that are with you - the single point of contact's list.
 *
 * A SPOC does not scan racks. Somebody else photographs a rack, the check
 * reaches them with an incident raised against it, and their whole job is to
 * work through what has arrived. Until 22 September 2026 the only place that
 * list existed was RackTrack Drift Desk, a separate application; the owner
 * asked for it in the app, as a list of the incidents assigned to them.
 *
 * So this is one screen and one question - what is with me - answered in the
 * order a person works: what is still open, oldest first, because the oldest
 * is the one somebody is waiting on. Each row is the incident number, the
 * rack, where the check is and how long it has been there. It opens the
 * check's own page, which is where the detail and the way into the Desk are.
 *
 * Everything comes from GET /api/approvals/plans?holder=me, which the server
 * already scopes to this person. Nothing here decides anything.
 */

const PAGE = 100;

/** The plan statuses that mean nobody has finished with the check yet. */
const OPEN = new Set([
  'submitted', 'triage', 'assigned', 'accepted', 'in_progress', 'pending',
  'resolved', 'verification_pending', 'approval_pending', 'approved',
  'write_in_progress', 'write_failed', 'manual_review', 'rework', 'reopened',
]);
const DONE = new Set(['written', 'completed']);

const UNNAMED = /^RK-[0-9A-F]{6,}$/i;
const NO_NAME = 'Rack not identified yet';

/** Where a check is, in one short phrase for a list. */
export function shortState(status) {
  switch (String(status || '')) {
    case 'triage': return 'Waiting for an admin';
    case 'assigned': return 'Not read yet';
    case 'accepted': return 'Being read';
    case 'in_progress': return 'In progress';
    case 'pending': return 'On hold';
    case 'rework': return 'Sent back';
    case 'approval_pending': return 'Second approval';
    case 'verification_pending': return 'Waiting for a scan';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'write_failed': return 'Write did not finish';
    case 'written':
    case 'completed': return 'Written';
    default: return 'Open';
  }
}

/** How long it has been sitting there. The oldest is the one that matters. */
export function waited(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

export default function MyChecksPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [plans, setPlans] = useState(null);
  const [failed, setFailed] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(apiUrl(`/api/approvals/plans?holder=me&limit=${PAGE}`));
      if (!r.ok) { setFailed(true); setPlans([]); return; }
      const d = await r.json();
      setPlans(Array.isArray(d?.plans) ? d.plans : []);
      setFailed(false);
    } catch {
      setFailed(true);
      setPlans([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (plans || []).map((p) => ({
    id: p.id,
    incident: p.incidentNumber || null,
    rack: p.rackName && !UNNAMED.test(p.rackName) ? String(p.rackName) : null,
    site: p.siteName || null,
    state: shortState(p.status),
    open: OPEN.has(p.status),
    done: DONE.has(p.status),
    differences: Number(p.summary?.decidable ?? 0),
    waited: waited(p.receivedAt || p.updatedAt || p.createdAt),
    at: p.receivedAt || p.updatedAt || p.createdAt || '',
  })), [plans]);

  // Open first, and among those the one that has been waiting longest.
  const open = useMemo(
    () => rows.filter((r) => r.open).sort((a, b) => String(a.at).localeCompare(String(b.at))),
    [rows],
  );
  const finished = useMemo(
    () => rows.filter((r) => !r.open).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    [rows],
  );

  const list = (items) => (
    <ul className={styles.rows}>
      {items.map((r) => (
        <li key={r.id}>
          <button type="button" className={styles.row} onClick={() => navigate(`/checks/${r.id}`)}>
            <span className={styles.text}>
              <span className={styles.top}>
                <span className={`${styles.inc} ${r.incident ? '' : styles.quiet}`}>
                  {r.incident || 'No incident number'}
                </span>
                {r.waited && <span className={styles.age}>{r.waited}</span>}
              </span>
              <span className={styles.meta}>
                <span className={styles.rack}>{r.rack || NO_NAME}</span>
                {r.site ? <span className={styles.sep} aria-hidden="true" /> : null}
                {r.site}
              </span>
              <span className={styles.stateLine}>
                <span className={`${styles.dot} ${r.done ? styles.dotDone : r.open ? styles.dotOpen : styles.dotOther}`} aria-hidden="true" />
                {r.state}
                {r.differences > 0 && (
                  <span className={styles.diff}>
                    {r.differences} difference{r.differences === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            </span>
            <Icon name="chevron_right" className={styles.chev} />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`page page-full ${styles.page}`}>
      <PageHeader
        eyebrow="Single point of contact"
        title="With you"
        sub={user?.tenant?.name || null}
        backFallback="/"
      />

      <div className={styles.scroll}>
        {plans === null && <p className={styles.note}>Loading your checks…</p>}

        {failed && <p className={styles.note}>Your checks could not be loaded just now.</p>}

        {plans !== null && !failed && rows.length === 0 && (
          <div className={styles.blank}>
            <p className={styles.blankLead}>Nothing is with you</p>
            <p className={styles.blankWords}>
              A drift check reaches you as soon as somebody sends one from a rack at your Site.
            </p>
          </div>
        )}

        {open.length > 0 && (
          <section className={styles.sect}>
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle}>Open</h2>
              <span className={styles.count}>{open.length}</span>
            </div>
            {list(open)}
          </section>
        )}

        {finished.length > 0 && (
          <section className={styles.sect}>
            <button
              type="button"
              className={styles.foldHead}
              aria-expanded={showDone}
              onClick={() => setShowDone((v) => !v)}
            >
              <h2 className={styles.sectTitle}>Finished</h2>
              <span className={styles.count}>{finished.length}</span>
              <i className={`${styles.foldChev} ${showDone ? styles.foldOpen : ''}`} aria-hidden="true" />
            </button>
            {showDone && list(finished)}
          </section>
        )}
      </div>
    </div>
  );
}
