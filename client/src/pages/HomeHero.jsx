import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import styles from './HomeHero.module.css';

/**
 * Home hero — left-aligned editorial, two columns.
 *
 * Claim on the left over a hairline row of measurements; the rack on the right
 * with its scan readings floating over it as small white instruments.
 *
 * Portalled to <body> so it escapes #root's 540px frame and fills the viewport.
 */

const ArrowR = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

/* Every figure here is one the repo can back up, rather than the round numbers
   a hero usually reaches for: the CPU-only demo measures 3–8s a scan
   (docs/setup/DEMO-VPS-SETUP.md), the device model is 12-class, and two-rack
   capture ships. Inventing a "99.99%" would be the easiest thing on the page
   to disprove. */
const STATS = [
  { v: '3–8s',  k: 'Scan to inventory' },
  { v: '12',    k: 'Device classes' },
  { v: '2',     k: 'Racks per pass' },
];

export default function HomeHero() {
  const navigate = useNavigate();
  const auth = useAuth();
  const authed = auth?.isAuthed;

  return createPortal(
    <section className={styles.hero}>
      <nav className={styles.nav}>
        <div className={styles.logo}>
          <img src="/logo.jpg" alt="" className={styles.logoMark} />
          RackTrack
        </div>
        <button
          type="button"
          className={styles.navBtn}
          onClick={authed ? () => { auth.logout(); navigate('/'); } : () => navigate('/login')}
        >
          {authed ? 'Sign out' : 'Sign in'}
        </button>
      </nav>

      <div className={styles.body}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>Physical infrastructure · documented</p>

          <h1 className={styles.h1}>Every rack. Every unit. Precisely documented.</h1>

          <p className={styles.lede}>
            RackTrack is the system of record for your physical infrastructure.
            Photograph a rack and every switch, patch panel, port and cable becomes
            live, queryable inventory — kept true across every site you run.
          </p>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              onClick={() => navigate(authed ? '/scan' : '/login')}
            >
              {authed ? 'Start a scan' : 'Sign in'}
              <ArrowR />
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.ghost}`}
              onClick={() => navigate(authed ? '/history' : '/signup')}
            >
              {authed ? 'Past scans' : 'Create an organization'}
            </button>
          </div>

          <div className={styles.stats}>
            {STATS.map(s => (
              <div className={styles.stat} key={s.k}>
                <span className={styles.statVal}>{s.v}</span>
                <span className={styles.statKey}>{s.k}</span>
              </div>
            ))}
          </div>
        </div>

        <figure className={styles.shot}>
          <div className={styles.shotImg}>
            <img src="/home-bg.jpg" alt="A network rack of switches, patch panels and cabling" />
          </div>

          {/* Readings from an example scan, placed as instruments rather than a
              caption bar: the point is that these numbers are ABOUT the rack
              behind them. Labelled as an example so the meter is never mistaken
              for a live feed. */}
          <figcaption className={`${styles.chip} ${styles.chipTop}`}>
            <span className={styles.chipKey}>Rack R-101 · space</span>
            <span className={styles.chipVal}>24<small>/ 42U</small></span>
            <span className={styles.meter}>
              <span className={styles.meterFill} style={{ width: '57%' }} />
            </span>
          </figcaption>

          <div className={`${styles.chip} ${styles.chipBottom}`}>
            <span className={styles.chipKey}>Mapped ports · example</span>
            <span className={styles.chipVal}>48</span>
          </div>
        </figure>
      </div>
    </section>,
    document.body,
  );
}
