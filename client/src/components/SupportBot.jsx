// RackTrack Assist — in-app help, backed by /api/support.
//
// The server answers only from a verified knowledge base and declines rather
// than guessing, so this component's job is to stay out of the way: show the
// short answer, make a decline look visibly different from an answer, keep the
// full detail one tap away, and always offer a route to a person.
//
// Renders nothing when the server reports the assistant unavailable — a help
// button that cannot help is worse than no button.

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUrl, authFetch } from '../utils/api';
import styles from './SupportBot.module.css';

const STARTERS = [
  "I can't sign in",
  'My scan came back empty',
  'Where did my earlier scans go?',
  'How do I export a report?',
];

// Routes where the assistant did not answer. Shown differently so a decline is
// never mistaken for advice.
const DECLINED = new Set(['refusal', 'out-of-scope', 'needs-access']);

export default function SupportBot() {
  const navigate = useNavigate();
  const [available, setAvailable] = useState(null); // null = still checking
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  const logRef = useRef(null);
  const inputRef = useRef(null);

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
  }, [messages, pending, expanded]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

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
      // Prior turns give short follow-ups ("why?") something to attach to. The
      // server caps and sanitizes this; we just avoid sending the whole session.
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));

      const res = await authFetch(apiUrl('/api/support/ask'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: question, history }),
      });

      if (!res.ok) {
        // Read the body before deciding what to say: on a 429 the server sends
        // the real limit and how long to wait. This used to hardcode "give it
        // a few seconds", which was simply wrong — the wait can be minutes.
        let err = null;
        try { err = await res.json(); } catch { /* non-JSON error body */ }
        setMessages((prev) => [...prev, {
          role: 'assistant',
          route: 'refusal',
          content: res.status === 429
            ? (err?.message || 'That was a lot of questions at once. Try again shortly.')
            : 'Assist is unavailable right now.',
        }]);
        return;
      }

      const data = await res.json();
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: data.answer,
        detail: data.detail || null,
        route: data.route,
      }]);
    } catch {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        route: 'refusal',
        content: 'Could not reach Assist. Check your connection and try again.',
      }]);
    } finally {
      setPending(false);
    }
  }, [messages, pending]);

  const toggleDetail = (i) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  if (!available) return null;

  if (!open) {
    return (
      <button
        type="button"
        className={styles.launcher}
        onClick={() => setOpen(true)}
        aria-label="Open RackTrack Assist"
      >
        <img src="/logo.jpg" alt="" className={styles.mark} />
        <span className={styles.launcherText}>Assist</span>
      </button>
    );
  }

  return (
    <div className={styles.panel} role="dialog" aria-modal="false" aria-label="RackTrack Assist">
      <div className={styles.head}>
        <img src="/logo.jpg" alt="" className={styles.headMark} />
        <div className={styles.headText}>
          <div className={styles.name}>RackTrack <span>Assist</span></div>
          <div className={styles.status}>Answers from verified documentation</div>
        </div>
        <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className={styles.log} ref={logRef}>
        <div className={styles.stack}>
          {messages.length === 0 && (
            <div className={styles.intro}>
              <strong>What are you stuck on?</strong>
              Ask in your own words. If I&apos;m not certain, I&apos;ll say so rather than guess.
              <div className={styles.starters}>
                {STARTERS.map((s) => (
                  <button key={s} type="button" className={styles.starter} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const declined = m.role === 'assistant' && DECLINED.has(m.route);
            const isOpen = expanded.has(i);
            return (
              <div
                key={i}
                className={`${styles.row} ${m.role === 'user' ? styles.me : styles.bot} ${declined ? styles.declined : ''}`}
              >
                <div>
                  <div className={styles.bubble}>{m.content}</div>

                  {m.detail && (
                    <>
                      <button type="button" className={styles.detailBtn} onClick={() => toggleDetail(i)} aria-expanded={isOpen}>
                        {isOpen ? 'Less detail' : 'More detail'}
                      </button>
                      {isOpen && <div className={styles.detail}>{m.detail}</div>}
                    </>
                  )}

                  {declined && (
                    <div className={styles.escape}>
                      Still stuck?{' '}
                      {/* Can't answer → hand off to the Contact page, pre-filled
                          with the question DOT couldn't handle. */}
                      <button
                        type="button"
                        onClick={() => { setOpen(false); navigate('/contact', { state: { context: messages[i - 1]?.content || '' } }); }}
                      >
                        Contact support
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
      </div>

      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); send(draft); }}>
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
        <button type="submit" className={styles.send} disabled={pending || !draft.trim()} aria-label="Send">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </div>
  );
}
