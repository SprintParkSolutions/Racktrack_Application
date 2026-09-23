import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import useModalA11y from '../hooks/useModalA11y.js';
import { apiUrl, authFetch } from '../utils/api';
import { announce } from '../utils/notify.js';
import Icon from './Icon';
import styles from './NoticesSheet.module.css';

/**
 * What is waiting for you to read, on the way in.
 *
 * The owner asked on 23 September 2026 for a bell beside the account mark on
 * Home, and for the notices to be there rather than somewhere else. So this
 * is a sheet over Home, not a page: a person opens it, reads what arrived,
 * presses one to go to the check it is about, and is back where they were.
 *
 * Every notice is the server's own - GET /api/approvals/notifications, the
 * same list the Desk's inbox reads - and belongs to the signed-in person:
 * the recipient is taken from the session and never from the request. An
 * account with no part in the approvals workflow is refused at the door,
 * which is not an error; the bell simply never lights.
 *
 * Opening one marks it read, the way a mail client does.
 */

/* Enough to fill a phone twice over. The rest are in the Desk, where the
   whole inbox lives. */
const LIMIT = 30;

/** The check a notice is about, if it is about one. */
export function planOf(n) {
  const data = n && n.data && typeof n.data === 'object' ? n.data : {};
  const id = data.planId ?? n?.planId ?? null;
  return id == null ? null : String(id);
}

/** A message with the parts that belong to an email taken off. */
export function bodyOf(body) {
  return String(body || '')
    .replace(/^Hello [^\n]*\n+/, '')
    .replace(/\n+- RackTrack\s*$/, '')
    .replace(/(https?:\/\/[^\s]+)/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** How long ago, in the words the rest of the app uses. */
export function when(d) {
  const t = d ? new Date(d).getTime() : 0;
  if (!t || Number.isNaN(t)) return '';
  const ms = Date.now() - t;
  if (ms < 60000) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

/* One request for everybody's unread count, shared by the bell and the sheet
   so opening the sheet does not ask twice.

   It asks again every so often, because a decision arrives while the person
   is holding the phone, not when they next open the app. Each answer goes to
   announce() (utils/notify.js), which makes a sound and posts a notification
   for anything that arrived since this device last looked - and stays silent
   on the first load and for anybody who has not said yes. */
const EVERY_MS = 45_000;

export function useNotices() {
  const [rows, setRows] = useState(null);
  const [unread, setUnread] = useState(0);
  const load = useCallback(() => {
    authFetch(apiUrl(`/api/approvals/notifications?limit=${LIMIT}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) { setRows([]); setUnread(0); return; }
        const list = Array.isArray(d.notifications) ? d.notifications : [];
        setRows(list);
        setUnread(Number(d.unread) || list.filter((n) => !n.readAt).length);
        announce(list);
      })
      .catch(() => { setRows([]); setUnread(0); });
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, EVERY_MS);
    /* A phone that was in a pocket asks the moment it is looked at again. */
    const onWake = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onWake);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onWake); };
  }, [load]);
  return { rows, unread, reload: load };
}

export default function NoticesSheet({ notices, onClose, onOpenCheck }) {
  const panel = useModalA11y(onClose);
  const { rows, unread, reload } = notices;
  const [busy, setBusy] = useState(false);

  const read = (id) => authFetch(apiUrl(`/api/approvals/notifications/${encodeURIComponent(id)}/read`), { method: 'POST' })
    .catch(() => { /* the list is re-read either way */ });

  const readAll = async () => {
    setBusy(true);
    try { await authFetch(apiUrl('/api/approvals/notifications/read-all'), { method: 'POST' }); }
    catch { /* nothing to tell them: the list says what happened */ }
    finally { setBusy(false); reload(); }
  };

  const open = async (n) => {
    if (!n.readAt) { await read(n.id); reload(); }
    const plan = planOf(n);
    if (plan && onOpenCheck) { onClose(); onOpenCheck(plan); }
  };

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <aside
        ref={panel}
        className={styles.tray}
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grab} aria-hidden="true" />
        <header className={styles.top}>
          <h2 className={styles.title}>Notifications</h2>
          {rows && rows.length > 0 && unread > 0 && (
            <button type="button" className={styles.all} onClick={readAll} disabled={busy}>
              {busy ? 'Marking' : 'Mark all read'}
            </button>
          )}
          <button type="button" className={styles.shut} onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        {rows === null && <p className={styles.quiet}>Reading what has arrived.</p>}
        {rows !== null && rows.length === 0 && (
          <p className={styles.quiet}>Nothing has arrived for you yet.</p>
        )}

        {rows !== null && rows.length > 0 && (
          <ul className={styles.list}>
            {rows.map((n) => {
              const line = bodyOf(n.body).split('\n').find((l) => l.trim()) || '';
              const plan = planOf(n);
              return (
                <li key={n.id} className={`${styles.item} ${n.readAt ? '' : styles.unread}`}>
                  <button type="button" className={styles.row} onClick={() => open(n)}>
                    <span className={styles.dot} aria-hidden="true" />
                    <span className={styles.text}>
                      <span className={styles.head}>
                        <b className={styles.subject}>{n.subject}</b>
                        <span className={styles.when}>{when(n.createdAt)}</span>
                      </span>
                      {line && <span className={styles.line}>{line}</span>}
                    </span>
                    {plan && <Icon name="chevron_right" className={styles.chev} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>,
    document.body,
  );
}
