import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext';
import styles from './ContactPage.module.css';

const SUPPORT_EMAIL = 'support@racktrack.ai';

// Contact support — full-bleed data-center hero + form, rendered inside the
// shell. The message is sent server-side to the support inbox with the user's
// identity + context attached (Reply-To is their email); if the server can't
// send, a mailto: fallback keeps the user unstuck.
//
// Arrived-from-DOT: the assistant's "Contact support" button navigates here with
// { context } — the question it couldn't answer — pre-filled into the message.
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

  const email = user?.email || 'your account email';
  const canSend = message.trim().length >= 4 && status !== 'sending';

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

  const Hero = (
    <section className={styles.hero}>
      <img src="/home-bg.jpg" alt="" className={styles.heroImg} />
      <div className={styles.scrim} aria-hidden="true" />
      <nav className={styles.nav}>
        <button className={styles.back} onClick={() => navigate(-1)} aria-label="Back">‹</button>
        <span className={styles.brand}>RackTrack</span>
      </nav>
      <div className={styles.heroTitle}>
        <div className={styles.eyebrow}>Support</div>
        <h1 className={styles.h1}>Talk to a real person.</h1>
      </div>
    </section>
  );

  if (status === 'sent') {
    return (
      <div className={styles.page}>
        {Hero}
        <div className={styles.wrap}>
          <div className={styles.doneCard}>
            <div className={styles.doneMark} aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
            </div>
            <h2 className={styles.doneTitle}>Message sent</h2>
            <p className={styles.doneText}>
              Thanks — the RackTrack support team has it and will reply to{' '}
              <strong>{email}</strong>.
            </p>
            <button className={styles.send} onClick={() => navigate(-1)}>Back to what I was doing</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {Hero}

      <div className={styles.wrap}>
        <p className={styles.lede}>
          Real humans, real fast. Tell us what broke and we&apos;ll reply straight to{' '}
          <strong>{email}</strong> — the more you include, the faster we help.
        </p>

        <div className={styles.grid}>
          <form className={styles.formCard} onSubmit={submit}>
            <label className={styles.label}>Subject <span className={styles.optional}>optional</span></label>
            <input
              className={styles.fld}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Scan won't upload"
              maxLength={140}
            />

            <label className={`${styles.label} ${styles.labelGap}`}>Message</label>
            <textarea
              className={`${styles.fld} ${styles.textarea}`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened? What were you doing when it happened? Paste any exact error text."
              maxLength={5000}
              autoFocus
            />

            {error && (
              <div className={styles.errorBox}>
                {error}{' '}
                <a href={mailto} className={styles.link}>Email us directly →</a>
              </div>
            )}

            <button type="submit" className={styles.send} disabled={!canSend}>
              {status === 'sending' ? 'Sending…' : 'Send message →'}
            </button>
          </form>

          {/* Desktop/iPad: support details rail */}
          <aside className={styles.aside}>
            <div className={styles.infoCard}>
              <div className={styles.k}>Email</div>
              <a className={styles.v} href={mailto}>{SUPPORT_EMAIL}</a>
              <div className={styles.m}>Replies within a few hours</div>
            </div>
            <div className={styles.infoCard}>
              <div className={styles.k}>Status</div>
              <div className={styles.dot}><i />All systems operational</div>
            </div>
            <div className={styles.reassure}>
              A real person on the RackTrack team reads every message — no bots,
              no ticket maze.
            </div>
          </aside>
        </div>

        {/* Mobile: compact email card */}
        <a className={styles.emailCard} href={mailto}>
          <div>
            <div className={styles.k}>Prefer email?</div>
            <div className={styles.v}>{SUPPORT_EMAIL}</div>
          </div>
          <span aria-hidden="true">›</span>
        </a>
      </div>
    </div>
  );
}
