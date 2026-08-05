import { useEffect } from 'react';
import styles from '../pages/AuthPages.module.css';
import RackElevation from './RackElevation.jsx';

/**
 * The panel beside the auth form on wide screens.
 *
 * The genre convention is a stock photo or a 3D mascot here, which is why
 * every one of these pages looks like every other: the artwork is
 * interchangeable. This panel carries a drawn 42U rack elevation instead —
 * built from the same U-positions and device tags the app uses throughout, so
 * it belongs to this product and no other.
 *
 * Hidden below 900px, where the single column is already the right answer.
 * aria-hidden: it is decorative, and a screen-reader user arriving at a
 * sign-in page should reach the form, not a rack diagram.
 */
export default function AuthAside() {
  // #root is capped at 540px and centred (index.css) — the frame that makes the
  // app feel like an app on a phone. On a desktop it also means these pages
  // render as a phone-width strip no matter what they do internally, which is
  // why the home hero portals itself to <body> to escape it.
  //
  // Rather than portal four more pages, lift the cap for as long as an auth
  // page is mounted and put it back on the way out, so nothing else is
  // affected. The class is what the stylesheet keys off; the width itself
  // still only changes at ≥900px.
  useEffect(() => {
    const root = document.getElementById('root');
    root?.classList.add('rt-auth-wide');
    return () => root?.classList.remove('rt-auth-wide');
  }, []);

  return (
    <aside className={styles.aside} aria-hidden="true">
      <div className={styles.asideInner}>
        <div className={styles.asideBrand}>
          <img src="/logo.jpg" alt="" className={styles.asideMark} />
          RackTrack
        </div>

        <h2 className={styles.asideH}>
          Every rack. Every unit.<br />
          <span className={styles.asideAccent}>Precisely documented.</span>
        </h2>

        <div className={styles.asideRack}>
          <RackElevation />
        </div>

        <p className={styles.asideNote}>
          Every unit, its U-position and its port count — read from one photograph.
        </p>
      </div>
    </aside>
  );
}
