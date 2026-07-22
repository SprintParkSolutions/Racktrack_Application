import { useEffect, useRef } from 'react';

// Everything the browser will hand a Tab press to. Explicit list rather than
// :focus-visible-style guesswork because the trap has to agree with the
// browser exactly or Tab escapes the dialog on the last element.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Reference-counted scroll lock, shared across every hook instance. Snapshotting
// and restoring document.body.style.overflow PER instance is only correct if
// dialogs close in strict last-in-first-out order: two overlapping modals that
// close out of order would restore in the wrong order and leave the page
// permanently unscrollable. The counter fixes that — only the last unlock, when
// the count returns to zero, restores the value captured at the first lock.
let scrollLockCount = 0;
let scrollLockSaved = '';
function lockBodyScroll() {
  if (scrollLockCount === 0) {
    scrollLockSaved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}
function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = scrollLockSaved;
  }
}

/**
 * Shared modal/sheet accessibility behaviour: move focus in on open, keep Tab
 * inside, close on Escape, put focus back where it came from on close, and
 * stop the page behind from scrolling.
 *
 * Returns a ref to put on the dialog element.
 *
 * `onClose` is deliberately held in a ref and NOT an effect dependency:
 * callers pass an inline arrow, so depending on it would re-run the effect on
 * every render and yank focus back to the first control mid-typing — the bug
 * MoreSheet used to have.
 */
export default function useModalA11y(onClose, { active = true } = {}) {
  const ref = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Captured on the render that opens the dialog, not in the effect: by the
  // time effects run, an autoFocus field inside the dialog already holds focus
  // and we would "restore" to it on close. Some callers keep the component
  // mounted and flip `active`, so key off that edge rather than first render.
  const restoreRef = useRef(null);
  const wasActive = useRef(false);
  if (active && !wasActive.current) restoreRef.current = document.activeElement;
  wasActive.current = active;

  useEffect(() => {
    if (!active) return undefined;
    const root = ref.current;
    if (!root) return undefined;

    const restoreTo = restoreRef.current;

    // Focus the first real control — unless an autoFocus field inside already
    // took focus, in which case respect the author's choice. Falls back to the
    // dialog itself so a screen reader announces it rather than the page.
    if (!root.contains(document.activeElement)) {
      const first = root.querySelector(FOCUSABLE);
      if (first) first.focus();
      else { root.setAttribute('tabindex', '-1'); root.focus(); }
    }

    const onKey = (e) => {
      // stopImmediatePropagation, not stopPropagation: this is a capture-phase
      // listener on document, and stopPropagation does NOT stop other listeners
      // bound to the SAME node. With two dialogs open, plain stopPropagation
      // would let one Escape fire both handlers and close both at once.
      if (e.key === 'Escape') { e.stopImmediatePropagation(); onCloseRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      // getClientRects rather than offsetParent — the latter reports null for
      // position:fixed elements, which would drop them from the trap.
      const items = Array.from(root.querySelectorAll(FOCUSABLE))
        .filter(el => el.getClientRects().length > 0 || el === document.activeElement);
      if (items.length === 0) { e.preventDefault(); root.focus(); return; }
      const firstEl = items[0];
      const lastEl  = items[items.length - 1];
      // The "outside" cases also catch focus that has escaped to the browser
      // chrome or a stale element — wrap it back in either way.
      const outside = !root.contains(document.activeElement);
      if (e.shiftKey && (outside || document.activeElement === firstEl)) {
        e.preventDefault(); lastEl.focus();
      } else if (!e.shiftKey && (outside || document.activeElement === lastEl)) {
        e.preventDefault(); firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);

    lockBodyScroll();

    return () => {
      document.removeEventListener('keydown', onKey, true);
      unlockBodyScroll();
      if (restoreTo && typeof restoreTo.focus === 'function' && document.contains(restoreTo)) {
        restoreTo.focus();
      }
    };
  }, [active]);

  return ref;
}
