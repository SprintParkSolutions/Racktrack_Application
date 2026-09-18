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
 * until somebody says so, one device at a time. A device's ports follow it:
 * they are listed under it, never asked about on their own.
 *
 * The admin assigns before they decide (docs/design/drift-approval-workflow.md).
 * A pending row has one action - hand it to whoever looks after the rack, or
 * hand the whole rack over in one move. Approve and Reject appear only once
 * that person has resolved the ticket and the finding is back. The server
 * enforces the same order: it refuses approve or reject on an item whose
 * ticket is not resolved, per item ({ uid, why: 'assign first' }), and that
 * answer is shown beside the item it is about.
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
 *
 * A write that only partly went in leaves the plan in 'write_failed', with
 * what was and was not written. The same export, called again, is the retry.
 */

const ACTION_WORD = {
  create: 'Add to NetBox',
  update: 'Change in NetBox',
  rebind: "Rebind to this rack's record",
};

const DECISION_LABEL = {
  pending: 'Waiting on you',
  approved: 'Approved',
  rejected: 'Rejected',
  ticketed: 'With somebody',
};

const PLAN_WORD = {
  applied: 'Written to NetBox',
  write_failed: 'Write failed',
};

/** The server's reasons for refusing a decision, in plain words. */
const REFUSED_WORD = {
  'assign first': 'Assign it to somebody first. Approve and reject open once their ticket is resolved.',
};
const refusedWords = (why) => REFUSED_WORD[why] || (why ? `Not accepted: ${why}` : 'Not accepted.');

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
const asList = (v) => (Array.isArray(v) ? v : []);
const asCount = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What the write could not do, one line per object, named as the plan names it. */
function failedLines(result, items) {
  // The server names each failure in result.failures; result.failed may be a count.
  const source = Array.isArray(result?.failures) && result.failures.length ? result.failures : result?.failed;
  return asList(source).map((f, i) => {
    const entry = f && typeof f === 'object' ? f : { uid: String(f) };
    const it = items.find((x) => x.uid === entry.uid) || {};
    const type = entry.type || it.type || '';
    const name = entry.name || it.name || entry.uid || `object ${i + 1}`;
    const why = entry.error || entry.why || entry.reason || '';
    return {
      key: entry.uid || `${name}-${i}`,
      what: [type, name].filter(Boolean).join(' '),
      why: typeof why === 'string' ? why : JSON.stringify(why),
    };
  });
}

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
  const [openPorts, setOpenPorts] = useState(() => new Set());
  // What the server would not accept on the last decide call, by item uid.
  const [refused, setRefused] = useState({});

  const items = plan?.items || [];
  const decidable = useMemo(() => items.filter((i) => i.decidable), [items]);
  const supporting = useMemo(
    () => items.filter((i) => i.supporting && ['create', 'update', 'rebind'].includes(i.action)),
    [items],
  );
  // A device's ports, by the device uid. A port that names a parent and is
  // not a decision of its own follows that device. With no parentUid from
  // the server the map stays empty and nothing is shown.
  const portsOf = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      if (!i.parentUid || i.decidable) continue;
      if (!m.has(i.parentUid)) m.set(i.parentUid, []);
      m.get(i.parentUid).push(i);
    }
    return m;
  }, [items]);
  const pending = decidable.filter((i) => i.decision === 'pending');
  const settled = pending.length === 0;
  // Once the write has run nothing is decided again: applied is done, and a
  // failed write is retried, not re-decided.
  const deciding = !!plan && plan.status !== 'applied' && plan.status !== 'write_failed';
  const writeFailed = plan?.status === 'write_failed';
  const failed = writeFailed ? failedLines(plan.result, items) : [];
  const writtenCount = writeFailed ? asCount(plan.result?.written) : 0;
  const failedCount = writeFailed
    ? (asCount(plan.result?.failed) || Number(plan.result?.counts?.fail) || 0) : 0;

  const togglePorts = (uid) => setOpenPorts((s) => {
    const n = new Set(s);
    if (n.has(uid)) n.delete(uid); else n.add(uid);
    return n;
  });

  /** Adopt the rack, compare it, and file the result as a plan. */
  const load = useCallback(async () => {
    setBusy('Comparing against NetBox');
    setError('');
    setRefused({});
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
      // Per item, beside the item it is about. A later call that is
      // accepted clears it.
      const map = {};
      for (const x of out.refused || []) if (x && x.uid) map[x.uid] = x.why || '';
      setRefused(map);
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

  /** The write, and the retry: the same call on a plan whose write failed. */
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
      // Part of it did not go in: the plan says which, once refreshed.
      setWritten(out.status === 'write_failed' ? null : out);
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
  // The whole rack in one move: the server turns '*' into every item still
  // waiting, raises one incident for the rack and sends one email.
  const WHOLE_RACK = { uid: '*', type: 'Rack', name: rackId, wholeRack: true };

  const spoc = people?.spoc;
  const roster = useMemo(() => {
    const seen = new Set();
    return [spoc, ...(people?.others || []), ...(people?.everyone || [])]
      .filter(Boolean)
      .filter((p) => (seen.has(p.name) ? false : seen.add(p.name)));
  }, [people, spoc]);

  const counts = written ? (written.result?.counts || written.counts || {}) : {};

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
          {PLAN_WORD[plan.status] && (
            <span className={writeFailed ? styles.pillBad : styles.pillOk} data-testid="plan-state">
              {PLAN_WORD[plan.status]}
            </span>
          )}
          <span className={pending.length ? styles.pillWait : styles.pillOk}>
            {pending.length} waiting on you
          </span>
          <span className={styles.pill}>{plan.summary?.approved ?? 0} approved</span>
          <span className={styles.pill}>{plan.summary?.ticketed ?? 0} with somebody</span>
          <span className={styles.pill}>{plan.summary?.rejected ?? 0} rejected</span>
          {plan.summary?.following > 0 && (
            <span className={styles.pillQuiet}>{plan.summary.following} ports follow their devices</span>
          )}
          <span className={styles.pillQuiet}>{supporting.length} applied automatically</span>
        </div>
      )}

      {writeFailed && (
        // The write ran and only part of it went in. Say what did not, in
        // the plan's own words for each object, and offer the same write again.
        <div className={styles.failed} role="alert" data-testid="write-failed">
          <h2>The write to NetBox did not finish</h2>
          <p>
            {plural(writtenCount, 'object')} written, {plural(failedCount, 'object')} not written.
            {' '}Nothing was deleted. Fix the cause, then try the write again; it is the same write.
          </p>
          {failed.length > 0 && (
            <ul className={styles.failedList}>
              {failed.map((l) => (
                <li key={l.key}>
                  <span className={styles.failedWhat}>{l.what}</span>
                  {l.why && <span className={styles.failedWhy}>{l.why}</span>}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={styles.primary} disabled={!!busy} onClick={write}>
            Try the write again
          </button>
        </div>
      )}

      {deciding && pending.length > 1 && (
        <div className={styles.rackAsk}>
          <button type="button" className={styles.rackAskBtn} disabled={!!busy}
                  onClick={() => openTicketDialog(WHOLE_RACK)}>
            Assign the whole rack
          </button>
          <p className={styles.rackAskNote}>
            Hands all {pending.length} waiting items to one person, as one ticket.
          </p>
          {refused['*'] && <p className={styles.refused} role="alert">{refusedWords(refused['*'])}</p>}
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
            {counts.create || 0} added, {counts.update || 0} changed,
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
          const ports = portsOf.get(item.uid) || [];
          // The count from the port rows, or the device's own count when the
          // server gives one and the rows are not in the plan.
          const follow = ports.length || (typeof item.following === 'number' ? item.following : 0);
          // Approve and Reject open only once the ticket is resolved. Until
          // then the one move is to assign, or assign again.
          const resolved = item.ticket?.status === 'resolved';
          const canAct = deciding && item.decision === 'pending';
          // A rebind only re-labels a record NetBox already holds. It cannot be
          // assigned (the server refuses: there is nothing to check at the
          // rack), so it is the one item the admin approves or rejects as is.
          const isRebind = item.action === 'rebind';
          const why = refused[item.uid];
          return (
            <li key={item.uid} className={`${styles.item} ${styles[item.decision] || ''}`} data-testid={`item-${item.uid}`}>
              <div className={styles.itemTop}>
                <span className={styles.type}>{item.type}</span>
                <strong className={styles.name}>{item.name}</strong>
                <span className={styles.action}>{ACTION_WORD[item.action] || item.action}</span>
                <span className={styles.state}>{DECISION_LABEL[item.decision] || item.decision}</span>
              </div>

              {follow > 0 && (
                <div className={styles.follow}>
                  {ports.length > 0 ? (
                    <button type="button" className={styles.followBtn}
                            aria-expanded={openPorts.has(item.uid)}
                            onClick={() => togglePorts(item.uid)}>
                      {openPorts.has(item.uid) ? 'Hide' : 'Show'} - {plural(follow, 'port')} follow this device
                    </button>
                  ) : (
                    <span className={styles.followNote}>{plural(follow, 'port')} follow this device</span>
                  )}
                  {openPorts.has(item.uid) && ports.length > 0 && (
                    <ul className={styles.ports}>
                      {ports.map((p) => (
                        <li key={p.uid} className={styles.port}>
                          <span className={styles.portName}>{p.name}</span>
                          <span className={styles.portWhat}>{ACTION_WORD[p.action] || p.action}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

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
                    {resolved ? 'Came back from' : 'With'} {item.ticket.assignee}
                    {item.ticket.scope === 'rack' ? ' - whole rack' : ''}
                  </span>
                  {item.ticket.assigneeEmail && (
                    <span className={styles.ticketMail}>{item.ticket.assigneeEmail}</span>
                  )}
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
                  {item.ticket.status === 'open' && (
                    <p className={styles.q}>Waiting on them to check the rack and report back.</p>
                  )}
                  {resolved && (
                    <p className={styles.q}>
                      A resolved ticket is not an approval. Decide now, with their finding in hand.
                    </p>
                  )}
                </div>
              )}

              {canAct && isRebind && (
                <p className={styles.rebindNote}>
                  Already in NetBox under this rack&rsquo;s previous id. Approving only re-labels it, so there is nothing to check at the rack.
                </p>
              )}
              {canAct && !resolved && !isRebind && (
                // The admin does not judge the rack from a desk. The first and
                // only move on a waiting item is to hand it to somebody; the
                // server refuses anything else until the ticket is resolved.
                <div className={styles.actions}>
                  <button type="button" className={styles.ticketBtn}
                          disabled={!!busy} onClick={() => openTicketDialog(item)}>
                    {item.ticket ? 'Assign again' : 'Assign to somebody'}
                  </button>
                </div>
              )}
              {canAct && (resolved || isRebind) && (
                // It has come back from the person who looked, or it is a rebind
                // that nobody needs to look at. Now the admin decides.
                <div className={styles.actions}>
                  <button type="button" className={styles.approve}
                          disabled={!!busy} onClick={() => decide(item.uid, 'approved')}>
                    Approve
                  </button>
                  <button type="button" className={styles.reject}
                          disabled={!!busy}
                          onClick={() => {
                            const note = window.prompt('Why is this wrong?');
                            if (note !== null) decide(item.uid, 'rejected', { note });
                          }}>
                    Reject
                  </button>
                  {!isRebind && (
                    <button type="button" className={styles.ticketBtn}
                            disabled={!!busy} onClick={() => openTicketDialog(item)}>
                      Assign again
                    </button>
                  )}
                </div>
              )}
              {why !== undefined && (
                // The server said no to the last decision on this item.
                <p className={styles.refused} role="alert">{refusedWords(why)}</p>
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

      {plan && decidable.length > 0 && deciding && (
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
        <div className={styles.sheetWrap} role="dialog" aria-label="Assign to somebody">
          <div className={styles.sheet}>
            <h2 className={styles.sheetTitle}>
              {ticketFor.wholeRack ? 'Assign the whole rack' : 'Assign to somebody'}
            </h2>
            <p className={styles.sheetSub}>
              {ticketFor.wholeRack
                ? `Rack ${rackId} - all ${pending.length} items still waiting, as one ticket`
                : <>{ticketFor.type} “{ticketFor.name}”</>}
            </p>

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

            <label className={styles.label} htmlFor="question">What should they check?</label>
            <textarea id="question" className={styles.textarea} value={question}
                      placeholder={ticketFor.wholeRack ? 'Please check everything in this rack.' : 'Is it really at U15?'}
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
