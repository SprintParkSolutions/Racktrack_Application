import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import ExternalLink from '../components/ExternalLink.jsx';
import Icon from '../components/Icon';
import { useApprovalsCan } from '../hooks/useApprovalsCan.js';
import { apiUrl, authFetch } from '../utils/api';
import { driftCheckUrl } from '../utils/approvals';
import styles from './CheckPage.module.css';

/**
 * One check, followed - inside the app.
 *
 * A technician photographs a rack, sends the differences, and then wants to
 * know what happened to them. Until 22 September 2026 the only answer was
 * "Track this check", which left the app for RackTrack Drift Desk - a whole
 * dashboard of queues, reports and exceptions built for the people who decide.
 * The owner's direction that day: the Desk is for the single points of contact
 * and the admins; a technician needs one page that follows the one check they
 * sent. This is that page.
 *
 * It states only what the server says, in the workflow's own words:
 *
 *   where it is      the status, as a line anybody can read
 *   who has it       the SPOC it went to, or that it is waiting for an admin
 *   its incident     the number, never an address
 *   what happened    each decision, newest first, with who made it and when
 *
 * It decides nothing and writes nothing: there is no approve, no reject and
 * no reassign here, because none of those are a technician's to make. Whoever
 * may decide gets a quiet way into the Desk at the foot of the page.
 *
 * The same twenty seconds the drift screen uses, so a person standing at the
 * rack sees "With the SPOC" become "Approved" without pulling anything.
 */

const POLL_MS = 20000;

/** The workflow's own word, as a sentence a person can read. */
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
    case 'write_in_progress': return 'Being written to the record';
    case 'write_failed': return 'The write did not finish';
    case 'written': return 'Written to the record';
    case 'completed': return 'Written to the record';
    case 'manual_review': return 'Held for a person to look at';
    default: return status ? String(status).replace(/_/g, ' ') : 'Sent';
  }
}

/** Done, or still going. Only these two, because that is all a sender needs. */
export const isSettled = (status) => ['written', 'completed', 'rejected'].includes(String(status || ''));

function when(iso) {
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

export default function CheckPage() {
  const { planId } = useParams();
  const navigate = useNavigate();
  const can = useApprovalsCan();
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');

  const ask = useCallback(async () => {
    try {
      const r = await authFetch(apiUrl(`/api/approvals/plans/${encodeURIComponent(planId)}`));
      if (!r.ok) {
        // A check this person may not read is not an error to explain away.
        setError(r.status === 403 || r.status === 404
          ? 'This check is not one you can follow.'
          : 'The check could not be loaded just now.');
        return;
      }
      setPlan(await r.json());
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

  const status = plan?.plan?.status || plan?.status || '';
  const holder = plan?.holder?.username || plan?.holder || '';
  const incident = plan?.incident || null;
  const rackName = plan?.plan?.rackName || plan?.rackName || '';
  const siteName = plan?.plan?.siteName || plan?.siteName || '';
  const rackId = plan?.plan?.rackId || plan?.rackId || '';
  const decisions = Array.isArray(plan?.decisions) ? plan.decisions : [];
  const settled = isSettled(status);

  return (
    <div className={`page page-full ${styles.page}`}>
      <PageHeader
        eyebrow="Drift check"
        title={rackName || 'Your check'}
        sub={siteName || null}
        back={() => (rackId ? navigate(`/results/${encodeURIComponent(rackId)}/drift`) : navigate(-1))}
      />

      <div className={styles.scroll}>
        {error && <p className={styles.error} role="alert">{error}</p>}

        {!plan && !error && <p className={styles.waiting}>Loading the check…</p>}

        {plan && (
          <>
            {/* Where it is. The one thing this page exists to say. */}
            <section className={styles.state}>
              <span className={`${styles.dot} ${settled ? styles.dotDone : styles.dotLive}`} aria-hidden="true" />
              <div className={styles.stateText}>
                <p className={styles.stateLine}>{whereItIs(status, holder)}</p>
                {!settled && <p className={styles.stateNote}>This page follows it. Nothing for you to do.</p>}
              </div>
            </section>

            <dl className={styles.facts}>
              {incident?.number && (
                <div>
                  <dt>Incident</dt>
                  <dd className={styles.mono}>{incident.number}</dd>
                </div>
              )}
              {holder && (
                <div>
                  <dt>With</dt>
                  <dd>{holder}</dd>
                </div>
              )}
              {plan?.plan?.submittedAt && (
                <div>
                  <dt>Sent</dt>
                  <dd>{when(plan.plan.submittedAt)}</dd>
                </div>
              )}
              {plan?.summary?.decidable != null && (
                <div>
                  <dt>Differences</dt>
                  <dd>{plan.summary.decidable}</dd>
                </div>
              )}
            </dl>

            {/* What has happened to it, newest first. Nothing invented: a
                check nobody has decided on yet simply has none. */}
            {decisions.length > 0 && (
              <section className={styles.log}>
                <h2 className={styles.logHead}>What happened</h2>
                <ul>
                  {[...decisions].reverse().map((d, i) => (
                    <li key={`${d.stage || 'step'}-${i}`}>
                      <span className={styles.logWhat}>
                        {d.decision === 'approved' ? 'Approved'
                          : d.decision === 'rejected' ? 'Rejected'
                            : d.decision === 'rework' ? 'Sent back'
                              : String(d.decision || 'Decided')}
                      </span>
                      <span className={styles.logWho}>
                        {[d.approver, when(d.at || d.decidedAt)].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className={styles.ways}>
              {rackId && (
                <button
                  type="button"
                  className={styles.way}
                  onClick={() => navigate(`/results/${encodeURIComponent(rackId)}/drift`)}
                >
                  <Icon name="chevron_right" className={styles.wayChev} />
                  Open the rack&apos;s drift check
                </button>
              )}
              {/* Only the people who decide are sent to the Desk. A technician
                  has everything above and nothing to do there. */}
              {(can?.admin || can?.spoc) && (
                <ExternalLink className={styles.way} href={driftCheckUrl(planId)}>
                  <Icon name="chevron_right" className={styles.wayChev} />
                  Open it in Drift Desk
                </ExternalLink>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
