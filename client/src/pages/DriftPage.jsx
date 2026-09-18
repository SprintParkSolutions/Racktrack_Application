import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/BackButton.jsx';
import { apiUrl, authFetch } from '../utils/api';
import { useSmartBack } from '../hooks/useSmartBack';
import ExternalLink from '../components/ExternalLink.jsx';
import { driftCheckUrl } from '../utils/approvals.js';
import styles from './DriftPage.module.css';

/**
 * Drift check: the technician's screen.
 *
 * The person standing at the rack is not the person who changes the record, so
 * this screen deliberately has no write button and never says "export". It
 * answers one question - does the rack match what NetBox says - and then hands
 * the answer to an admin.
 *
 * After it is sent, this page becomes the technician's window on what happened
 * next: which items an admin approved, which went out as tickets, which came
 * back, and whether the record was updated in the end. Somebody who walks a
 * rack deserves to know whether their work landed.
 *
 * The admin's side is not in this app. It is RackTrack Approvals, on the
 * own address, and once a check is sent this page links to that check there.
 */

const WORD = {
  create: 'Not in NetBox',
  update: 'Different in NetBox',
  rebind: "In NetBox under this rack's old id",
};

const STATE_WORD = {
  pending: 'Waiting on the admin',
  approved: 'Approved',
  rejected: 'Rejected',
  ticketed: 'Someone is checking',
};

function diffLines(diff) {
  if (!diff) return [];
  return Object.entries(diff).map(([field, v]) => ({
    field,
    from: v && typeof v === 'object' && 'from' in v ? v.from : null,
    to: v && typeof v === 'object' && 'to' in v ? v.to : v,
  }));
}

const show = (v) => (v === null || v === undefined || v === '' ? ' - ' : String(v));

export default function DriftPage() {
  const { rackId } = useParams();
  const goBack = useSmartBack(`/results/${rackId}/report`);

  const [plan, setPlan] = useState(null);
  const [spoc, setSpoc] = useState(null);
  const [busy, setBusy] = useState('Checking this rack against NetBox');
  const [error, setError] = useState('');
  const [needsSource, setNeedsSource] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [name, setName] = useState('');   // the person's name for this rack
  const [nameSaved, setNameSaved] = useState('');

  const navigate = useNavigate();
  // Who may connect a record system: the owner and an organization admin. A
  // technician is told who to ask instead. The role is read from the stored
  // session rather than the auth context, so this page keeps working wherever
  // it is mounted, and an unreadable store simply means "not an admin".
  const canConnect = useMemo(() => {
    try {
      const role = JSON.parse(localStorage.getItem('rt_authUser') || '{}')?.role;
      return role === 'owner' || role === 'org_admin';
    } catch { return false; }
  }, []);

  const items = plan?.items || [];
  const changed = useMemo(() => items.filter((i) => i.decidable), [items]);
  const auto = useMemo(
    () => items.filter((i) => i.supporting && ['create', 'update', 'rebind'].includes(i.action)),
    [items],
  );

  const load = useCallback(async () => {
    setBusy('Checking this rack against NetBox');
    setError('');
    setNeedsSource(false);
    try {
      const a = await authFetch(apiUrl(`/api/nb/scans/adopt/${encodeURIComponent(rackId)}`),
        { method: 'POST' });
      const adopted = await a.json();
      if (!a.ok) throw new Error(adopted.error || 'Could not open this rack');

      const p = await authFetch(apiUrl(`/api/nb/netbox/${adopted.id}/preview`), { method: 'POST' });
      const report = await p.json();
      if (!p.ok) {
        // No record system connected yet. That is not a failure of the check,
        // it is a thing somebody has to set up, so say who and offer the way
        // there rather than a red line the technician can do nothing about.
        if (report.hint || /no netbox connection/i.test(String(report.error || ''))) {
          setNeedsSource(true);
          return;
        }
        throw new Error(report.error || 'Could not reach NetBox');
      }

      const full = await authFetch(apiUrl(`/api/nb/plans/${report.planId}`));
      const body = await full.json();
      setPlan(body);
      setSent(body.status === 'submitted' || body.status === 'applied');

      const c = await authFetch(apiUrl(`/api/nb/plans/${report.planId}/contacts`));
      if (c.ok) setSpoc((await c.json()).spoc);

      const nm = await authFetch(apiUrl(`/api/nb/scans/rack/${encodeURIComponent(rackId)}/name`));
      if (nm.ok) { const j = await nm.json(); setName(j.name || ''); setNameSaved(j.name || ''); }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  }, [rackId]);

  useEffect(() => { load(); }, [load]);

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed === nameSaved) return;
    try {
      const r = await authFetch(apiUrl(`/api/nb/scans/rack/${encodeURIComponent(rackId)}/name`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (r.ok) setNameSaved(trimmed);
    } catch { /* a name is a convenience; a failure here is not worth a red banner */ }
  }

  async function send() {
    setBusy('Sending it to the admin');
    setError('');
    try {
      const r = await authFetch(apiUrl(`/api/nb/plans/${plan.id}/submit`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'That did not go through');
      setSent(true);
      const full = await authFetch(apiUrl(`/api/nb/plans/${plan.id}`));
      if (full.ok) setPlan(await full.json());
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  }

  const applied = plan?.status === 'applied';
  // The same check, in RackTrack Approvals. Offered only once it has been sent.
  const track = plan ? (
    <ExternalLink className={styles.track} href={driftCheckUrl(plan.id)}>
      Track this check
    </ExternalLink>
  ) : null;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={goBack} aria-label="Back">
          <BackIcon />
        </button>
        <div>
          <h1 className={styles.title}>Drift check</h1>
          <p className={styles.sub}>{rackId}</p>
        </div>
      </header>

      <div className={styles.nameRow}>
        <label className={styles.nameLabel} htmlFor="rackname">Rack name (optional)</label>
        <input
          id="rackname"
          className={styles.nameInput}
          value={name}
          placeholder={rackId}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
        />
        <span className={styles.nameHint}>
          {nameSaved ? 'Saved. Edit any time.' : 'Leave blank to keep the generated id.'}
        </span>
      </div>

      {busy && <p className={styles.busy}>{busy}…</p>}

      {needsSource && !busy && (
        <div className={styles.needsSource}>
          <h2>No record to check against yet</h2>
          {canConnect ? (
            <>
              <p>
                Connect NetBox or ServiceNow under Data sources, then run this check again.
              </p>
              <button type="button" className={styles.connect} onClick={() => navigate('/connections')}>
                Go to Data sources
              </button>
            </>
          ) : (
            <p>
              Ask your administrator to add NetBox or ServiceNow under Data sources.
              The check works as soon as one is connected.
            </p>
          )}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {plan && !busy && (
        <div className={styles.verdict}>
          {changed.length === 0 ? (
            <>
              <span className={styles.tick}>✓</span>
              <h2>This rack matches NetBox</h2>
              <p>Nothing here disagrees with the record. There is nothing to send.</p>
            </>
          ) : (
            <>
              <h2>{changed.length} {changed.length === 1 ? 'thing does' : 'things do'} not match</h2>
              <p>
                Checked against NetBox just now.
                {auto.length > 0 && ` ${auto.length} supporting ${auto.length === 1 ? 'record' : 'records'} would be created automatically.`}
              </p>
            </>
          )}
        </div>
      )}

      {plan && !busy && changed.length > 0 && !sent && (
        <div className={styles.goesTo}>
          {spoc ? (
            <>
              <span className={styles.goesToLabel}>Goes to</span>
              <strong className={styles.goesToName}>{spoc.name}</strong>
              {spoc.title && <span className={styles.goesToRole}>{spoc.title}</span>}
              {spoc.email && <span className={styles.goesToMail}>{spoc.email}</span>}
              <p className={styles.goesToNote}>
                The rack&rsquo;s single point of contact, from NetBox. The admin can still pick someone else.
              </p>
            </>
          ) : (
            <p className={styles.goesToNote}>
              NetBox names no single point of contact for this rack, so the admin will choose who checks it.
            </p>
          )}
        </div>
      )}

      {applied && (
        <div className={styles.done}>
          <h2>The record has been updated</h2>
          <p>An admin approved this and wrote it to NetBox. Nothing more is needed from you.</p>
          {track}
        </div>
      )}

      {sent && !applied && (
        <div className={styles.waiting}>
          <h2>Sent to the admin</h2>
          <p>
            {plan?.submittedBy ? `You sent this on ${new Date(plan.submittedAt).toLocaleString()}.` : 'Waiting on them.'}
            {' '}They decide what reaches NetBox. Nothing has been written.
          </p>
          {spoc && (
            <p className={styles.spoc}>
              Anything they cannot judge goes to <strong>{spoc.name}</strong>
              {spoc.email ? ` (${spoc.email})` : ''}.
            </p>
          )}
          {track}
        </div>
      )}

      <ul className={styles.list}>
        {changed.map((item) => {
          const lines = diffLines(item.diff);
          const ext = item.ticket?.external;
          return (
            <li key={item.uid} className={`${styles.item} ${styles[item.decision] || ''}`}>
              <div className={styles.itemTop}>
                <span className={styles.type}>{item.type}</span>
                <strong className={styles.name}>{item.name}</strong>
                <span className={styles.what}>{WORD[item.action] || item.action}</span>
              </div>

              {lines.length > 0 && (
                <ul className={styles.diff}>
                  {lines.map((l) => (
                    <li key={l.field}>
                      <span className={styles.field}>{l.field}</span>
                      <span className={styles.from}>NetBox says {show(l.from)}</span>
                      <span className={styles.to}>you saw {show(l.to)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {sent && (
                <p className={styles.state}>
                  {STATE_WORD[item.decision] || item.decision}
                  {item.ticket?.assignee && item.decision === 'ticketed' && ` - ${item.ticket.assignee}`}
                  {ext?.number && ` · ${ext.number}${ext.state ? ` (${ext.state})` : ''}`}
                  {item.note && ` - “${item.note}”`}
                </p>
              )}
              {item.ticket?.finding && (
                <p className={styles.finding}>They found: {item.ticket.finding}</p>
              )}
            </li>
          );
        })}
      </ul>

      {plan && changed.length > 0 && !sent && (
        <div className={styles.footer}>
          <label className={styles.label} htmlFor="note">
            Anything the admin should know? (optional)
          </label>
          <textarea id="note" className={styles.textarea} value={note}
                    placeholder="U15 looked wrong to me"
                    onChange={(e) => setNote(e.target.value)} />
          <button type="button" className={styles.primary} disabled={!!busy} onClick={send}>
            Send to the admin
          </button>
          <p className={styles.footNote}>
            You are not changing NetBox. An admin decides what gets written.
          </p>
        </div>
      )}
    </div>
  );
}
