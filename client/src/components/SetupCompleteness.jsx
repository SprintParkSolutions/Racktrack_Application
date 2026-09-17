import styles from './SetupCompleteness.module.css';

/**
 * How far a datacentre's setup has come, read from the `completeness` the
 * setup API returns on every read and write:
 *
 *   { mandatory: { location, approver, rules }, canScan, optional: {...}, counts }
 *
 * Three mandatory facts, in the order the setup screens ask for them. The
 * same summary feeds the review step, the org console's site list and the
 * tests, so "needs an approver" is spelled one way everywhere.
 */
export const MANDATORY = [
  { key: 'location', label: 'Racks', missing: 'a space with racks' },
  { key: 'approver', label: 'Approver', missing: 'an approver' },
  { key: 'rules',    label: 'Rules',    missing: 'the rules accepted' },
];

/**
 * @param {object|null} completeness
 * @returns {{ done: boolean, missing: Array<{key,label,missing}>, text: string }}
 */
export function completenessSummary(completeness) {
  const m = completeness?.mandatory;
  if (!m || typeof m !== 'object') {
    return { done: false, missing: MANDATORY.slice(), text: 'Not set up yet' };
  }
  const missing = MANDATORY.filter((f) => !m[f.key]);
  if (missing.length === 0) return { done: true, missing, text: 'Ready to scan' };
  return { done: false, missing, text: `Needs ${missing.map((f) => f.missing).join(', ')}` };
}

/** Three small marks, one per mandatory fact. */
export function CompletenessFlags({ completeness, className = '' }) {
  const m = completeness?.mandatory || {};
  return (
    <ul className={`${styles.flags} ${className}`} aria-label="Setup progress">
      {MANDATORY.map((f) => {
        const ok = !!m[f.key];
        return (
          <li key={f.key} className={`${styles.flag} ${ok ? styles.flagOn : ''}`}
            data-testid={`flag-${f.key}`} data-ok={ok ? '1' : '0'}>
            <span className={styles.mark} aria-hidden="true">{ok ? '✓' : '·'}</span>
            <span>{f.label}</span>
            <span className={styles.sr}>{ok ? ' done' : ' missing'}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** One line of text: "Ready to scan" or what is still missing. */
export function CompletenessLine({ completeness, className = '' }) {
  const s = completenessSummary(completeness);
  return (
    <span className={`${styles.line} ${s.done ? styles.lineOn : ''} ${className}`}
      data-testid="completeness-line" data-done={s.done ? '1' : '0'}>
      {s.text}
    </span>
  );
}
