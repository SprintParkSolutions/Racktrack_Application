import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import styles from './HomeImmersive.module.css';

// Full-screen immersive home — a dark data-center hero with the content
// bottom-anchored over a scrim. Matches the immersive-home reference. Portalled
// to <body> so it escapes #root's mobile frame and fills the viewport.
export default function HomeImmersive() {
  const navigate = useNavigate();
  const auth = useAuth();
  const authed = auth?.isAuthed;
  const name =
    auth?.user?.username ||
    auth?.user?.name ||
    (auth?.user?.email && String(auth.user.email).split('@')[0]) ||
    '';

  const start = () => navigate(authed ? '/scan' : '/login');

  return createPortal(
    <section className={styles.hero}>
      <div className={styles.bg}>
        <img src="/home-bg.jpg" alt="" />
      </div>
      <div className={styles.scrim} aria-hidden="true" />

      <nav className={styles.nav}>
        <div className={styles.logo}><b>R</b>RackTrack</div>
        <button
          type="button"
          className={styles.signout}
          onClick={authed ? () => { auth.logout(); navigate('/'); } : () => navigate('/login')}
        >
          {authed ? 'Sign out' : 'Sign in'}
        </button>
      </nav>

      <div className={styles.body}>
        <span className={styles.chip}><span className={styles.pulse} />LIVE SCAN · CHENNAI-DC1</span>
        <div className={styles.eyebrow}>{authed && name ? `Welcome back, ${name}` : 'AI rack intelligence'}</div>
        <h1 className={styles.h1}>See every port.<br />Know every rack.</h1>
        <p className={styles.lede}>
          Point your phone at any rack. RackTrack maps every switch, patch panel,
          and cable into live, queryable inventory — in seconds.
        </p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={start}>
            {authed ? 'Start a scan →' : 'Sign in →'}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.ghost}`}
            onClick={() => navigate(authed ? '/profile' : '/signup')}
          >
            {authed ? 'Past scans' : 'Create an organization'}
          </button>
        </div>
        <div className={styles.stats}>
          <div><div className={styles.statNum}>30+</div><div className={styles.statLbl}>device classes</div></div>
          <div><div className={styles.statNum}>0.3s</div><div className={styles.statLbl}>per rack</div></div>
          <div><div className={styles.statNum}>98%</div><div className={styles.statLbl}>accuracy</div></div>
        </div>
      </div>
    </section>,
    document.body,
  );
}
