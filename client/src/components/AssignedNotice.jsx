import { useCallback, useEffect, useMemo, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { apiUrl, authFetch } from '../utils/api';
import { openApprovals } from '../utils/approvals';
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
   ────────────────────────────────────────────────────────────────────── */

const POLL_MS = 60_000;
const URL_RE = /(https?:\/\/[^\s]+)/;

/** The part a person reads first, and the steps that follow it. */
export function splitBody(body) {
  const text = String(body || '')
    .replace(/^Hello [^\n]*\n+/, '')            // the greeting is for the email
    .replace(/\n+- RackTrack\s*$/, '')          // so is the signature
    .replace(/\nPlan \d+ - [^\n]*\n?/, '\n');   // and the plan's one-line status
  const url = (text.match(URL_RE) || [])[1] || null;
  const clean = text.replace(URL_RE, '').replace(/\n{3,}/g, '\n\n').trim();
  const at = clean.indexOf('What to do:');
  return {
    first: (at >= 0 ? clean.slice(0, at) : clean).trim(),
    steps: at >= 0 ? clean.slice(at).trim() : '',
    url,
  };
}

export default function AssignedNotice() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(apiUrl('/api/approvals/notifications?unread=1'));
      if (!r.ok) return;
      const j = await r.json();
      setRows((j.notifications || []).filter((n) => n.event === 'assigned' && !n.readAt));
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
  if (!top || !parts) return null;

  const markRead = async () => {
    setBusy(true);
    try { await authFetch(apiUrl(`/api/approvals/notifications/${top.id}/read`), { method: 'POST' }); } catch { /* it will simply show again */ }
    setRows((list) => list.filter((n) => n.id !== top.id));
    setBusy(false);
  };
  const openCheck = async () => {
    await openApprovals(`/approvals/drifts/${encodeURIComponent(top.planId)}`);
  };
  const openIncident = (e) => {
    if (!Capacitor.isNativePlatform()) return;          // the anchor opens a tab on the web
    e.preventDefault();
    Browser.open({ url: parts.url }).catch(() => {});
  };

  return (
    <section className={styles.notice} aria-label="Assigned to you">
      <div className={styles.top}>
        <span className={styles.label}>Assigned to you</span>
        {rows.length > 1 && <span className={styles.more}>and {rows.length - 1} more</span>}
      </div>
      <h2 className={styles.title}>{String(top.subject || '').replace(/^Assigned to you:\s*/i, '').replace(/^./, (c) => c.toUpperCase())}</h2>
      <p className={styles.body}>{parts.first}</p>

      {parts.steps && (
        <details className={styles.steps}>
          <summary>What to do</summary>
          <p className={styles.body}>{parts.steps.replace(/^What to do:\s*/, '')}</p>
        </details>
      )}

      <div className={styles.actions}>
        {top.planId != null && (
          <button type="button" className={styles.primary} onClick={openCheck}>Open the check</button>
        )}
        {parts.url && (
          <a className={styles.secondary} href={parts.url} target="_blank" rel="noopener noreferrer" onClick={openIncident}>
            Open in ServiceNow
          </a>
        )}
        <button type="button" className={styles.quiet} onClick={markRead} disabled={busy}>Dismiss</button>
      </div>
    </section>
  );
}
