import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import styles from './MoreSheet.module.css';

/**
 * The phone's overflow navigation — everything the sidebar shows that does
 * not fit in the three-slot bottom bar. Without this, Lab and Marketplace
 * had no tappable route on a phone at all.
 *
 * Portalled to <body> so it escapes #root's 540px cap and centred column,
 * and sized against the viewport rather than its parent, so it fits the
 * screen on a small phone instead of running off the bottom.
 */
export default function MoreSheet({ links, onClose }) {
  const panelRef = useRef(null);

  // Escape closes; focus moves into the sheet so a keyboard or screen-reader
  // user is not left behind on the button that opened it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector('a')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <div
        ref={panelRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="More destinations"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.grip} aria-hidden="true" />
        <h2 className={styles.title}>Go to</h2>

        <nav className={styles.list}>
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onClick={onClose}
              className={({ isActive }) => `${styles.row} ${isActive ? styles.rowActive : ''}`}
            >
              <span className={styles.icon} aria-hidden="true">{l.icon}</span>
              <span className={styles.text}>
                <span className={styles.label}>{l.label}</span>
                {l.hint && <span className={styles.hint}>{l.hint}</span>}
              </span>
              <span className={styles.chev} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </span>
            </NavLink>
          ))}
        </nav>

        <button type="button" className={styles.close} onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
