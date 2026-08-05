import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import styles from './HomeHero.module.css';

/**
 * Home hero — light, two-column.
 *
 * The claim sits on the left and a real rack on the right, with the numbers a
 * scan produces read out over the photo. That pairing is the argument: the
 * product's output is a precise description of a physical thing, so the thing
 * and its description appear together rather than the copy sitting on a stock
 * background.
 *
 * Portalled to <body> like the dark hero it replaces, so it escapes #root's
 * mobile frame and fills the viewport. Unlike that one it scrolls — there is
 * more here than fits a phone screen.
 */

const ArrowR = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
);

// What the pipeline actually identifies, which is also the answer to the
// question the hero raises ("documented how precisely?").
const READS = ['Switches', 'Patch panels', 'Firewalls', 'PDUs', 'Cables', 'Ports'];

export default function HomeHero() {
  const navigate = useNavigate();
  const auth = useAuth();
  const authed = auth?.isAuthed;

  return createPortal(
    <section className={styles.hero}>
      <div className={styles.grid} aria-hidden="true" />

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
          <span className={styles.badge}>
            <span className={styles.badgeDot} aria-hidden="true" />
            Now scanning two racks in a single pass
          </span>

          <h1 className={styles.h1}>
            Every rack.<br />
            Every unit.<br />
            <span className={styles.blue}>Precisely</span><br />
            <span className={styles.teal}>documented.</span>
          </h1>

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

        </div>

        <figure className={styles.shot}>
          <img src="/home-bg.jpg" alt="A network rack of switches, patch panels and cabling" />
          <figcaption className={styles.readout}>
            <div className={styles.readoutTop}>
              <span className={styles.rackId}>Rack R-101 · Chennai-DC1</span>
              {/* Labelled as an example rather than dressed up as a live feed —
                  the numbers below are illustrative, not a running system. */}
              <span className={styles.sampleTag}>
                <span className={styles.sampleDot} aria-hidden="true" />
                Example scan
              </span>
            </div>
            <div className={styles.stats}>
              <div>
                <div className={styles.statVal}>24U / 42U</div>
                <div className={styles.statKey}>Space used</div>
              </div>
              <div>
                <div className={styles.statVal}>48</div>
                <div className={styles.statKey}>Mapped ports</div>
              </div>
              <div>
                <div className={styles.statVal}>5</div>
                <div className={styles.statKey}>Devices found</div>
              </div>
            </div>
          </figcaption>
        </figure>

        {/* Where the reference put customer logos. Those would have to be real
            companies to sit here, so this states a verifiable capability
            instead. Placed after the photo in source order so that on a phone —
            where the columns collapse to one — the rack is the second thing
            seen rather than the fifth. */}
        <div className={styles.reads}>
          <p className={styles.eyebrow}>Reads every unit in the rack</p>
          <ul className={styles.readsList}>
            {READS.map(r => <li key={r}>{r}</li>)}
          </ul>
        </div>
      </div>
    </section>,
    document.body,
  );
}
