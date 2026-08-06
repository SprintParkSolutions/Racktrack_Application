import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTour } from '../TourContext.jsx';
import styles from './TourOverlay.module.css';
import robotBody from '../assets/tour-robot-body.png';
import robotArm from '../assets/tour-robot-arm.png';

function findAnchor(target) {
  return document.querySelector(`[data-tour="${target}"]`);
}

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

// Renders nothing fake — it spotlights the real `data-tour` anchor already
// in the page and waits for the real click/change on it before moving on.
// While the anchor isn't in the DOM yet (page still loading, mid-navigation)
// it simply renders nothing until the poll finds it.
export default function TourOverlay() {
  const { active, currentStep, advance, stopTour } = useTour();
  const [rect, setRect] = useState(null);
  const [bypassRect, setBypassRect] = useState(null);
  // The card has to be placed against its own measured height — see the
  // clamp below — so measure it after every layout that can change it.
  const bubbleRef = useRef(null);
  const [bubbleH, setBubbleH] = useState(0);

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
      setBypassRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measureBypass();
    const id = setInterval(measureBypass, 300);
    return () => clearInterval(id);
  }, [active]);

  const handleBypassClick = () => {
    const el = document.querySelector('[data-tour-bypass]');
    stopTour();
    el?.click();
  };

  // Keep the spotlight rect in sync with the current step's real anchor.
  // Some steps (like "pick a photo") don't complete via a click on their own
  // target — they complete once the app itself reaches a new state (a file
  // was chosen, however it got chosen). `advanceWhenVisible` names the
  // anchor that proves that state was reached, so we poll for it too.
  useEffect(() => {
    if (!active || !currentStep) { setRect(null); return; }
    setRect(null);
    let cancelled = false;
    let advanceTimer = null;

    const measure = () => {
      if (currentStep.advanceWhenVisible && document.querySelector(currentStep.advanceWhenVisible)) {
        // Don't jump on the very next poll tick — that reads as instant/
        // jarring (e.g. the spotlight leaving the photo the split-second it
        // lands). Give the user a beat to see what they just did first.
        if (!advanceTimer) {
          advanceTimer = setTimeout(() => { if (!cancelled) advance(); }, 900);
        }
        return true;
      }
      const el = findAnchor(currentStep.target);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (!cancelled) {
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
      return true;
    };

    measure();
    const pollId = setInterval(measure, 200);

    let skipTimer;
    if (currentStep.optional) {
      skipTimer = setTimeout(() => {
        if (!findAnchor(currentStep.target)) advance();
      }, 4000);
    }

    return () => {
      cancelled = true;
      clearInterval(pollId);
      if (skipTimer) clearTimeout(skipTimer);
      if (advanceTimer) clearTimeout(advanceTimer);
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

  if (!active || !currentStep || !rect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;
  const top = Math.max(0, rect.top - pad);
  const left = Math.max(0, rect.left - pad);
  const width = rect.width + pad * 2;
  const height = rect.height + pad * 2;
  const bottom = top + height;
  const right = left + width;

  const bubbleWidth = Math.min(320, vw - 24);
  const spaceBelow = vh - bottom;
  // Prefer below by default (e.g. "Add your rack photo", whose spotlighted
  // drop zone is tall enough that the old top-vs-bottom comparison would
  // flip the card above it) — only go above when there's truly little room
  // left underneath.
  const placeBelow = spaceBelow > 90;
  const bubbleLeft = Math.min(Math.max(12, left), vw - bubbleWidth - 12);

  // The mascot perches on the info card's own top-left corner (not the
  // spotlight ring) — it's the character "speaking" the step instructions.
  // The speech-bubble tail still points at the ring, independently.
  const mascotSize = 62;
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
  //
  // The floor leaves room for the mascot, which overhangs the card's top edge
  // by up to 46px on phones (see .mascot in TourOverlay.module.css).
  const TOP_GUTTER = 56;
  const rawBubbleTop = placeBelow ? bottom + 20 : top - 20 - bubbleH;
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
      >
        <div className={styles.mascot} style={{ width: mascotSize, height: mascotSize }}>
          <TourMascot />
        </div>
        <p className={styles.bubbleTitle}>{currentStep.title}</p>
        <p className={styles.bubbleBody}>{currentStep.body}</p>
        <div className={styles.bubbleActions}>
          <button className={styles.skipTourBtn} onClick={stopTour}>Skip tour</button>
          <button className={styles.skipStepBtn} onClick={advance}>Skip this step</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
