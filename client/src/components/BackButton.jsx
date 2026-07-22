import { useSmartBack } from '../hooks/useSmartBack';
import styles from './BackButton.module.css';

/**
 * A back control for pages that are reachable both as a destination and from
 * somewhere deeper in the app.
 *
 * Scan, Profile, Marketplace and the Console had no back affordance at all —
 * fine when you tap them in the nav, a dead end when you arrive from a link
 * inside another page, which is what testers were hitting.
 *
 * By default it renders nothing when there is no previous entry, so a page
 * you opened directly from the nav does not grow a back arrow that would
 * either do nothing or throw you somewhere you were never coming from. Pass
 * `always` for pages that are only ever reached from somewhere else.
 */
export default function BackButton({ fallback = '/', always = false, label = 'Back', className = '' }) {
  const goBack = useSmartBack(fallback);

  // React Router stamps its stack position on history.state.idx; 0 or null
  // means this is the first entry and there is nothing behind it.
  const idx = typeof window !== 'undefined' && window.history.state
    ? window.history.state.idx : null;
  const hasHistory = typeof idx === 'number' && idx > 0;
  // `always` still renders the control on pages that are only ever reached
  // from somewhere else, even on a cold start — it falls back to the given
  // route in that case rather than doing nothing.
  if (!always && !hasHistory) return null;

  return (
    <button
      type="button"
      onClick={goBack}
      className={`${styles.back} ${className}`}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    </button>
  );
}
