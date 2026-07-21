// Support assistant — a floating help panel backed by /api/support.
//
// The server answers only from a verified knowledge base and declines rather
// than guessing, so this component's job is mostly to stay out of the way:
// show the answer, make a decline look visibly different from an answer, and
// always offer a way to reach a person.
//
// Renders nothing at all when the server reports the assistant unavailable
// (no knowledge base loaded), rather than showing a button that cannot help.

import { useState, useRef, useEffect, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/api';
import styles from './SupportBot.module.css';

const STARTERS = [
  "I can't log in",
  'My scan came back empty',
  'How do I export a report?',
  'My work disappeared',
];

// Routes where the bot did not have an answer. Shown differently so a decline
// is never mistaken for advice.
const DECLINED = new Set(['refusal', 'out-of-scope']);

export default function SupportBot() {
  const [available, setAvailable] = useState(null); // null = still checking
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');

  const logRef = useRef(null);
  const inputRef = useRef(null);

  // Only mount the launcher if the assistant can actually answer.
  useEffect(() => {
    let cancelled = false;
    authFetch(apiUrl('/api/support/status'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setAvailable(Boolean(d && d.ok)); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, pending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Escape closes the panel — expected on desktop, harmless on mobile.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = useCallback(async (text) => {
    const question = String(text || '').trim();
    if (!question || pending) return;

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setDraft('');
    setPending(true);

    try {
      // Send prior turns so short follow-ups ("why?") have context. The server
      // caps and sanitizes this; we just avoid sending the whole session.
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));

      const res = await authFetch(apiUrl('/api/support/ask'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: question, history }),
      });

      if (!res.ok) {
        const detail = res.status === 429
          ? 'A lot of questions at once — give it a few seconds and try again.'
          : 'The assistant is unavailable right now.';
        setMessages((prev) => [...prev, { role: 'assistant', content: detail, route: 'refusal' }]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, route: data.route },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Could not reach the assistant. Check your connection and try again.', route: 'refusal' },
      ]);
    } finally {
      setPending(false);
    }
  }, [messages, pending]);

  if (!available) return null;

  if (!open) {
    return (
      <button
        type="button"
        className={styles.launcher}
        onClick={() => setOpen(true)}
        aria-label="Open support assistant"
        title="Get help"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    );
  }

  return (
    <div className={styles.panel} role="dialog" aria-modal="false" aria-label="Support assistant">
      <div className={styles.head}>
        <div>
          <div className={styles.title}>Help</div>
          <div className={styles.sub}>Answers about using RackTrack</div>
        </div>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className={styles.log} ref={logRef}>
        {messages.length === 0 && (
          <div className={styles.intro}>
            <strong>What are you stuck on?</strong>
            Ask in your own words. If I don&apos;t know something for certain, I&apos;ll
            say so rather than guess.
            <div className={styles.chips}>
              {STARTERS.map((s) => (
                <button key={s} type="button" className={styles.chip} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const declined = m.role === 'assistant' && DECLINED.has(m.route);
          return (
            <div
              key={i}
              className={`${styles.row} ${m.role === 'user' ? styles.me : styles.bot} ${declined ? styles.declined : ''}`}
            >
              <div>
                <div className={styles.bubble}>{m.content}</div>
                {declined && (
                  <div className={styles.escape}>
                    Still stuck?{' '}
                    <button type="button" onClick={() => send('how do I contact support')}>
                      Reach a person
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {pending && (
          <div className={`${styles.row} ${styles.bot}`}>
            <div className={styles.bubble}>
              <span className={styles.dots} aria-label="Thinking"><i /><i /><i /></span>
            </div>
          </div>
        )}
      </div>

      <form
        className={styles.form}
        onSubmit={(e) => { e.preventDefault(); send(draft); }}
      >
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe what's happening…"
          maxLength={1000}
          autoComplete="off"
          aria-label="Your question"
        />
        <button type="submit" className={styles.send} disabled={pending || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
