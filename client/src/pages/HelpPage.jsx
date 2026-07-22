// Help — the full-screen home for RackTrack Assist.
//
// The floating panel (SupportBot) is for when you are mid-task and need one
// answer. This page is for when you came here to ask something, or to test.
//
// It shows a diagnostic line under each answer — which route produced it and
// which entry it came from. Without that, a tester reporting "it gave me the
// wrong answer" has nothing actionable attached, and we cannot tell a
// retrieval problem from a knowledge-base gap.

import { useState, useRef, useEffect, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/api';
import styles from './HelpPage.module.css';

const STARTERS = [
  "I can't sign in",
  'My scan came back empty',
  'Where did my earlier scans go?',
  'How do I export a report?',
  'Why is my device showing the wrong model?',
  'Do I need internet to scan?',
];

// Routes where Assist did not answer. Shown differently so a decline is never
// mistaken for advice.
const DECLINED = new Set(['refusal', 'out-of-scope', 'needs-access']);

export default function HelpPage() {
  const [status, setStatus] = useState(null); // null = checking
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
      .then((d) => { if (!cancelled) setStatus(d || { ok: false }); })
      .catch(() => { if (!cancelled) setStatus({ ok: false }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, pending, expanded]);

  useEffect(() => { inputRef.current?.focus(); }, [status]);

  const send = useCallback(async (text) => {
    const question = String(text || '').trim();
    if (!question || pending) return;

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setDraft('');
    setPending(true);

    const started = Date.now();
    try {
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }));
      const res = await authFetch(apiUrl('/api/support/ask'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: question, history }),
      });

      if (!res.ok) {
        setMessages((prev) => [...prev, {
          role: 'assistant',
          route: 'refusal',
          content: res.status === 429
            ? 'A lot of questions at once — give it a few seconds and try again.'
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
        sources: data.sources || [],
        ms: data.ms ?? Date.now() - started,
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

  if (status && !status.ok) {
    return (
      <div className={styles.page}>
        <div className={styles.unavailable}>
          <h2>Help is unavailable</h2>
          <p>The assistant isn&apos;t running right now. Please contact your RackTrack administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <img src="/logo.jpg" alt="" className={styles.mark} />
        <div>
          <div className={styles.title}>RackTrack <span>Assist</span></div>
          <div className={styles.sub}>Answers from verified documentation</div>
        </div>
        {status?.ok && (
          <div className={styles.status}>
            <span className={`${styles.dot} ${status.mode === 'search-only' ? styles.off : ''}`} />
            {status.entries} answers
          </div>
        )}
      </div>

      <div className={styles.log} ref={logRef}>
        <div className={styles.inner}>
          {messages.length === 0 && (
            <div className={styles.intro}>
              <h2>What are you stuck on?</h2>
              Ask in your own words — the way you&apos;d say it to a colleague.
              If Assist isn&apos;t certain, it will say so rather than guess.
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
                      <button type="button" onClick={() => send('how do I contact support')}>
                        Reach a person
                      </button>
                    </div>
                  )}

                  {m.role === 'assistant' && m.route && (
                    <div className={styles.debug}>
                      <span><b>{m.route}</b></span>
                      {m.sources?.length > 0 && <span>{m.sources.join(', ')}</span>}
                      {m.ms != null && <span>{m.ms}ms</span>}
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
        <div className={styles.formInner}>
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
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}
