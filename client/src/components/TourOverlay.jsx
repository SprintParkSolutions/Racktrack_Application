import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTour } from '../TourContext.jsx';
import styles from './TourOverlay.module.css';
import robotBody from '../assets/tour-robot-body.png';
import robotArm from '../assets/tour-robot-arm.png';

function findAnchor(target) {
  return document.querySelector(`[data-tour="${target}"]`);
}

// How long an `optional` step waits for its anchor before giving up and moving
// on. It exists because some anchors arrive late — the incident dropdown only
// renders once /api/incidents/active has answered — so an immediate skip would
// race the fetch. This used to be 4000ms, which on the common path (an org with
// no open tickets) left the walkthrough showing NOTHING for four seconds: no
// dim, no card, no robot. Testers read that as the tour crashing. The card now
// stays up while we wait, and the wait itself is short.
const OPTIONAL_SKIP_MS = 1200;

// A state-change step waits this long after its condition goes true before
// advancing, so the user gets a beat to see what they just did.
const ADVANCE_GRACE_MS = 900;

// How often to re-measure as a backstop. Scroll, resize and anchor-resize are
// all handled by events; this only catches layout the browser doesn't tell us
// about, e.g. a CSS animation settling.
const FALLBACK_MEASURE_MS = 500;

// The tour's "guide" character — the same waving robot used on the welcome
// card (TourIntroModal), so it's one consistent character throughout.
function TourMascot() {
  return (
    <div className={styles.robotStage} aria-hidden="true">
      <img className={styles.robotBody} src={robotBody} alt="" draggable="false" />
      <img className={styles.robotArm} src={robotArm} alt="" draggable="false" />
    </div>
  );
}

// Renders nothing fake — it spotlights the real `data-tour` anchor already in
// the page and waits for the real click/change on it before moving on.
//
// When the anchor is NOT on screen (page still loading, mid-navigation, or a
// step whose control this org never sees) the card stays up in a waiting state
// rather than the whole overlay disappearing. That matters for more than
// polish: the card holds the only "Skip tour" button, so hiding it on a
// missing anchor left the tour running with no way for the user to leave it.
export default function TourOverlay() {
  const { active, currentStep, advance, stopTour } = useTour();
  const [rect, setRect] = useState(null);
  const [bypassRect, setBypassRect] = useState(null);
  // The card has to be placed against its own measured height — see the
  // clamp below — so measure it after every layout that can change it.
  const bubbleRef = useRef(null);
  const [bubbleH, setBubbleH] = useState(0);
  // Which step we have already scrolled into view, so a step that starts off
  // screen is brought into view once instead of fighting the user every time
  // they scroll away from it.
  const scrolledForRef = useRef(null);

  // The dim layer blocks clicks everywhere except the spotlighted control —
  // including the page's own Back button, which would otherwise leave the
  // user stuck mid-tour with no way out except finishing it. Any element
  // marked data-tour-bypass gets the same click-through hole treatment as
  // the spotlight itself, and clicking it stops the tour first.
  useEffect(() => {
    if (!active) { setBypassRect(null); return undefined; }
    const measureBypass = () => {
      const el = document.querySelector('[data-tour-bypass]');
      if (!el) { setBypassRect(null); return; }
      const r = el.getBoundingClientRect();
      setBypassRect(prev => (
        prev && prev.top === r.top && prev.left === r.left
          && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      ));
    };
    measureBypass();
    const id = setInterval(measureBypass, FALLBACK_MEASURE_MS);
    return () => clearInterval(id);
  }, [active]);

  const handleBypassClick = () => {
    const el = document.querySelector('[data-tour-bypass]');
    stopTour();
    el?.click();
  };

  // Escape leaves the walkthrough, matching every other dismissable surface in
  // the app. Without it, a keyboard user's only exit was to find and click the
  // "Skip tour" button.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') stopTour(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, stopTour]);

  // Track the current step's real anchor.
  //
  // Position used to be re-read on a 200ms interval, which meant the spotlight
  // trailed a fifth of a second behind the page whenever anything moved — very
  // visible while scrolling. It is now driven by the events that actually
  // change the geometry (scroll, resize, the anchor resizing itself), each
  // coalesced into one measurement per frame, with a slow interval left in as a
  // backstop for layout changes nothing reports.
  useEffect(() => {
    if (!active || !currentStep) { setRect(null); return undefined; }
    let cancelled = false;
    let advanceTimer = null;
    let rafId = null;
    let watched = null;

    const clearAdvanceTimer = () => {
      if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    };

    const measure = () => {
      if (cancelled) return;

      // Steps that complete on a state change rather than a click. The pending
      // advance is cancelled if the condition goes back to false — otherwise
      // picking a photo and removing it inside the grace window still advanced
      // the tour, leaving the user on "Analyze the rack" with nothing to
      // analyze.
      if (currentStep.advanceWhenVisible) {
        if (document.querySelector(currentStep.advanceWhenVisible)) {
          if (!advanceTimer) {
            advanceTimer = setTimeout(() => { if (!cancelled) advance(); }, ADVANCE_GRACE_MS);
          }
        } else {
          clearAdvanceTimer();
        }
      }

      const el = findAnchor(currentStep.target);
      if (!el) {
        watched = null;
        setRect(null);
        return;
      }

      // Bring an off-screen anchor into view once per step. Without this the
      // overlay happily spotlighted an element the user could not see, dimming
      // the whole screen around nothing.
      if (scrolledForRef.current !== currentStep.id) {
        const r0 = el.getBoundingClientRect();
        const offScreen = r0.bottom < 0 || r0.top > window.innerHeight
          || r0.top < 0 || r0.bottom > window.innerHeight;
        if (offScreen) {
          scrolledForRef.current = currentStep.id;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } else {
          scrolledForRef.current = currentStep.id;
        }
      }

      if (el !== watched) watched = el;
      const r = el.getBoundingClientRect();
      // Only re-render when the geometry actually moved.
      setRect(prev => (
        prev && prev.top === r.top && prev.left === r.left
          && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height }
      ));
    };

    const scheduleMeasure = () => {
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => { rafId = null; measure(); });
    };

    measure();
    // Capture phase so scrolling inside a nested container counts too, and
    // passive so we never hold up the scroll itself.
    window.addEventListener('scroll', scheduleMeasure, { capture: true, passive: true });
    window.addEventListener('resize', scheduleMeasure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null;
    if (ro) ro.observe(document.body);
    const fallbackId = setInterval(measure, FALLBACK_MEASURE_MS);

    // An optional step whose control this org never sees (e.g. no open
    // incidents) steps aside on its own instead of stalling the walkthrough.
    let skipTimer;
    if (currentStep.optional) {
      skipTimer = setTimeout(() => {
        if (!cancelled && !findAnchor(currentStep.target)) advance();
      }, OPTIONAL_SKIP_MS);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('scroll', scheduleMeasure, { capture: true });
      window.removeEventListener('resize', scheduleMeasure);
      ro?.disconnect();
      clearInterval(fallbackId);
      if (rafId != null) cancelAnimationFrame(rafId);
      if (skipTimer) clearTimeout(skipTimer);
      clearAdvanceTimer();
    };
  }, [active, currentStep, advance]);

  // Advance on the real interaction with the real element — never a fake button.
  useEffect(() => {
    if (!active || !currentStep) return undefined;
    // Steps that complete via a state change (advanceWhenVisible) must not
    // also advance on a bare click of their target — e.g. clicking the photo
    // drop zone only opens the file picker, it doesn't mean a photo was
    // actually chosen. Only the state watcher above may advance these steps.
    if (currentStep.advanceWhenVisible) return undefined;
    const evtType = currentStep.event || 'click';
    const advanceTarget = currentStep.advanceSelector || currentStep.target;
    const handler = (e) => {
      const el = findAnchor(advanceTarget);
      if (el && (el === e.target || el.contains(e.target))) {
        advance();
      }
    };
    document.addEventListener(evtType, handler, true);
    return () => document.removeEventListener(evtType, handler, true);
  }, [active, currentStep, advance]);

  // Runs before paint, so the card is positioned against a real height on the
  // frame it appears rather than jumping once it has been measured.
  useLayoutEffect(() => {
    if (bubbleRef.current) setBubbleH(bubbleRef.current.offsetHeight);
  }, [active, currentStep, rect]);

  const stopAndBlur = useCallback(() => { stopTour(); }, [stopTour]);

  if (!active || !currentStep) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const bubbleWidth = Math.min(320, vw - 24);
  const mascotSize = 62;
  // Leaves room for the mascot, which overhangs the card's top edge by up to
  // 46px on phones (see .mascot in TourOverlay.module.css).
  const TOP_GUTTER = 56;

  // ── Waiting state ──────────────────────────────────────────────────
  // Anchor not on screen yet. Show the card, without the dim layer, so the
  // page stays usable and "Skip tour" stays reachable.
  if (!rect) {
    const waitLeft = Math.max(12, Math.round((vw - bubbleWidth) / 2));
    const waitTop = Math.max(TOP_GUTTER, vh - bubbleH - 24);
    return createPortal(
      <div className={styles.overlayRoot} aria-live="polite">
        <div
          ref={bubbleRef}
          className={styles.bubble}
          style={{ width: bubbleWidth, left: waitLeft, top: waitTop }}
          role="dialog"
          aria-label={currentStep.title}
        >
          <div className={styles.mascot} style={{ width: mascotSize, height: mascotSize }}>
            <TourMascot />
          </div>
          <p className={styles.bubbleTitle}>{currentStep.title}</p>
          <p className={styles.bubbleBody}>Waiting for this to appear&hellip;</p>
          <div className={styles.bubbleActions}>
            <button className={styles.skipTourBtn} onClick={stopAndBlur}>Skip tour</button>
            <button className={styles.skipStepBtn} onClick={advance}>Skip this step</button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ── Spotlight state ────────────────────────────────────────────────
  const pad = 8;
  const top = Math.max(0, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  const width = rect.width + pad * 2;
  const height = rect.height + pad * 2;
  const bottom = top + height;
  const right = left + width;

  // Which side of the spotlight the card goes on.
  //
  // This used to be `spaceBelow > 90` — a fixed threshold that takes no account
  // of how tall the card actually is. On a 375x667 phone the Analyze button
  // left 109px below it, which cleared the threshold, so the card was placed
  // below and then dragged back up by the on-screen clamp until it sat directly
  // ON TOP of the button. The tour was telling the user to tap something its
  // own card was covering: the hit test at the button's centre landed on the
  // card, so the tap could not physically reach it.
  //
  // Deciding against the card's measured height instead means "below" is only
  // chosen when the whole card genuinely fits below.
  const GAP = 20;
  const spaceBelow = vh - bottom - GAP;
  const spaceAbove = top - GAP;
  const fitsBelow = spaceBelow >= bubbleH + 12;
  const fitsAbove = spaceAbove >= bubbleH + TOP_GUTTER;
  // If neither side fits (an anchor taller than the space around it) the card
  // has to overlap something — take the roomier side and let the clamp handle it.
  const placeBelow = fitsBelow || (!fitsAbove && spaceBelow >= spaceAbove);
  const bubbleLeft = Math.min(Math.max(12, left), vw - bubbleWidth - 12);

  // The mascot perches on the info card's own corner (not the spotlight ring)
  // — it's the character "speaking" the step instructions. The speech-bubble
  // tail still points at the ring, independently.
  const tailX = Math.min(Math.max(left + 20, bubbleLeft + 20), bubbleLeft + bubbleWidth - 20);

  // Clamp the card's OWN top edge into the viewport.
  //
  // Placing it above the spotlight used to mean `top: max(12, anchorTop - 20)`
  // plus `translateY(-100%)` — which clamps the anchor-relative coordinate and
  // then shifts the card up by its full height, so the clamp guards nothing.
  // A tall anchor (the desktop drop zone is ~780px, which leaves no room
  // below) pushed the card's title and mascot clean off the top of the screen;
  // all that was left on screen was its two buttons. Subtracting the measured
  // height up front and clamping the result keeps the whole card visible in
  // both directions, even when the anchor is taller than the space around it.
  const rawBubbleTop = placeBelow ? bottom + GAP : top - GAP - bubbleH;
  const bubbleTop = Math.min(
    Math.max(TOP_GUTTER, rawBubbleTop),
    Math.max(TOP_GUTTER, vh - bubbleH - 12),
  );
  // The tail points back at the spotlight, so it sits on whichever edge of the
  // card faces it — the top when the card is below, the bottom when above.
  const tailY = placeBelow ? bubbleTop : bubbleTop + bubbleH;

  return createPortal(
    <div className={styles.overlayRoot} aria-live="polite">
      <div className={styles.dim} style={{ top: 0, left: 0, width: vw, height: top }} />
      <div className={styles.dim} style={{ top: bottom, left: 0, width: vw, height: Math.max(0, vh - bottom) }} />
      <div className={styles.dim} style={{ top, left: 0, width: left, height }} />
      <div className={styles.dim} style={{ top, left: right, width: Math.max(0, vw - right), height }} />

      {bypassRect && (
        <div
          className={styles.bypassHole}
          style={{ top: bypassRect.top, left: bypassRect.left, width: bypassRect.width, height: bypassRect.height }}
          onClick={handleBypassClick}
        />
      )}

      <div className={styles.ringPing} style={{ top, left, width, height }} />
      <div className={styles.ring} style={{ top, left, width, height }} />

      <div
        className={`${styles.tail} ${placeBelow ? styles.tailUp : styles.tailDown}`}
        style={{ top: tailY, left: tailX }}
      />

      <div
        ref={bubbleRef}
        className={styles.bubble}
        style={{ width: bubbleWidth, left: bubbleLeft, top: bubbleTop }}
        role="dialog"
        aria-label={currentStep.title}
      >
        <div className={styles.mascot} style={{ width: mascotSize, height: mascotSize }}>
          <TourMascot />
        </div>
        <p className={styles.bubbleTitle}>{currentStep.title}</p>
        <p className={styles.bubbleBody}>{currentStep.body}</p>
        <div className={styles.bubbleActions}>
          <button className={styles.skipTourBtn} onClick={stopAndBlur}>Skip tour</button>
          <button className={styles.skipStepBtn} onClick={advance}>Skip this step</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
