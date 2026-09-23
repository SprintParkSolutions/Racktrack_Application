import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon';
import { apiUrl, authFetch } from '../utils/api';
import { waited } from './MyChecksPage.jsx';
import styles from './MyChecksPage.module.css';

/**
 * What you raised, and what became of it.
 *
 * A technician photographs a rack, compares it with the record and sends the
 * differences. An incident is raised at that moment and the check goes to
 * somebody else to decide - and until now the person who sent it had nowhere
 * to look afterwards. The owner asked on 23 September 2026 for a page of
 * their past raised incidents and where each one stands.
 *
 * One question, answered in the order it matters: what is still moving, then
 * what is finished. Each row is the incident number, the rack, and the state
 * in the words a person would use - who is holding it, or what was decided.
 * It opens the check itself, which is where the detail is.
 *
 * Everything comes from GET /api/approvals/plans?createdBy=me, which the
 * server already scopes to this account. Nothing here decides anything.
 */

const PAGE = 100;
const UNNAMED = /^RK-[0-9A-F]{6,}$/i;
const NO_NAME = 'Unidentified rack';

/** The states in which somebody still has work to do on it. */
const MOVING = new Set([
  'submitted', 'triage', 'assigned', 'accepted', 'in_progress', 'pending',
  'resolved', 'verification_pending', 'approval_pending', 'approved',
  'write_in_progress', 'write_failed', 'manual_review', 'rework', 'reopened',
]);
const WRITTEN = new Set(['written', 'completed']);

/**
 * Where this incident stands, told to the person who raised it.
 *
 * Not the same sentence a SPOC reads: they want to know what is on their own
 * desk, and this person wants to know who has theirs and what was decided.
 */
export function raisedState(plan) {
  const status = String(plan?.status || '');
  const who = plan?.holder || null;
  switch (status) {
    case 'submitted': return 'Sent';
    case 'triage': return 'Waiting for an admin';
    case 'assigned': return who ? `With ${who}, not read yet` : 'Not read yet';
    case 'accepted':
    case 'in_progress': return who ? `${who} is working on it` : 'Being worked on';
    case 'pending': return 'On hold';
    case 'rework': return 'Sent back to you';
    case 'verification_pending': return 'Waiting for another photograph';
    case 'approval_pending': return 'Waiting for a second approval';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'cancelled': return 'Cancelled';
    case 'write_in_progress': return 'Being written to the records';
    case 'write_failed': return 'The write did not finish';
    case 'manual_review': return 'Being looked at by hand';
    case 'written':
    case 'completed': return 'Written to the records';
    default: return 'Open';
  }
}

export default function MyIncidentsPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState(null);
  const [failed, setFailed] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(apiUrl(`/api/approvals/plans?createdBy=me&limit=${PAGE}`));
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
    state: raisedState(p),
    moving: MOVING.has(p.status),
    written: WRITTEN.has(p.status),
    differences: Number(p.summary?.decidable ?? 0),
    waited: waited(p.submittedAt || p.createdAt),
    at: p.submittedAt || p.createdAt || '',
  })), [plans]);

  /* Newest first in both lists: this is a history, and the last thing this
     person sent is the one they are asking about. */
  const moving = useMemo(
    () => rows.filter((r) => r.moving).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    [rows],
  );
  const finished = useMemo(
    () => rows.filter((r) => !r.moving).sort((a, b) => String(b.at).localeCompare(String(a.at))),
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
                <span
                  className={`${styles.dot} ${r.written ? styles.dotDone : r.moving ? styles.dotOpen : styles.dotOther}`}
                  aria-hidden="true"
                />
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
        eyebrow="Your work"
        title="Incidents you raised"
        sub="Every check you sent, and where it stands"
        backFallback="/"
      />

      <div className={styles.scroll}>
        {plans === null && <p className={styles.note}>Loading what you sent…</p>}

        {failed && <p className={styles.note}>Your incidents could not be loaded just now.</p>}

        {plans !== null && !failed && rows.length === 0 && (
          <div className={styles.blank}>
            <p className={styles.blankLead}>You have not raised anything yet</p>
            <p className={styles.blankWords}>
              Photograph a rack, check it against the records and send the differences.
              What you send appears here with its incident number.
            </p>
          </div>
        )}

        {moving.length > 0 && (
          <section className={styles.sect}>
            <div className={styles.sectTop}>
              <h2 className={styles.sectTitle}>Still moving</h2>
              <span className={styles.count}>{moving.length}</span>
            </div>
            {list(moving)}
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
