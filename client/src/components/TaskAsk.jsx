import { useEffect, useState } from 'react';
import { apiUrl, authFetch } from '../utils/api';
import Icon from './Icon';
import styles from './TaskAsk.module.css';

/**
 * What the ticket asked, carried through the work it caused.
 *
 * The second workflow starts at a ticket and ends at a record: somebody asks
 * for a rack to be looked at, the technician photographs it, and what comes
 * back has to be read against what was asked - not against the whole of the
 * records, which is the first workflow's question.
 *
 * So the ask travels in the address (`?task=<planId>:<ticket uid>`) from the
 * ticket, through the scan, to the screens that show what was found. This
 * draws it wherever it lands, so the person never has to remember what they
 * came for. It draws nothing at all when there is no ticket in the address,
 * which is every scan of the first workflow.
 */
export function taskParam(search) {
  const raw = new URLSearchParams(search || '').get('task');
  if (!raw || !raw.includes(':')) return null;
  const [planId, ...rest] = raw.split(':');
  const uid = rest.join(':');
  return Number(planId) > 0 && uid ? { planId: Number(planId), uid, raw } : null;
}

/** Keep the ticket on an address the app is about to navigate to. */
export function withTask(path, task) {
  if (!task) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}task=${encodeURIComponent(task.raw)}`;
}

export default function TaskAsk({ search, rackId = null, className = '' }) {
  const asked = taskParam(search);
  const [task, setTask] = useState(null);
  /* What the photograph says about the claim, once there is a photograph.
     The reading is the server's (lib/approvals/claim.js): a phone must not
     hold a second opinion about what a rack contains. */
  const [answer, setAnswer] = useState(null);

  useEffect(() => {
    if (!asked) { setTask(null); return undefined; }
    let dropped = false;
    (async () => {
      try {
        const r = await authFetch(apiUrl('/api/approvals/my-tasks'));
        if (!r.ok) return;
        const d = await r.json();
        const found = (d.tasks || []).find(
          (t) => Number(t.planId) === asked.planId && String(t.uid) === asked.uid,
        );
        if (!dropped && found) setTask(found);
      } catch { /* the banner simply does not appear */ }
    })();
    return () => { dropped = true; };
  }, [asked && asked.raw]);

  useEffect(() => {
    if (!asked || !rackId) { setAnswer(null); return undefined; }
    let dropped = false;
    (async () => {
      try {
        const r = await authFetch(apiUrl(
          `/api/scan/${encodeURIComponent(rackId)}/ticket-answer?task=${encodeURIComponent(asked.raw)}`,
        ));
        if (!r.ok) return;
        const d = await r.json();
        if (!dropped && d && d.found) setAnswer(d);
      } catch { /* the ask still shows; only the answer is missing */ }
    })();
    return () => { dropped = true; };
  }, [asked && asked.raw, rackId]);

  if (!task) return null;
  return (
    <section className={`${styles.ask} ${className}`} aria-label="What the ticket asked">
      <span className={styles.mark}><Icon name="mail" /></span>
      <div className={styles.text}>
        <p className={styles.head}>
          The ticket asked{task.raisedBy ? ` (${task.raisedBy})` : ''}
          {task.number ? ` · ${task.number}` : ''}
        </p>
        <p className={styles.said}>{task.summary || 'Look at this rack'}</p>
        {task.note ? <p className={styles.note}>{task.note}</p> : null}
        {/* And what the rack in front of them actually shows. */}
        {answer ? (
          <div className={`${styles.answer} ${styles[answer.verdict] || ''}`}>
            {answer.says ? <p className={styles.says}>{answer.says}</p> : null}
            <p className={styles.found}>{answer.found}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
