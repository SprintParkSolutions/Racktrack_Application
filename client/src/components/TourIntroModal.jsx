import { useTour } from '../TourContext.jsx';
import useModalA11y from '../hooks/useModalA11y.js';
import styles from './TourIntroModal.module.css';

// First-run prompt: "New to RackTrack?" Yes/No, and Yes starts the walkthrough.
//
// There used to be a second stage between the two: a "Let's scan your first rack"
// panel that promised, in three more lines, the walkthrough the person had just
// asked for, and then made them press Get Started to confirm the Yes. One
// question, one answer, and the tour begins.
export default function TourIntroModal() {
  const { showIntro, dismissIntro, startTour } = useTour();

  // Escape closes it, Tab stays inside it, focus returns where it came from,
  // and the page behind stops scrolling - the same contract every other dialog
  // in the app honours (MoreSheet, CmdbApprovalModal, OrgConsolePage). The
  // hook must run before the early return below.
  const panelRef = useModalA11y(dismissIntro, { active: showIntro });

  if (!showIntro) return null;

  return (
    <div className={styles.backdrop}>
      <div ref={panelRef} className={styles.panel}
           role="dialog" aria-modal="true" aria-labelledby="rt-tour-intro-heading">
        <p className={styles.eyebrow}>Welcome</p>
        <h2 id="rt-tour-intro-heading" className={styles.heading}>New to RackTrack?</h2>
        <p className={styles.body}>
          We can walk you through scanning your first rack, step by step.
        </p>
        <div className={styles.actions}>
          <button className="btn btn-ghost btn-full" onClick={dismissIntro}>
            No, I'm good
          </button>
          <button className="btn btn-primary btn-full" onClick={startTour}>
            Yes, show me
          </button>
        </div>
      </div>
    </div>
  );
}
