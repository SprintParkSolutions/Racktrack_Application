import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext';
import styles from './ContactPage.module.css';

const SUPPORT_EMAIL = 'support@racktrack.ai';

// Contact support. The message is sent server-side to the support inbox with
// the user's identity + context attached (Reply-To is their email), so support
// can reply straight back. If the server can't send (SMTP down), we fall back
// to a mailto: link so the user is never stuck.
//
// Arrived-from-DOT: when the assistant couldn't answer, its "Reach a person"
// button navigates here with { context } — the question it couldn't handle —
// which we pre-fill so the user doesn't retype it.
export default function ContactPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const fromDot = location.state?.context || '';
  const [subject, setSubject] = useState(location.state?.subject || '');
  const [message, setMessage] = useState(
    fromDot ? `I couldn't get an answer to: "${fromDot}"\n\n` : '',
  );
  const [status, setStatus] = useState('idle'); // idle | sending | sent | error
  const [error, setError] = useState(null);

  const canSend = message.trim().length >= 4 && status !== 'sending';

  // mailto fallback, pre-filled the same way — used if the server can't send.
  const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject || 'Support request',
  )}&body=${encodeURIComponent(message)}`;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSend) return;
    setStatus('sending');
    setError(null);
    try {
      const res = await authFetch(apiUrl('/api/support/contact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim(), context: fromDot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Couldn't send (HTTP ${res.status}).`);
      setStatus('sent');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  };

  if (status === 'sent') {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">‹</button>
          <h1 className={styles.headerTitle}>Contact support</h1>
        </header>
        <main className={styles.main}>
          <div className={styles.doneCard}>
            <div className={styles.doneMark} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h2 className={styles.doneTitle}>Message sent</h2>
            <p className={styles.doneText}>
              Thanks — the RackTrack support team has it and will reply to
              {' '}<strong>{user?.email || 'your email'}</strong>. You can keep using the app in the meantime.
            </p>
            <button className={styles.primaryBtn} onClick={() => navigate(-1)}>Back to what I was doing</button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">‹</button>
        <h1 className={styles.headerTitle}>Contact support</h1>
      </header>

      <main className={styles.main}>
        <p className={styles.lede}>
          Tell us what went wrong and we&apos;ll get back to you at
          {' '}<strong>{user?.email || 'your account email'}</strong>. Include the exact error text or
          what you were doing so we can help without going back and forth.
        </p>

        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span className={styles.label}>Subject <span className={styles.optional}>(optional)</span></span>
            <input
              className={styles.input}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Scan won't upload"
              maxLength={140}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Message</span>
            <textarea
              className={styles.textarea}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened? What were you doing when it happened? Paste any exact error text."
              rows={8}
              maxLength={5000}
              autoFocus
            />
          </label>

          {error && (
            <div className={styles.errorBox}>
              {error}
              <div className={styles.errorAlt}>
                You can also email us directly at{' '}
                <a href={mailto} className={styles.link}>{SUPPORT_EMAIL}</a>.
              </div>
            </div>
          )}

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryBtn} disabled={!canSend}>
              {status === 'sending' ? 'Sending…' : 'Send message'}
            </button>
            <a href={mailto} className={styles.ghostLink}>or email {SUPPORT_EMAIL}</a>
          </div>
        </form>
      </main>
    </div>
  );
}
