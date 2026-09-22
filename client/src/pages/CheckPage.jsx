import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import Icon from '../components/Icon';
import { apiUrl, authFetch } from '../utils/api';
import styles from './CheckPage.module.css';

/**
 * One check, followed - the technician's screen.
 *
 * A technician photographs a rack, sends what differs, and then wants to know
 * what became of it. The Desk is not their answer: it is a workbench for the
 * people who decide, and the owner's rule is that a SPOC and an admin go
 * there while a technician stays here. So "Track this check" only reaches
 * this page for the person who sent it, and this page has to be worth
 * reaching.
 *
 * The first version of it was four grey lines. This one says everything the
 * server already knows about their check, in the order a person asks:
 *
 *   where it is      one line, and a rail of the four steps a check goes
 *                    through, with the step it is on lit and the ones behind
 *                    it ticked and dated
 *   who has it       the SPOC it went to, and the incident raised for them
 *   what you sent    every difference, in the words the drift screen used
 *                    when they sent it, with what became of each one
 *   what happened    the decisions and the write, newest first
 *
 * It decides nothing and writes nothing: a technician approves nothing, so
 * there is no control here that could.
 *
 * Everything is one request, GET /api/approvals/plans/:id, which the server
 * scopes to people who may read that check. It is asked again every twenty
 * seconds, the same as the drift screen, so a person standing at the rack
 * watches "Waiting to be read" become "Approved" without pulling anything.
 */

const POLL_MS = 20000;

/* The four steps a check goes through, and which statuses sit on each. The
   rail draws these in order, whatever order the workflow reports them in. */
const STEPS = [
  { key: 'sent', label: 'Sent', of: ['submitted', 'triage'] },
  { key: 'read', label: 'With the SPOC', of: ['assigned', 'accepted', 'in_progress', 'pending', 'rework'] },
  { key: 'decided', label: 'Decided', of: ['approved', 'approval_pending', 'verification_pending', 'rejected', 'manual_review'] },
  { key: 'written', label: 'In your records', of: ['write_in_progress', 'written', 'completed', 'write_failed'] },
];

export function stepOf(status) {
  const i = STEPS.findIndex((s) => s.of.includes(String(status || '')));
  return i < 0 ? 0 : i;
}

/** Where it is, in one line. The status word is the workflow's; this is ours. */
export function whereItIs(status, holder) {
  const who = holder ? ` with ${holder}` : '';
  switch (String(status || '')) {
    case 'draft': return 'Not sent yet';
    case 'submitted': return 'Sent';
    case 'triage': return 'Waiting for an admin to choose who it goes to';
    case 'assigned': return `Waiting to be read${who}`;
    case 'accepted': return `Being read${who}`;
    case 'in_progress': return `Being worked${who}`;
    case 'pending': return `On hold${who}`;
    case 'rework': return 'Sent back for more detail';
    case 'approval_pending': return 'Waiting for a second approval';
    case 'verification_pending': return 'Waiting for a verification scan';
    case 'approved': return 'Approved';
    case 'rejected': return 'Rejected';
    case 'write_in_progress': return 'Being written to your records';
    case 'write_failed': return 'The write did not finish';
    case 'written':
    case 'completed': return 'Written to your records';
    case 'manual_review': return 'Held for a person to look at';
    default: return status ? String(status).replace(/_/g, ' ') : 'Sent';
  }
}

export const isSettled = (status) => ['written', 'completed', 'rejected'].includes(String(status || ''));

/* The same words the drift screen used when this check was sent, so a person
   reads the same sentence twice rather than two sentences about one thing. */
const WORD = {
  create: 'Not in your records',
  update: 'Different from your records',
  rebind: 'Listed under an older id',
};
/* And what the SPOC did with each one. */
const DECIDED = {
  approved: 'Approved',
  rejected: 'Rejected',
  pending: 'Not decided yet',
  modified: 'Changed, then approved',
};

/** "Router U20 SP-HYB-RM01-R01-R1" -> "Router on shelf U20". */
export function plainName(name, rackName) {
  let out = String(name || '');
  if (rackName && out.endsWith(rackName)) out = out.slice(0, -rackName.length).trim();
  const m = out.match(/^(.+?)\s+U(\d{1,2})$/);
  return m ? `${m[1]} on shelf U${Number(m[2])}` : out;
}

export function when(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : `${Math.floor(d / 7)}w ago`;
}

const isHousekeeping = (i) => i && i.action === 'rebind' && !i.fromUid;

export default function CheckPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const ask = useCallback(async () => {
    try {
      const r = await authFetch(apiUrl(`/api/approvals/plans/${encodeURIComponent(planId)}`));
      if (!r.ok) {
        setError(r.status === 403 || r.status === 404
          ? 'This check is not one you can follow.'
          : 'The check could not be loaded just now.');
        return;
      }
      setData(await r.json());
      setError('');
    } catch {
      setError('The check could not be loaded. Check your connection.');
    }
  }, [planId]);

  useEffect(() => {
    let dropped = false;
    const run = () => { if (!dropped) ask(); };
    run();
    const t = setInterval(run, POLL_MS);
    return () => { dropped = true; clearInterval(t); };
  }, [ask]);

  const plan = data?.plan || null;
  const status = plan?.status || '';
  const holder = data?.holder?.username || data?.holder || '';
  const incident = data?.incident || null;
  const rackName = plan?.rackName || '';
  const rackId = plan?.rackId || '';
  const sender = data?.sender?.username || '';
  const note = data?.sender?.note || '';
  const decisions = Array.isArray(data?.decisions) ? data.decisions : [];
  const settled = isSettled(status);
  const failed = status === 'write_failed' || status === 'rejected';
  const step = stepOf(status);

  // What was sent, in the words it was sent in. Housekeeping rows are
  // RackTrack relabelling its own records and were never a person's business.
  const items = useMemo(
    () => (Array.isArray(data?.items) ? data.items : []).filter((i) => i.decidable && !isHousekeeping(i)),
    [data],
  );
  const written = Array.isArray(data?.changes) ? data.changes.length : 0;

  const stamps = useMemo(() => {
    const out = {};
    out.sent = plan?.submittedAt || plan?.createdAt || '';
    out.read = plan?.spoc?.assignedAt || plan?.receivedAt || '';
    const last = decisions[decisions.length - 1];
    out.decided = last?.at || last?.decidedAt || '';
    out.written = plan?.writtenAt || plan?.completedAt || '';
    return out;
  }, [plan, decisions]);

  return (
    <div className={`page page-full ${styles.page}`}>
      <PageHeader
        eyebrow="Your check"
        title={rackName || 'Drift check'}
        sub={plan?.siteName || null}
        back={() => (rackId ? navigate(`/results/${encodeURIComponent(rackId)}/drift`) : navigate(-1))}
      />

      <div className={styles.scroll}>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!data && !error && <p className={styles.waiting}>Loading the check…</p>}

        {data && (
          <>
            {/* Where it is: the answer, and the road it is on. */}
            <section className={`${styles.lead} ${settled ? styles.leadDone : ''} ${failed ? styles.leadBad : ''}`}>
              <p className={styles.leadLine}>{whereItIs(status, holder)}</p>
              <p className={styles.leadNote}>
                {settled ? 'Nothing else is needed from you.' : 'This page follows it. Nothing for you to do.'}
              </p>

              <ol className={styles.rail} aria-label="How far this check has got">
                {STEPS.map((s, i) => (
                  <li
                    key={s.key}
                    className={`${styles.railStep} ${i < step ? styles.stepDone : ''} ${i === step ? styles.stepNow : ''}`}
                  >
                    <span className={styles.railMark} aria-hidden="true">
                      {i < step ? <Icon name="check" /> : <i />}
                    </span>
                    <span className={styles.railText}>
                      <b>{s.label}</b>
                      {stamps[s.key] ? <small>{when(stamps[s.key])}</small> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            {/* Who has it, and the one incident raised for it. */}
            <section className={styles.facts}>
              {incident?.number && (
                <div className={styles.fact}>
                  <span className={styles.factKey}>Incident</span>
                  <span className={`${styles.factVal} ${styles.mono}`}>{incident.number}</span>
                  {incident.state && <span className={styles.factSub}>{incident.state}</span>}
                </div>
              )}
              {holder && (
                <div className={styles.fact}>
                  <span className={styles.factKey}>With</span>
                  <span className={styles.factVal}>{holder}</span>
                  <span className={styles.factSub}>single point of contact</span>
                </div>
              )}
              {sender && (
                <div className={styles.fact}>
                  <span className={styles.factKey}>Sent by</span>
                  <span className={styles.factVal}>{sender}</span>
                  {stamps.sent && <span className={styles.factSub}>{when(stamps.sent)}</span>}
                </div>
              )}
              {written > 0 && (
                <div className={styles.fact}>
                  <span className={styles.factKey}>Written</span>
                  <span className={styles.factVal}>{written}</span>
                  <span className={styles.factSub}>{written === 1 ? 'field' : 'fields'} in your records</span>
                </div>
              )}
            </section>

            {note && (
              <p className={styles.note}>
                <span className={styles.noteKey}>Your note</span>
                {note}
              </p>
            )}

            {/* What was sent, and what became of each one. */}
            {items.length > 0 && (
              <section className={styles.sect}>
                <div className={styles.sectTop}>
                  <h2 className={styles.sectTitle}>What you sent</h2>
                  <span className={styles.count}>{items.length}</span>
                </div>
                <ul className={styles.items}>
                  {items.map((item) => (
                    <li key={item.uid} className={styles.item}>
                      <span className={styles.itemText}>
                        <b>{plainName(item.name, rackName)}</b>
                        <small>{WORD[item.action] || item.action}</small>
                      </span>
                      <span className={`${styles.verdict} ${styles[item.decision] || ''}`}>
                        {DECIDED[item.decision] || DECIDED.pending}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* What happened to it, newest first. */}
            {decisions.length > 0 && (
              <section className={styles.sect}>
                <div className={styles.sectTop}>
                  <h2 className={styles.sectTitle}>What happened</h2>
                </div>
                <ul className={styles.log}>
                  {[...decisions].reverse().map((d, i) => (
                    <li key={`${d.stage || 'step'}-${i}`}>
                      <span className={styles.logWhat}>{DECIDED[d.decision] || String(d.decision || 'Decided')}</span>
                      <span className={styles.logWho}>
                        {[d.approver, when(d.at || d.decidedAt)].filter(Boolean).join(' · ')}
                      </span>
                      {d.reason ? <span className={styles.logWhy}>{d.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {rackId && (
              <button
                type="button"
                className={styles.way}
                onClick={() => navigate(`/results/${encodeURIComponent(rackId)}/drift`)}
              >
                Open the rack&apos;s drift check
                <Icon name="chevron_right" className={styles.wayChev} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
