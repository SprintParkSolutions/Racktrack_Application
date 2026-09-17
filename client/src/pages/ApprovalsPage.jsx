import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/BackButton.jsx';
import { apiUrl, authFetch } from '../utils/api';
import { useSmartBack } from '../hooks/useSmartBack';
import styles from './ApprovalsPage.module.css';

/**
 * Approvals: the admin's screen.
 *
 * Everything a scan would change is listed here, and nothing reaches NetBox
 * until somebody says so item by item. Three ways out of every row - approve
 * it, reject it with a reason, or hand it to whoever looks after the rack.
 *
 * Two things on this screen are load-bearing and easy to miss.
 *
 *   The plan has a FINGERPRINT. Approving is a signature on that exact list,
 *   not on "whatever the differences are now". Just before writing, the server
 *   compares again; if NetBox moved in between, nothing is written and a fresh
 *   plan comes back. That refusal is shown here in full rather than swallowed.
 *
 *   A resolved ticket is NOT an approval. It comes back to this screen as
 *   undecided, carrying what the person found, and the admin decides again.
 */

const ACTION_WORD = { create: 'Add to NetBox', update: 'Change in NetBox' };

const DECISION_LABEL = {
  pending: 'Waiting on you',
  approved: 'Approved',
  rejected: 'Rejected',
  ticketed: 'With somebody',
};

/** "position 14 → 15", in words rather than JSON. */
function diffLines(diff) {
  if (!diff) return [];
  return Object.entries(diff).map(([field, v]) => ({
    field,
    from: v && typeof v === 'object' && 'from' in v ? v.from : null,
    to: v && typeof v === 'object' && 'to' in v ? v.to : v,
  }));
}

const show = (v) => (v === null || v === undefined || v === '' ? ' - ' : String(v));

export default function ApprovalsPage() {
  const { rackId } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack(`/results/${rackId}/report`);

  const [scanId, setScanId] = useState(null);
  const [plan, setPlan] = useState(null);
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState('Loading');
  const [error, setError] = useState('');
  const [drift, setDrift] = useState(null);      // NetBox moved under us
  const [written, setWritten] = useState(null);
  const [ticketFor, setTicketFor] = useState(null);
  const [question, setQuestion] = useState('');
  const [assignee, setAssignee] = useState('');

  const items = plan?.items || [];
  const decidable = useMemo(() => items.filter((i) => i.decidable), [items]);
  const supporting = useMemo(
    () => items.filter((i) => i.supporting && (i.action === 'create' || i.action === 'update')),
    [items],
  );
  const pending = decidable.filter((i) => i.decision === 'pending');
  const settled = pending.length === 0;

  /** Adopt the rack, compare it, and file the result as a plan. */
  const load = useCallback(async () => {
    setBusy('Comparing against NetBox');
    setError('');
    try {
      const a = await authFetch(apiUrl(`/api/nb/scans/adopt/${encodeURIComponent(rackId)}`),
        { method: 'POST' });
      const adopted = await a.json();
      if (!a.ok) throw new Error(adopted.error || 'Could not open this rack');
      setScanId(adopted.id);

      const p = await authFetch(apiUrl(`/api/nb/netbox/${adopted.id}/preview`), { method: 'POST' });
      const report = await p.json();
      if (!p.ok) throw new Error(report.error || 'Could not compare against NetBox');

      const full = await authFetch(apiUrl(`/api/nb/plans/${report.planId}`));
      setPlan(await full.json());

      const c = await authFetch(apiUrl(`/api/nb/plans/${report.planId}/contacts`));
      if (c.ok) setPeople(await c.json());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  }, [rackId]);

  useEffect(() => { load(); }, [load]);

  const refresh = async (planId) => {
    const r = await authFetch(apiUrl(`/api/nb/plans/${planId}`));
    if (r.ok) setPlan(await r.json());
  };

  async function decide(uid, decision, extra = {}) {
    setBusy(decision === 'ticketed' ? 'Raising the ticket' : 'Saving');
    setError('');
    try {
      const r = await authFetch(apiUrl(`/api/nb/plans/${plan.id}/decide`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: [{ uid, decision, ...extra }] }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'That did not go through');
      if (out.refused?.length) setError(out.refused[0].why);
      await refresh(plan.id);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
      setTicketFor(null);
      setQuestion('');
      setAssignee('');
    }
  }

  async function write() {
    setBusy('Checking NetBox has not moved');
    setError('');
    setDrift(null);
    try {
      const r = await authFetch(apiUrl(`/api/nb/netbox/${scanId}/export`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.id }),
      });
      const out = await r.json();
      if (r.status === 409 && out.newPlanId) { setDrift(out); return; }
      if (!r.ok) throw new Error(out.error || 'The write did not go through');
      setWritten(out);
      await refresh(plan.id);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  }

  const openTicketDialog = (item) => {
    setTicketFor(item);
    setAssignee(people?.spoc?.name || '');
    setQuestion('');
  };

  const spoc = people?.spoc;
  const roster = useMemo(() => {
    const seen = new Set();
    return [spoc, ...(people?.others || []), ...(people?.everyone || [])]
      .filter(Boolean)
      .filter((p) => (seen.has(p.name) ? false : seen.add(p.name)));
  }, [people, spoc]);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={goBack} aria-label="Back">
          <BackIcon />
        </button>
        <div>
          <h1 className={styles.title}>Approvals</h1>
          <p className={styles.sub}>
            {plan
              ? <>Plan {plan.id} · {rackId} · <span className={styles.fp}>{plan.fingerprint?.slice(0, 12)}</span></>
              : rackId}
          </p>
        </div>
      </header>

      {busy && <p className={styles.busy}>{busy}…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {plan && (
        <div className={styles.summary}>
          <span className={pending.length ? styles.pillWait : styles.pillOk}>
            {pending.length} waiting on you
          </span>
          <span className={styles.pill}>{plan.summary?.approved ?? 0} approved</span>
          <span className={styles.pill}>{plan.summary?.ticketed ?? 0} with somebody</span>
          <span className={styles.pill}>{plan.summary?.rejected ?? 0} rejected</span>
          <span className={styles.pillQuiet}>{supporting.length} applied automatically</span>
        </div>
      )}

      {spoc && (
        <div className={styles.spoc}>
          <span className={styles.spocTag}>Single point of contact</span>
          <strong>{spoc.name}</strong>
          {spoc.title && <span className={styles.spocRole}>{spoc.title}</span>}
          {spoc.email && <a className={styles.spocMail} href={`mailto:${spoc.email}`}>{spoc.email}</a>}
          <span className={styles.spocVia}>from NetBox, on the {spoc.via}</span>
        </div>
      )}
      {people && !spoc && (
        <p className={styles.warnRow}>
          No single point of contact is set for this rack in NetBox
          {people.why ? ` - ${people.why}` : ''}. A ticket can still be raised and assigned by hand.
        </p>
      )}
      {people && people.serviceNow === false && (
        <p className={styles.warnRow}>
          No ServiceNow is configured, so tickets will live only in RackTrack.
        </p>
      )}

      {drift && (
        <div className={styles.drift} role="alert">
          <h2>Nothing was written</h2>
          <p>NetBox changed after this plan was approved, so the write stopped rather than
             overwrite somebody else&rsquo;s edit.</p>
          <p className={styles.driftFp}>
            approved {drift.approvedFingerprint?.slice(0, 12)} · now {drift.currentFingerprint?.slice(0, 12)}
          </p>
          <button type="button" className={styles.primary} onClick={load}>
            Compare again
          </button>
        </div>
      )}

      {written && (
        <div className={styles.done}>
          <h2>Written to NetBox</h2>
          <p>
            {written.counts?.create || 0} added, {written.counts?.update || 0} changed,
            {' '}{written.withheld || 0} held back. Nothing was deleted.
          </p>
          <button type="button" className={styles.linkBtn} onClick={() => navigate(`/results/${rackId}/report`)}>
            Back to the report
          </button>
        </div>
      )}

      <ul className={styles.list}>
        {decidable.map((item) => {
          const lines = diffLines(item.diff);
          const ext = item.ticket?.external;
          return (
            <li key={item.uid} className={`${styles.item} ${styles[item.decision] || ''}`}>
              <div className={styles.itemTop}>
                <span className={styles.type}>{item.type}</span>
                <strong className={styles.name}>{item.name}</strong>
                <span className={styles.action}>{ACTION_WORD[item.action] || item.action}</span>
                <span className={styles.state}>{DECISION_LABEL[item.decision] || item.decision}</span>
              </div>

              {lines.length > 0 && (
                <ul className={styles.diff}>
                  {lines.map((l) => (
                    <li key={l.field}>
                      <span className={styles.field}>{l.field}</span>
                      <span className={styles.from}>{show(l.from)}</span>
                      <span className={styles.arrow}>→</span>
                      <span className={styles.to}>{show(l.to)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {item.ticket && (
                <div className={styles.ticket}>
                  <span className={styles.ticketTag}>
                    {item.ticket.status === 'resolved' ? 'Came back' : 'With'} {item.ticket.assignee}
                  </span>
                  {item.ticket.question && <p className={styles.q}>{item.ticket.question}</p>}
                  {item.ticket.finding && (
                    <p className={styles.finding}>They found: {item.ticket.finding}</p>
                  )}
                  {ext?.url && (
                    <a className={styles.snLink} href={ext.url} target="_blank" rel="noreferrer">
                      Open {ext.number} in ServiceNow
                      {ext.reopened ? ' (reopened)' : ext.reused ? ' (already open)' : ''}
                    </a>
                  )}
                  {ext?.error && <p className={styles.snErr}>ServiceNow: {ext.error}</p>}
                  {ext?.system === 'none' && <p className={styles.snErr}>{ext.why}</p>}
                  {item.ticket.status === 'resolved' && (
                    <p className={styles.q}>
                      A resolved ticket is not an approval. Decide again below.
                    </p>
                  )}
                </div>
              )}

              {item.decision !== 'approved' && plan.status !== 'applied' && (
                <div className={styles.actions}>
                  <button type="button" className={styles.approve}
                          disabled={!!busy} onClick={() => decide(item.uid, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className={styles.ticketBtn}
                          disabled={!!busy} onClick={() => openTicketDialog(item)}>
                    Ask somebody
                  </button>
                  <button type="button" className={styles.reject}
                          disabled={!!busy}
                          onClick={() => {
                            const note = window.prompt('Why is this wrong?');
                            if (note !== null) decide(item.uid, 'rejected', { note });
                          }}>
                    Reject
                  </button>
                </div>
              )}
              {item.note && <p className={styles.note}>“{item.note}” - {item.decidedBy}</p>}
            </li>
          );
        })}
      </ul>

      {plan && !decidable.length && !busy && (
        <p className={styles.empty}>
          Nothing to decide. NetBox already matches what this scan found.
        </p>
      )}

      {plan && decidable.length > 0 && plan.status !== 'applied' && (
        <div className={styles.footer}>
          <button type="button" className={styles.primary} disabled={!settled || !!busy} onClick={write}>
            {settled ? 'Write the approved changes to NetBox' : `${pending.length} still waiting on you`}
          </button>
          <p className={styles.footNote}>
            NetBox is compared once more before anything is written.
          </p>
        </div>
      )}

      {ticketFor && (
        <div className={styles.sheetWrap} role="dialog" aria-label="Ask somebody to check">
          <div className={styles.sheet}>
            <h2 className={styles.sheetTitle}>Ask somebody to check</h2>
            <p className={styles.sheetSub}>{ticketFor.type} “{ticketFor.name}”</p>

            <label className={styles.label} htmlFor="assignee">Who</label>
            <select id="assignee" className={styles.select} value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Choose a person</option>
              {roster.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.name === spoc?.name ? ' - single point of contact' : ''}
                  {p.title ? ` (${p.title})` : ''}
                </option>
              ))}
            </select>

            <label className={styles.label} htmlFor="question">What do you want them to check?</label>
            <textarea id="question" className={styles.textarea} value={question}
                      placeholder="Is it really at U15?"
                      onChange={(e) => setQuestion(e.target.value)} />

            <p className={styles.sheetNote}>
              {people?.serviceNow
                ? 'This raises an incident in ServiceNow and assigns it to them by email.'
                : 'No ServiceNow is configured, so this ticket stays in RackTrack.'}
            </p>

            <div className={styles.sheetActions}>
              <button type="button" className={styles.linkBtn} onClick={() => setTicketFor(null)}>
                Cancel
              </button>
              <button type="button" className={styles.primary} disabled={!assignee || !!busy}
                      onClick={() => decide(ticketFor.uid, 'ticketed', { assignee, note: question })}>
                Raise it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
