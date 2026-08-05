import { useEffect } from 'react';
import styles from '../pages/AuthPages.module.css';

/**
 * The photographic backdrop behind the auth form on tablet and desktop.
 *
 * A real datacenter aisle, washed toward white so the page still reads as a
 * white page: the room is present but never competes with the form sitting on
 * it. No illustration, no diagram — the actual thing, out of focus, the way a
 * room looks behind something you are reading.
 *
 * Renders nothing visible below 900px, where the form already fills the screen
 * and a background photograph would only sit behind the keyboard.
 */
export default function AuthBackdrop() {
  // #root is capped at 540px and centred (index.css) — the frame that makes the
  // app feel like an app on a phone. On a desktop it also means these pages
  // render as a phone-width strip no matter what they do internally, which is
  // why the home hero portals itself to <body> to escape it.
  //
  // Lift the cap for as long as an auth page is mounted and put it back on the
  // way out, so nothing else is affected.
  useEffect(() => {
    const root = document.getElementById('root');
    root?.classList.add('rt-auth-wide');
    return () => root?.classList.remove('rt-auth-wide');
  }, []);

  return (
    <div className={styles.backdrop} aria-hidden="true">
      <img src="/bg.jpg" alt="" className={styles.backdropImg} />
      <div className={styles.backdropWash} />
    </div>
  );
}
