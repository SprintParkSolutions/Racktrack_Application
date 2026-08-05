import { useEffect } from 'react';
import styles from '../pages/AuthPages.module.css';

/**
 * The brand panel beside the auth form on wide screens.
 *
 * The auth pages were a 440px column centred in whatever space existed, which
 * on a laptop meant a phone-shaped strip floating in an empty page. Widening
 * the form itself is not the fix — a sign-in form with 1400px-wide inputs is
 * worse, not better — so the surplus width gets content of its own and the
 * form keeps a sensible measure.
 *
 * Hidden below 900px, where the single column is already the right answer.
 * Purely decorative, so it is aria-hidden: everything it says is either
 * repeated by the form or is marketing copy a screen-reader user reaching a
 * sign-in page does not need read to them first.
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
      <div className={styles.asideGrid} />
      <div className={styles.asideInner}>
        <div className={styles.asideBrand}>
          <img src="/logo.jpg" alt="" className={styles.asideMark} />
          RackTrack
        </div>

        <h2 className={styles.asideH}>
          Every rack.<br />
          Every unit.<br />
          <span className={styles.asideBlue}>Precisely</span><br />
          <span className={styles.asideTeal}>documented.</span>
        </h2>

        <figure className={styles.asideShot}>
          <img src="/home-bg.jpg" alt="" />
          <figcaption className={styles.asideReadout}>
            <span className={styles.asideRackId}>Rack R-101 · Chennai-DC1</span>
            <span className={styles.asideStats}>
              <b>24U / 42U</b> space · <b>48</b> ports · <b>5</b> devices
            </span>
          </figcaption>
        </figure>
      </div>
    </aside>
  );
}
