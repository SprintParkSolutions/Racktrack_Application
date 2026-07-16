import { useState } from 'react';
import styles from './StandardFeedback.module.css';

// One compact feedback pattern used everywhere corrections are collected:
//   prompt + Yes / No  →  (No) a dropdown of options + "Other" (free text)
//   →  Submit  →  "Thanks for the feedback."
//
// If the item was already answered, it collapses to a tiny confirmed line and
// never re-asks. Handlers stay in the parent; this is presentation + flow only.
//
// Props:
//   prompt        the question, e.g. 'Port 12 on Switch — right?'
//   options       [{ value, label }]  choices for the No dropdown
//   otherInput    'text' | 'number' | null   input type when "Other" is picked
//   directPick    true → skip Yes/No, open the dropdown straight away
//   answered      true → render the collapsed confirmed line, no prompt
//   answeredText  what the confirmed line says
//   accent        accent colour for the buttons
//   onYes()       async — user confirmed the detection is right
//   onSubmit(v)   async — user picked/typed the correct value `v`
export default function StandardFeedback({
  prompt,
  options = [],
  otherInput = 'text',
  otherLabel = 'Other (type it)',
  submitLabel = 'Submit',
  thanks = 'Thanks for the feedback.',
  directPick = false,
  answered = false,
  answeredText = 'You corrected this',
  accent = '#2563c9',
  onYes,
  onSubmit,
}) {
  const [phase, setPhase] = useState(directPick ? 'pick' : 'idle'); // idle|pick|saving|done|gone
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [err, setErr] = useState(null);

  if (phase === 'gone') return null;

  if (answered) {
    return (
      <div className={styles.answered} style={{ '--ac': accent }}>
        <span className={styles.tick}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
        <span className={styles.answeredText}>{answeredText}</span>
      </div>
    );
  }

  const isOther = choice === '__other__';
  const value = isOther ? other.trim() : choice;

  const finish = () => { setPhase('done'); setTimeout(() => setPhase('gone'), 1900); };

  const doYes = async () => {
    setPhase('saving'); setErr(null);
    try { if (onYes) await onYes(); finish(); }
    catch (e) { setErr(e?.message || 'Could not save'); setPhase('idle'); }
  };
  const doSubmit = async () => {
    if (!value) { setErr('Pick or type the correct value.'); return; }
    setPhase('saving'); setErr(null);
    try { if (onSubmit) await onSubmit(value); finish(); }
    catch (e) { setErr(e?.message || 'Could not save'); setPhase('pick'); }
  };

  return (
    <div className={styles.wrap} style={{ '--ac': accent }}>
      {phase === 'idle' && (
        <>
          <span className={styles.prompt}>{prompt}</span>
          <div className={styles.btnRow}>
            <button className={`${styles.btn} ${styles.yes}`} onClick={doYes}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Yes
            </button>
            <button className={`${styles.btn} ${styles.no}`} onClick={() => { setPhase('pick'); setErr(null); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              No
            </button>
          </div>
        </>
      )}

      {phase === 'pick' && (
        <>
          <div className={styles.pickHead}>
            <span className={styles.prompt}>What is it actually?</span>
            {!directPick && (
              <button className={styles.close} aria-label="Cancel"
                onClick={() => { setPhase('idle'); setChoice(''); setOther(''); setErr(null); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            )}
          </div>
          <div className={styles.pickRow}>
            <select className={styles.select} value={choice}
              onChange={e => { setChoice(e.target.value); setErr(null); }} autoFocus>
              <option value="" disabled>Choose…</option>
              {options.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
              {otherInput && <option value="__other__">{otherLabel}</option>}
            </select>
            {isOther && otherInput && (
              <input className={styles.other}
                type={otherInput === 'number' ? 'number' : 'text'}
                inputMode={otherInput === 'number' ? 'numeric' : undefined}
                placeholder="Type it"
                value={other} onChange={e => { setOther(e.target.value); setErr(null); }}
                onKeyDown={e => { if (e.key === 'Enter') doSubmit(); }} autoFocus />
            )}
            <button className={styles.submit} disabled={!value} onClick={doSubmit}>{submitLabel}</button>
          </div>
        </>
      )}

      {phase === 'saving' && (
        <div className={styles.saving}><span className={styles.spinner} /> Saving…</div>
      )}
      {phase === 'done' && (
        <div className={styles.done}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          {thanks}
        </div>
      )}
      {err && <span className={styles.err}>{err}</span>}
    </div>
  );
}
