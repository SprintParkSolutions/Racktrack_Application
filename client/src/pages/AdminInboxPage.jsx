import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackIcon } from '../components/BackButton.jsx';
import { apiUrl, authFetch } from '../utils/api';
import { useSmartBack } from '../hooks/useSmartBack';
import styles from './AdminInboxPage.module.css';

/**
 * The admin's inbox: drift checks a technician has handed over.
 *
 * Without this an admin would have to know a scan happened and go looking for
 * it, which means in practice it never gets looked at. Everything waiting is
 * here, oldest at the bottom, with enough on each row to decide whether it is
 * worth opening now.
 */

const when = (iso) => {
  if (!iso) return '';
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  return then.toLocaleDateString();
};

export default function AdminInboxPage() {
  const navigate = useNavigate();
  const goBack = useSmartBack('/scan');

  const [waiting, setWaiting] = useState([]);
  const [done, setDone] = useState([]);
  const [busy, setBusy] = useState('Loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy('Loading');
    setError('');
    try {
      const [w, a] = await Promise.all([
        authFetch(apiUrl('/api/nb/plans?status=submitted&limit=50')),
        authFetch(apiUrl('/api/nb/plans?status=applied&limit=10')),
      ]);
      if (!w.ok) throw new Error('Could not load what is waiting');
      setWaiting((await w.json()).plans || []);
      if (a.ok) setDone((await a.json()).plans || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = (p) => navigate(`/results/${encodeURIComponent(p.rackId)}/approvals`);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <button type="button" className={styles.back} onClick={goBack} aria-label="Back">
          <BackIcon />
        </button>
        <div>
          <h1 className={styles.title}>Waiting on you</h1>
          <p className={styles.sub}>
            {waiting.length
              ? `${waiting.length} drift ${waiting.length === 1 ? 'check' : 'checks'} sent by a technician`
              : 'Racks a technician has checked and handed over'}
          </p>
        </div>
        <button type="button" className={styles.refresh} onClick={load} disabled={!!busy}>
          Refresh
        </button>
      </header>

      {busy && <p className={styles.busy}>{busy}…</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}

      {!busy && !waiting.length && (
        <p className={styles.empty}>
          Nothing is waiting. When a technician checks a rack and sends it over, it appears here.
        </p>
      )}

      <ul className={styles.list}>
        {waiting.map((p) => {
          const s = p.summary || {};
          return (
            <li key={p.id}>
              <button type="button" className={styles.row} onClick={() => open(p)}>
                <div className={styles.rowTop}>
                  <strong className={styles.rack}>{p.rackId}</strong>
                  <span className={styles.ago}>{when(p.submittedAt || p.createdAt)}</span>
                </div>
                <p className={styles.by}>
                  Sent by {p.submittedBy || 'a technician'}
                </p>
                <div className={styles.counts}>
                  <span className={s.pending ? styles.wait : styles.quiet}>
                    {s.pending || 0} to decide
                  </span>
                  {s.openTickets > 0 && (
                    <span className={styles.ticket}>{s.openTickets} out with someone</span>
                  )}
                  {s.approved > 0 && <span className={styles.ok}>{s.approved} approved</span>}
                  {s.rejected > 0 && <span className={styles.no}>{s.rejected} rejected</span>}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {done.length > 0 && (
        <>
          <h2 className={styles.sectionTitle}>Already written</h2>
          <ul className={styles.list}>
            {done.map((p) => (
              <li key={p.id}>
                <button type="button" className={`${styles.row} ${styles.rowDone}`} onClick={() => open(p)}>
                  <div className={styles.rowTop}>
                    <strong className={styles.rack}>{p.rackId}</strong>
                    <span className={styles.ago}>{when(p.createdAt)}</span>
                  </div>
                  <p className={styles.by}>
                    {(p.summary || {}).approved || 0} written to NetBox
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
