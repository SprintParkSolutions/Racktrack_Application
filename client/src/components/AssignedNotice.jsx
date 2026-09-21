import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { apiUrl, authFetch } from '../utils/api';
import { openApprovals, openDriftReport } from '../utils/approvals';
import styles from './AssignedNotice.module.css';

/* ──────────────────────────────────────────────────────────────────────
   "Something has been assigned to you."

   The notice already existed, but only inside RackTrack Drift Desk, under a
   bell - and the person it is for is a technician, who lives in this app and
   never opens that one unprompted. So it is shown here, where the app opens,
   and it is a guide rather than a message: what was asked, by whom, about which
   rack, and a button for each thing they can do about it.

   The words come from the server (lib/approvals/notify.js), so the email, the
   Drift Desk inbox and this card all say the same thing.

   It is no longer only the assignment. A check goes straight to the site's
   SPOC, so the same banner tells the SPOC it is theirs, tells the person who
   sent it what became of it, and tells an admin when a check needs them. One
   banner, the newest notice in it, and a count of the rest.
   ────────────────────────────────────────────────────────────────────── */

const POLL_MS = 60_000;
const URL_RE = /https?:\/\/[^\s]+/g;
// A scan nobody has identified is known only by the hash of its photograph. The
// server words that properly now; a notice written before it did still carries
// the hash, so it is put into words here too.
const HASH_RE = /\brack RK-[0-9A-F]{6,}\b/gi;
const inWords = (text) => String(text || '').replace(HASH_RE, 'a rack that has not been identified yet');

// What each notice is about, by the server's own word for it (`data.kind`). A
// row written before notices carried `data` has only its event, so the event
// names the kind instead. Anything not listed here is not this banner's business.
const KIND_OF_EVENT = {
  assigned: 'assigned',
  approved: 'approved',
  rejected: 'rejected',
  completed: 'written',
  write_failed: 'write_failed',
  reassign_needed: 'needs_admin',
  incident_failed: 'incident',
  reassigned: 'reassigned',
};
const LABEL = {
  assigned: 'Assigned to you',
  approved: 'Your check was approved',
  rejected: 'Your check was rejected',
  rework: 'Your check was sent back',
  written: 'Written to NetBox',
  write_failed: 'A write did not finish',
  needs_admin: 'Needs an admin',
  incident: 'ServiceNow needs a look',
  reassigned: 'Given to somebody else',
};
// Where "Open the check" goes. Somebody who has to act on a check does that in
// Drift Desk; the person who sent it follows it on their own Drift check screen.
const IN_DESK = new Set(['assigned', 'needs_admin', 'write_failed', 'incident']);
const IN_APP = new Set(['approved', 'rejected', 'rework', 'written']);

/** `data` as an object, whatever came: an object, a JSON string, or nothing. */
function dataOf(row) {
  const d = row && row.data;
  if (d && typeof d === 'object') return d;
  if (typeof d === 'string') { try { return JSON.parse(d) || {}; } catch { return {}; } }
  return null;
}
const kindOf = (row) => {
  const kind = (dataOf(row) || {}).kind;
  return LABEL[kind] ? kind : KIND_OF_EVENT[row.event];
};
const newestFirst = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || (Number(b.id) || 0) - (Number(a.id) || 0);

/**
 * A notice, taken apart for a small screen.
 *
 *   lead     the one sentence that says what was asked - always shown
 *   details  what to check, the question, the incident numbers - one tap away
 *   steps    what to do about it - with the details
 *   url      the first address in it, which becomes a button; an address is
 *            never printed, however many the message carried
 *
 * It used to show everything. A whole rack handed over is ten items and as many
 * incidents, and the notice then covered the entire Scan screen with a list and
 * a bare ServiceNow address - the owner asked why a technician was seeing that.
 */
export function splitBody(body) {
  const raw = inWords(body);
  const url = (raw.match(URL_RE) || [])[0] || null;
  const text = raw
    .replace(/^Hello [^\n]*\n+/, '')            // the greeting is for the email
    .replace(/\n+- RackTrack\s*$/, '')          // so is the signature
    .replace(/\nPlan \d+ - [^\n]*\n?/, '\n')   // and the plan's one-line status
    .replace(URL_RE, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const at = text.indexOf('What to do:');
  const before = (at >= 0 ? text.slice(0, at) : text).trim();
  const cut = before.indexOf('\n');
  return {
    lead: (cut >= 0 ? before.slice(0, cut) : before).trim(),
    details: (cut >= 0 ? before.slice(cut) : '').trim(),
    steps: at >= 0 ? text.slice(at).replace(/^What to do:\s*/, '').trim() : '',
    url,
  };
}

export default function AssignedNotice() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await authFetch(apiUrl('/api/approvals/notifications?unread=1'));
      if (!r.ok) return;
      const j = await r.json();
      setRows((j.notifications || []).filter((n) => KIND_OF_EVENT[n.event] && !n.readAt).sort(newestFirst));
    } catch { /* no notice is not an error worth showing */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  const top = rows[0] || null;
  const parts = useMemo(() => (top ? splitBody(top.body) : null), [top]);
  // Each notice opens closed: what was open belonged to the one before it.
  useEffect(() => { setOpen(false); setFailed(''); }, [top?.id]);
  if (!top || !parts) return null;

  const data = dataOf(top);
  const kind = kindOf(top);
  const planId = top.planId ?? data?.planId ?? null;
  const rackId = data?.rackId || null;
  // The incident's address comes with the notice. A notice written before it
  // did carries the address only in its words, so the first one there is used.
  const found = data?.incidentUrl || parts.url;
  const incidentUrl = /^https?:\/\//.test(String(found || '')) ? found : null;
  const hasCheck = planId != null && (IN_DESK.has(kind) || IN_APP.has(kind));

  const markRead = async () => {
    setBusy(true);
    try { await authFetch(apiUrl(`/api/approvals/notifications/${top.id}/read`), { method: 'POST' }); } catch { /* it will simply show again */ }
    setRows((list) => list.filter((n) => n.id !== top.id));
    setBusy(false);
  };
  const openCheck = async () => {
    if (IN_APP.has(kind) && rackId) { navigate(`/results/${encodeURIComponent(rackId)}/drift`); return; }
    // The SPOC reads the drift report beside the check, so it opens on it.
    await openApprovals(`/approvals/drifts/${encodeURIComponent(planId)}${kind === 'assigned' ? '?view=report' : ''}`);
  };
  const openReport = async () => {
    setFailed('');
    try { await openDriftReport(rackId, planId); } catch { setFailed('The drift report could not be opened.'); }
  };
  const openIncident = (e) => {
    if (!Capacitor.isNativePlatform()) return;          // the anchor opens a tab on the web
    e.preventDefault();
    Browser.open({ url: incidentUrl }).catch(() => {});
  };

  return (
    <section className={styles.notice} aria-label={LABEL[kind]}>
      <div className={styles.top}>
        <span className={styles.label}>{LABEL[kind]}</span>
        {rows.length > 1 && <span className={styles.more}>and {rows.length - 1} more</span>}
      </div>
      <h2 className={styles.title}>{inWords(top.subject).replace(/^(Assigned to you|RackTrack):\s*/i, '').replace(/^./, (c) => c.toUpperCase())}</h2>
      <p className={`${styles.body} ${open ? '' : styles.short}`}>{parts.lead}</p>

      {/* A button and a chevron, not the platform's own disclosure marker, so it
          looks the same on every phone. */}
      {(parts.details || parts.steps) && (
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          Details<span className={styles.chevron} aria-hidden="true" />
        </button>
      )}
      {open && (
        <div className={styles.steps}>
          {parts.details && <p className={styles.body}>{parts.details}</p>}
          {parts.steps && (
            <>
              <span className={styles.subhead}>What to do</span>
              <p className={styles.body}>{parts.steps}</p>
            </>
          )}
        </div>
      )}

      {failed && <p className={styles.failed} role="alert">{failed}</p>}

      <div className={styles.actions}>
        {hasCheck && (
          <button type="button" className={styles.primary} onClick={openCheck}>Open the check</button>
        )}
        {hasCheck && rackId && (
          <button type="button" className={styles.secondary} onClick={openReport}>Drift report</button>
        )}
        {incidentUrl && (
          <a className={styles.secondary} href={incidentUrl} target="_blank" rel="noopener noreferrer" onClick={openIncident}>
            Open in ServiceNow
          </a>
        )}
        <button type="button" className={styles.quiet} onClick={markRead} disabled={busy}>Dismiss</button>
      </div>
    </section>
  );
}
