import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BackIcon } from '../components/BackButton.jsx';
import { apiUrl, authFetch } from '../utils/api';
import { useSmartBack } from '../hooks/useSmartBack';
import ExternalLink from '../components/ExternalLink.jsx';
import { driftCheckUrl } from '../utils/approvals.js';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
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
  create: 'Not in your records',
  update: 'Different from your records',
  rebind: 'Listed under an older id',
};

// What each of those means, in one plain sentence. The short word is the
// headline; this is the line under it; anything longer sits behind Read more.
const MEANS = {
  create: 'We saw this in the rack, but your records do not list it on this shelf.',
  update: 'Your records list this, but some details are different.',
  rebind: 'Your records list this under an id RackTrack used before.',
};

// "Router U20 SP-HYB-RM01-R01-R1" is how the comparison names a box. A person
// standing at the rack already knows which rack it is, so the rack's name comes
// off the end and the shelf is said in words.
function plainName(name, rackName) {
  let out = String(name || '');
  if (rackName && out.endsWith(rackName)) out = out.slice(0, -rackName.length).trim();
  const m = out.match(/^(.+?)\s+U(\d{1,2})$/);
  return m ? `${m[1]} on shelf U${Number(m[2])}` : out;
}

// What becomes of a check after it is sent, in the order it happens. The person
// who walked to the rack used to read "Waiting on them" and nothing else until
// the record changed; this is the same line the admin watches, in their words.
const TRACK = [
  { key: 'sent', label: 'Sent', at: ['submitted', 'triage'] },
  { key: 'assigned', label: 'Assigned', at: ['assigned', 'accepted'] },
  { key: 'started', label: 'Started', at: ['in_progress', 'pending'] },
  { key: 'resolved', label: 'Resolved', at: ['resolved', 'verification_pending'] },
  { key: 'verified', label: 'Verified', at: ['approval_pending'] },
  { key: 'approved', label: 'Approved', at: ['approved', 'write_in_progress'] },
  { key: 'written', label: 'Written to NetBox', at: ['written', 'completed'] },
];
const OFF_TRACK = {
  rejected: 'The admin rejected this check.',
  rework: 'The admin sent this back to be checked again.',
  cancelled: 'This check was cancelled.',
  duplicate: 'This was the same as another check, so it was closed.',
  known_exception: 'This is a known exception, so nothing needs to change.',
  write_failed: 'NetBox refused part of the write. The admin is looking at it.',
  manual_review: 'The write is with a person to finish by hand.',
  reopened: 'This check was opened again.',
};

// RackTrack's own bookkeeping, not a difference between the rack and the
// record. When a person has said which record a rack is, the plan carries one
// more line: write RackTrack's id onto that record so the next scan finds it
// at once. The record itself is untouched - its name, site, height and shelves
// stay exactly as the customer has them - and NetBox had no id there to begin
// with. The owner opened this screen and read "1 thing does not match" over a
// rack that matched in every way that matters, with two internal keys under
// it; that line is a note now, and it is never counted.
const isHousekeeping = (item) => item.action === 'rebind' && !item.fromUid;

// Fields that carry RackTrack's own keys. They are how the app finds a record
// again, not something a person saw on the rack, so they are never shown.
const INTERNAL_FIELDS = new Set(['racktrack_uid', 'racktrack_bound', 'recordId']);

const STATE_WORD = {
  pending: 'Waiting on the admin',
  approved: 'Approved',
  rejected: 'Rejected',
  ticketed: 'Someone is checking',
};

// How this rack was found, in the words of the thing that found it. The app
// tries a code or label on the switches, then the rack's own record, then where
// it stands, then the print on the rack, then what is inside it, and last of all
// it asks a person. Whichever one answers, the person reads the answer, never
// the step number.
const FOUND_BY = {
  record: 'Confirmed: this rack is tied to that record.',
  label: 'Matched by the label read off the rack.',
  'label-netbox': 'Matched by the label read off the rack, against NetBox.',
  devices: 'Matched by the devices inside it.',
  'only-rack': 'Matched to the only rack set up in this room.',
};

// And how sure that leaves it. A record is the strongest answer there is and the
// sentence above already says so; anything read off a rack can be misread, and
// the screen says that rather than letting a reading pass for a confirmation.
const HOW_SURE = {
  probable: 'Probable, not confirmed.',
  possible: 'Possible only.',
};

// The same steps when they fall short of deciding. A suggestion is a question
// for a person and is never worded as a match.
const FITS_BY = {
  label: 'The label read off the rack matches this one.',
  'label-netbox': 'The label read off the rack matches this rack in NetBox.',
  devices: 'Most of the devices read here sit in this rack.',
  'only-rack': 'It is the only rack set up in this room.',
};

function diffLines(diff) {
  if (!diff) return [];
  return Object.entries(diff)
    .filter(([field]) => !INTERNAL_FIELDS.has(field))
    .map(([field, v]) => ({
      field,
      from: v && typeof v === 'object' && 'from' in v ? v.from : null,
      to: v && typeof v === 'object' && 'to' in v ? v.to : v,
    }));
}

const show = (v) => (v === null || v === undefined || v === '' ? ' - ' : String(v));

/**
 * Where a sent check has got to: seven steps, the one it is on marked, and under
 * it what is known - who holds it, the ServiceNow incident, what they found.
 * Falls back to "Sent" when the workflow cannot be read, which is still true.
 */
function Progress({ flow, rackName }) {
  const status = flow?.plan?.status || 'submitted';
  const at = TRACK.findIndex((t) => t.at.includes(status));
  const tickets = flow?.tickets || [];
  const items = flow?.items || [];
  const nameOf = (uid) => plainName((items.find((i) => i.uid === uid) || {}).name || uid, rackName);
  return (
    <div className={styles.progress}>
      <ol className={styles.steps} aria-label="Progress of this check">
        {TRACK.map((t, i) => (
          <li key={t.key} className={`${styles.step} ${at >= 0 && i < at ? styles.stepDone : ''} ${i === at ? styles.stepNow : ''}`}
              aria-current={i === at ? 'step' : undefined}>
            <span className={styles.stepDot} aria-hidden="true" />
            <span className={styles.stepLabel}>{t.label}</span>
          </li>
        ))}
      </ol>
      {at === -1 && OFF_TRACK[status] && <p className={styles.offTrack}>{OFF_TRACK[status]}</p>}
      {status === 'pending' && <p className={styles.offTrack}>On hold{flow?.plan?.pendingReason ? `: ${String(flow.plan.pendingReason).replace(/_/g, ' ')}` : ''}.</p>}
      {at === 0 && <p className={styles.trackNote}>The admin has it and will assign it to somebody.</p>}
      {tickets.length > 0 && (
        <ul className={styles.tickets}>
          {tickets.map((t) => (
            <li key={t.itemUid}>
              <b>{nameOf(t.itemUid)}</b>
              <span>
                {t.assignee ? `With ${t.assignee}` : 'Not assigned yet'}
                {t.external?.number ? ` - ${t.external.number}` : ''}
                {t.status ? ` - ${String(t.status).replace(/_/g, ' ')}` : ''}
              </span>
              {t.finding && <span className={styles.found}>They found: {t.finding}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DriftPage() {
  const { rackId } = useParams();
  const goBack = useSmartBack(`/results/${rackId}/report`);

  const [plan, setPlan] = useState(null);
  const [spoc, setSpoc] = useState(null);
  const [matched, setMatched] = useState(null);
  const [recordRack, setRecordRack] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [pickError, setPickError] = useState('');
  const [busy, setBusy] = useState('Checking this rack against NetBox');
  const [error, setError] = useState('');
  const [needsSource, setNeedsSource] = useState(false);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  // Which differences go to the admin. Everything, until the person says otherwise.
  const [left, setLeft] = useState(() => new Set());
  // The same check as the approval workflow holds it: its status and its tickets.
  const [flow, setFlow] = useState(null);
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
  const changed = useMemo(() => items.filter((i) => i.decidable && !isHousekeeping(i)), [items]);
  const housekeeping = useMemo(() => items.some(isHousekeeping), [items]);

  // The whole comparison, so the screen can say how much of the rack agrees and
  // not only what does not. A box the scan saw on the shelf where the record has
  // one is a match, and the record's own name for it is shown beside it; what
  // the record holds that the photograph did not show is listed last, because a
  // cable manager behind a wall of cables is expected and a missing switch is not.
  const orphans = plan?.orphans || [];
  const matching = useMemo(() => {
    const byBox = new Map(orphans.filter((o) => o.seen && o.matchedBox).map((o) => [o.matchedBox, o]));
    const differs = new Set(changed.map((i) => i.uid));
    return items
      .filter((i) => i.type === 'Device' && !differs.has(i.uid))
      .map((i) => ({ item: i, record: byBox.get(i.uid) || null }))
      .filter((m) => m.record || m.item.netboxId != null || ['noop', 'rebind'].includes(m.item.action));
  }, [items, orphans, changed]);
  const notSeen = useMemo(() => orphans.filter((o) => !o.seen), [orphans]);

  // The drift report: one printable page of this comparison, to send or to
  // attach to the incident. Opened with a short-lived link, because the app's
  // own sign-in does not travel to the browser it opens in.
  const [reportBusy, setReportBusy] = useState(false);
  const openReport = async () => {
    if (!plan?.id) return;
    setReportBusy(true);
    try {
      const r = await authFetch(apiUrl(`/api/scan/${encodeURIComponent(rackId)}/report-token`));
      const { token } = r.ok ? await r.json() : {};
      const url = apiUrl(`/api/scan/${encodeURIComponent(rackId)}/drift-report?plan=${plan.id}${token ? `&t=${encodeURIComponent(token)}` : ''}`);
      const full = /^https?:/.test(url) ? url : `${window.location.origin}${url}`;
      if (Capacitor.isNativePlatform()) await Browser.open({ url: full });
      else window.open(full, '_blank', 'noopener');
    } catch (e) {
      setError(e.message || 'The drift report could not be opened');
    } finally {
      setReportBusy(false);
    }
  };
  // What is ticked to go: everything that differs, less what the person unticked.
  const picked = useMemo(() => changed.filter((i) => !left.has(i.uid)), [changed, left]);
  const toggle = (uid) => setLeft((prev) => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  const toggleAll = () => setLeft(picked.length === changed.length ? new Set(changed.map((i) => i.uid)) : new Set());

  const load = useCallback(async () => {
    setBusy('Checking this rack against NetBox');
    setError('');
    setPickError('');
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
      if (c.ok) {
        const body = await c.json();
        setSpoc(body.spoc);
        // Which rack in the customer's record this was compared against, and
        // why the app believes it is the same rack. The server has always
        // worked this out; the screen used to take the contact off it and drop
        // the rest, so the one question a person asks of a comparison - "the
        // same rack as what?" - had no answer anywhere in the app.
        setMatched(body.matchedRack || null);
        setRecordRack(body.rack || null);
      }

      // Which rack this is, and how that was worked out: the rack, the step that
      // found it, and the short list of racks it could be when no step can
      // decide. A failure here is not a failure of the check, so the line below
      // falls back to what the comparison itself used.
      try {
        const who = await authFetch(apiUrl(`/api/scan/${encodeURIComponent(rackId)}/identity`));
        setIdentity(who.ok ? await who.json() : null);
      } catch { setIdentity(null); }

      const nm = await authFetch(apiUrl(`/api/nb/scans/rack/${encodeURIComponent(rackId)}/name`));
      if (nm.ok) { const j = await nm.json(); setName(j.name || ''); setNameSaved(j.name || ''); }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  }, [rackId]);

  useEffect(() => { load(); }, [load]);

  // Which rack this was compared against. Where the app has decided which rack
  // this is, the comparison is built on that rack, so the line names it and says
  // what found it. Where it has not, the line falls back to whatever the
  // comparison itself resolved, and claims nothing beyond it.
  const compared = matched && matched.confidence !== 'none' ? matched : null;
  const decided = identity && identity.decision === 'matched' && identity.rack ? identity : null;
  const foundBy = decided
    ? [FOUND_BY[decided.rule] || 'Matched to a rack in the record.', HOW_SURE[decided.confidence]]
      .filter(Boolean).join(' ')
    : '';

  // How the rack was matched, for whoever opens Read more: what was read off
  // the rack, where the photo was taken, and the reason the app itself gave for
  // each rack it considered. Only what the server said; nothing is inferred here.
  const matchedHow = useMemo(() => {
    if (!identity) return [];
    const out = [];
    const ev = identity.evidence || {};
    const labels = (ev.labels || []).map((l) => `${l.normalized || l.text}${l.conf != null ? ` (${Math.round(l.conf * 100)}% sure)` : ''}`);
    out.push(labels.length ? `Label read off the rack: ${labels.join(', ')}.` : 'No label was read off the rack in this photo.');
    if (ev.location && ev.location.verdict === 'here' && ev.location.site) out.push(`The phone was at ${ev.location.site} when the photo was taken.`);
    else if (ev.location && ev.location.verdict && ev.location.verdict !== 'unknown' && ev.location.site) out.push(`The phone was not at ${ev.location.site} when the photo was taken.`);
    else out.push('The phone gave no location with this photo.');
    for (const c of (identity.candidates || []).slice(0, 2)) {
      for (const why of (c.reasons || [])) {
        const line = `${c.facilityId || c.name}: ${why}`;
        out.push(line.endsWith('.') ? line : `${line}.`);
      }
    }
    return out;
  }, [identity]);

  // Nothing decided which rack this is, so a person still has to.
  const unsettled = !!identity && identity.decision !== 'matched';
  // Where the photo was taken, as the rack ladder judged it (lib/location.js).
  const where = identity && identity.evidence ? identity.evidence.location : null;

  // What is still open, said plainly. Only ever shown when nothing was decided.
  const stillOpen = useMemo(() => {
    if (!unsettled) return '';
    if (identity.decision === 'new') {
      return 'This rack is not in the record yet. Everything here reads as new.';
    }
    if (identity.decision === 'ambiguous') {
      return 'More than one rack fits what was read here. Nobody has confirmed which.';
    }
    if (identity.decision === 'suggested') {
      return `${FITS_BY[identity.rule] || 'One rack fits what was read here.'} Nobody has confirmed it.`;
    }
    return 'Nothing read here says which rack this is.';
  }, [identity, unsettled]);

  // The racks a person may choose from: the ones the app narrowed it down to,
  // never the whole site. Two or three, in the order they were ranked.
  const shortlist = useMemo(() => {
    if (!unsettled) return [];
    return (identity.candidates || []).filter((c) => c && (c.name || c.facilityId)).slice(0, 3);
  }, [identity, unsettled]);
  // Not in the record at all: the rack is added rather than forced onto a bad
  // match. Offered only with a name that was actually read off the rack.
  const newName = unsettled && identity.decision === 'new' ? (identity.proposal?.name || '') : '';

  /** A person says which rack this is. The check then runs again against it. */
  async function pick(choice) {
    setPickError('');
    setBusy('Saving which rack this is');
    try {
      const r = await authFetch(apiUrl(`/api/scan/${encodeURIComponent(rackId)}/identity/confirm`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choice),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error || 'That rack could not be saved');
      await load();
    } catch (e) {
      setPickError(e.message || String(e));
      setBusy('');
    }
  }

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
        // Everything, unless some were unticked: then the ones that stay ticked.
        body: JSON.stringify(left.size ? { note, items: picked.map((i) => i.uid) } : { note }),
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

  // After it is sent the check is followed, not just waited on: asked again
  // every twenty seconds while this screen is open, so a technician standing at
  // the rack sees "Assigned" turn into "Started" without pulling anything.
  useEffect(() => {
    if (!sent || !plan?.id) return undefined;
    let dropped = false;
    const ask = async () => {
      try {
        const r = await authFetch(apiUrl(`/api/approvals/plans/${plan.id}`));
        if (!dropped && r.ok) setFlow(await r.json());
      } catch { /* the line simply shows what is already known */ }
    };
    ask();
    const t = setInterval(ask, 20000);
    return () => { dropped = true; clearInterval(t); };
  }, [sent, plan?.id]);

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
        {/* The title and nothing under it. The rack is named once, just below,
            in the line that says what it was compared against; the scan's own
            id is a hash of the photograph and tells the person nothing. */}
        <h1 className={styles.title} title={rackId}>Drift check</h1>
      </header>

      {/* A name typed by hand is the fallback for a rack nothing has identified.
          Once the app has said which rack this is, the box only invited people
          to type over an answer that was already right. */}
      {!decided && !busy && plan && (
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
          {nameSaved ? 'Saved.' : 'Leave blank to keep the current name.'}
        </span>
      </div>
      )}

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
              Ask your administrator to connect NetBox or ServiceNow.
            </p>
          )}
        </div>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {/* Compared against WHAT, and how that was worked out. One line, on the
          screen that makes the claim. A comparison a person cannot trace to a
          named record in the customer's own database is an assertion, not a
          check - and a rack nobody has confirmed is never called a match. Where
          it cannot be decided, the racks it could be are offered here and a
          person chooses; that choice is what the next check compares against. */}
      {plan && !busy && (
        <div className={styles.against}>
          <span className={styles.againstLabel}>Rack</span>
          {decided ? (
            <>
              <strong className={styles.againstName}>
                {decided.rack.name || decided.rack.facilityId
                  || (compared && compared.name) || 'this rack'}
              </strong>
              <span className={styles.againstWhy}>
                {decided.confidence === 'confirmed'
                  ? 'This is the rack in your records.'
                  : 'This looks like the rack in your records. Not confirmed yet.'}
                {where && where.verdict === 'here' && where.site ? ` Photo taken at ${where.site}.` : ''}
              </span>
              <details className={styles.more}>
                <summary>Read more</summary>
                <span className={styles.moreLabel}>Compared against</span>
                <span className={styles.againstWhy}>{foundBy}</span>
                <span className={styles.moreLabel}>How it was matched</span>
                <ul className={styles.how}>
                  {matchedHow.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </details>
            </>
          ) : compared ? (
            <>
              <strong className={styles.againstName}>
                {compared.name || (recordRack && recordRack.name) || 'this rack'}
              </strong>
              <span className={styles.againstWhy}>Compared with this rack in your records.</span>
              <details className={styles.more}>
                <summary>Read more</summary>
                <span className={styles.moreLabel}>Compared against</span>
                <span className={styles.againstWhy}>{compared.why}</span>
              </details>
            </>
          ) : (
            <>
              <strong className={styles.againstName}>Not identified yet</strong>
              {/* Only where nothing has said which rack this is. Where something
                  has, it says it once, below, and this does not say it twice. */}
              {!stillOpen && (
                <span className={styles.againstWhy}>
                  This rack has not been set up in the record, so everything here reads as new.
                  Set it up to compare against what is already written down.
                </span>
              )}
            </>
          )}

          {stillOpen && <span className={styles.againstOpen}>{stillOpen}</span>}

          {/* Where the photo was taken, when the phone said. Said only when it
              tells somebody something: at this Site, at another one, or far
              from any. "No location" is not worth a line. */}
          {/* Where the photo was taken matters when it was somewhere else, and
              is said without the metres: the distance is the app's working. */}
          {where && where.verdict !== 'unknown' && !(decided && where.verdict === 'here') && (
            <span className={where.verdict === 'here' ? styles.againstWhy : styles.againstOpen}
              data-testid="taken-at">
              {where.verdict === 'here'
                ? `Photo taken at ${where.site || 'this site'}.`
                : `This photo was not taken at ${where.site || 'the site this rack belongs to'}.`}
            </span>
          )}

          {!sent && (shortlist.length > 0 || newName) && (
            <div className={styles.pick}>
              <span className={styles.pickLabel}>Which rack is this?</span>
              <div className={styles.pickRow}>
                {shortlist.map((c) => (
                  <button
                    key={`${c.source}-${c.id}`}
                    type="button"
                    className={styles.pickBtn}
                    disabled={!!busy}
                    onClick={() => pick(c.source === 'netbox' ? { netboxRackId: c.id } : { knownRackId: c.id })}
                  >
                    {c.name || c.facilityId}
                  </button>
                ))}
                {newName && (
                  <button
                    type="button"
                    className={styles.pickBtn}
                    disabled={!!busy}
                    onClick={() => pick({ name: newName })}
                  >
                    Add {newName} to the record
                  </button>
                )}
              </div>
              <span className={styles.pickNote}>
                The next check compares against the rack you choose.
              </span>
              {pickError && <p className={styles.pickError} role="alert">{pickError}</p>}
            </div>
          )}
        </div>
      )}

      {plan && !busy && (
        <div className={styles.verdict}>
          {changed.length === 0 ? (
            <>
              <h2><span className={styles.tick} aria-hidden="true">✓</span>Everything matches your records</h2>
              <p>Compared with NetBox just now. Nothing to send.</p>
              {housekeeping && (
                <details className={styles.more}>
                  <summary>Read more</summary>
                  <span className={styles.againstWhy}>
                    RackTrack will note its own id on the record the next time an admin writes, so the next scan finds this rack at once. Nothing else on the record changes.
                  </span>
                </details>
              )}
            </>
          ) : (
            <>
              {/* Nothing was compared when the record holds no such rack, so
                  calling the count a mismatch is not true: those are the boxes
                  this scan would ADD. The owner read "9 things do not match" on
                  a rack the screen had just said was not in the record at all. */}
              <h2>
                {compared
                  ? `${changed.length} ${changed.length === 1 ? 'thing is' : 'things are'} different from your records`
                  : `${changed.length} ${changed.length === 1 ? 'thing' : 'things'} would be added`}
              </h2>
              <p>
                {compared
                  ? 'Compared with NetBox just now. Send it to your admin to check.'
                  : 'Your records do not have this rack yet, so everything in this photo would be new.'}
              </p>
            </>
          )}
        </div>
      )}

      {/* The rack at a glance: how much agrees, how much does not, and what the
          record holds that the photograph did not show. */}
      {plan && !busy && compared && (
        <div className={styles.glance} role="group" aria-label="Summary of the comparison">
          <div><b className={styles.gOk}>{matching.length}</b><span>match</span></div>
          <div><b className={changed.length ? styles.gWarn : undefined}>{changed.length}</b><span>different</span></div>
          <div><b>{notSeen.length}</b><span>not seen</span></div>
        </div>
      )}

      {/* Who it goes to, when the record names somebody. Where it names nobody
          there is nothing to say: the admin chooses, as the admin always may,
          and a sentence about a missing contact read as a fault with the rack. */}
      {plan && !busy && changed.length > 0 && !sent && spoc && (
        <div className={styles.goesTo}>
          <span className={styles.goesToLabel}>Goes to</span>
          <strong className={styles.goesToName}>{spoc.name}</strong>
          {spoc.title && <span className={styles.goesToRole}>{spoc.title}</span>}
          {spoc.email && <span className={styles.goesToMail}>{spoc.email}</span>}
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
            {plan?.submittedBy ? `You sent this on ${new Date(plan.submittedAt).toLocaleString()}.` : 'It is with the admin now.'}
          </p>
          <Progress flow={flow} rackName={decided && (decided.rack.name || decided.rack.facilityId)} />
          {track}
        </div>
      )}

      {plan && !busy && changed.length > 0 && (
        <h3 className={styles.group}>Different from your records <span>{changed.length}</span></h3>
      )}

      {plan && !busy && !sent && changed.length > 1 && (
        <label className={styles.pickAll}>
          <input type="checkbox" checked={picked.length === changed.length}
                 ref={(el) => { if (el) el.indeterminate = picked.length > 0 && picked.length < changed.length; }}
                 onChange={toggleAll} />
          <span>{picked.length === changed.length ? 'All selected' : `${picked.length} of ${changed.length} selected`}</span>
        </label>
      )}

      <ul className={styles.list}>
        {changed.map((item) => {
          const lines = diffLines(item.diff);
          const ext = item.ticket?.external;
          return (
            <li key={item.uid} className={`${styles.item} ${styles[item.decision] || ''}`}>
              <div className={styles.itemTop}>
                {!sent && changed.length > 1 && (
                  <input type="checkbox" className={styles.pickOne} checked={!left.has(item.uid)}
                         aria-label={`Send ${plainName(item.name, decided && (decided.rack.name || decided.rack.facilityId))}`}
                         onChange={() => toggle(item.uid)} />
                )}
                <strong className={styles.name}>
                  {plainName(item.name, decided && (decided.rack.name || decided.rack.facilityId))}
                </strong>
                <span className={styles.what}>{WORD[item.action] || item.action}</span>
              </div>
              {MEANS[item.action] && <p className={styles.means}>{MEANS[item.action]}</p>}

              <details className={styles.more}>
                <summary>Read more</summary>
                <span className={styles.againstWhy}>
                  {item.type}: {item.name}
                </span>
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
                {item.reason && <span className={styles.againstWhy}>{item.reason}</span>}
              </details>

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

      {/* What agrees, and what the record holds that was not seen. Closed by
          default: the differences are the job, and these are the context. */}
      {plan && !busy && compared && matching.length > 0 && (
        <details className={styles.groupBox}>
          <summary><span>Matching your records</span><b>{matching.length}</b></summary>
          <ul className={styles.rows}>
            {matching.map(({ item, record }) => (
              <li key={item.uid}>
                <span className={styles.rowName}>{plainName(item.name, decided && (decided.rack.name || decided.rack.facilityId))}</span>
                <span className={styles.rowNote}>{record ? record.name : 'In your records'}</span>
                <span className={styles.dotOk} aria-label="matches" />
              </li>
            ))}
          </ul>
        </details>
      )}
      {plan && !busy && compared && notSeen.length > 0 && (
        <details className={styles.groupBox}>
          <summary><span>In your records, not seen in the photo</span><b>{notSeen.length}</b></summary>
          <p className={styles.groupNote}>
            Often behind cables, or with no face to read. Nothing is removed from your records.
          </p>
          <ul className={styles.rows}>
            {notSeen.map((o) => (
              <li key={o.netboxId ?? o.name}>
                <span className={styles.rowName}>{o.name}</span>
                <span className={styles.rowNote}>{o.position != null ? `Shelf U${o.position}` : 'No shelf recorded'}</span>
                <span className={styles.dotIdle} aria-label="not seen" />
              </li>
            ))}
          </ul>
        </details>
      )}

      {plan && !busy && compared && (
        <div className={styles.reportRow}>
          <button type="button" className={styles.secondaryBtn} onClick={openReport} disabled={reportBusy}>
            {reportBusy ? 'Opening the report' : 'Drift report'}
          </button>
          <span className={styles.reportHint}>One page of this comparison, to send or attach to the incident.</span>
        </div>
      )}

      {plan && changed.length > 0 && !sent && (
        <div className={styles.footer}>
          <label className={styles.label} htmlFor="note">
            Note for the admin (optional)
          </label>
          <textarea id="note" className={styles.textarea} value={note}
                    placeholder="For example: the router is on shelf U20"
                    onChange={(e) => setNote(e.target.value)} />
          <button type="button" className={styles.primary} disabled={!!busy || picked.length === 0} onClick={send}>
            {picked.length === changed.length ? 'Send to the admin'
              : picked.length === 0 ? 'Choose at least one to send'
                : `Send ${picked.length} of ${changed.length} to the admin`}
          </button>
        </div>
      )}
    </div>
  );
}
