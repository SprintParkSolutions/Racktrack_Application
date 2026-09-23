import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import Icon from '../components/Icon';
import styles from './TasksPage.module.css';

/**
 * What somebody has asked you to go and do.
 *
 * The product's first workflow starts at a rack: photograph it, compare it
 * against the records, send the differences. This is the second one the owner
 * described on 23 September 2026, and it starts at a ticket: somebody raises
 * one, it names a rack, and the person it went to has to go and look.
 *
 * So this page answers three things and nothing else:
 *
 *   what was asked     in the words of whoever asked it
 *   which rack         by name, and where it is
 *   what to do now     one control: photograph that rack
 *
 * The photograph is taken against the rack the ticket names, so what comes
 * back can be read against what the ticket claims rather than against the
 * whole of the records.
 */

/** A ticket, as the server hands it over. */
export function taskLines(t) {
  const where = [t.rackName || null, t.siteName || null].filter(Boolean).join(' · ');
  return {
    asked: t.summary || 'Look at this rack',
    where: where || 'Rack not named yet',
    from: t.raisedBy ? `Asked by ${t.raisedBy}` : 'Asked by an administrator',
    number: t.number || null,
  };
}

/** How long ago, in the words the rest of the app uses. */
export function since(iso, now = Date.now()) {
  if (!iso) return '';
  const then = new Date(String(iso).replace(' ', 'T') + (/[Z+]/.test(String(iso)) ? '' : 'Z')).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export default function TasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(apiUrl('/api/approvals/my-tasks'));
      if (!r.ok) { setFailed(true); setTasks([]); return; }
      const d = await r.json();
      setTasks(Array.isArray(d.tasks) ? d.tasks : []);
    } catch {
      setFailed(true); setTasks([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  /* Photograph the rack this ticket is about. The rack goes with it, so the
     scan knows which rack it is of before the photograph is taken, and the
     ticket goes with it so what comes back can be read against what was
     asked. */
  const photograph = (t) => {
    const q = new URLSearchParams({
      rack: t.rackId || '',
      // A ticket raised in ServiceNow has no check of ours behind it yet, so
      // it travels as 0:sn:<number> (23 September 2026).
      task: `${t.planId || 0}:${t.uid}`,
    });
    navigate(`/scan?${q.toString()}`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Tickets for you</h1>
        <p className={styles.sub}>Somebody has asked you to look at a rack.</p>
      </header>

      {tasks === null ? <p className={styles.quiet}>Looking…</p> : null}

      {tasks && tasks.length === 0 ? (
        <div className={styles.none}>
          <Icon name="mail" className={styles.noneIcon} />
          <p className={styles.noneTitle}>Nothing is waiting for you.</p>
          <p className={styles.noneSub}>
            {failed
              ? 'Your tickets could not be read just now. Pull down to try again.'
              : 'When somebody raises a ticket and gives it to you, it appears here.'}
          </p>
        </div>
      ) : null}

      <ul className={styles.list}>
        {(tasks || []).map((t) => {
          const l = taskLines(t);
          return (
            <li key={`${t.planId}:${t.uid}`} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.tag}>{t.status === 'open' ? 'New' : 'In hand'}</span>
                {/* Where it came from, when it did not come from RackTrack. */}
                {t.from === 'servicenow' ? <span className={styles.where2}>ServiceNow</span> : null}
                <span className={styles.when}>{since(t.raisedAt)}</span>
              </div>
              <h2 className={styles.asked}>{l.asked}</h2>
              <p className={styles.where}><Icon name="rack" className={styles.whereIcon} />{l.where}</p>
              {t.note ? <p className={styles.note}>{t.note}</p> : null}
              <p className={styles.from}>
                {t.from === 'servicenow'
                  ? `Raised in ServiceNow${l.number ? ` · ${l.number}` : ''}`
                  : `${l.from}${l.number ? ` · ${l.number}` : ''}`}
              </p>
              <button type="button" className={styles.go} onClick={() => photograph(t)}>
                Photograph this rack
                <Icon name="arrow_forward" className={styles.goIcon} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
