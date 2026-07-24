import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import styles from './HomeDashboard.module.css';

// The signed-in desktop/tablet home — rendered inside the shell (sidebar).
// A dashboard-style hero: headline + primary actions + at-a-glance stats on the
// left, and a rack visual annotated with live data callouts on the right.

const ScanIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2"/><rect x="8" y="8" width="8" height="8" rx="1.5"/></svg>
);
const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
);
const LayersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>
);
const BoltIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></svg>
);
const TargetIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>
);
const SparkIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"/><path d="M19 15l.7 1.8L21.5 17.5l-1.8.7L19 20l-.7-1.8L16.5 17.5l1.8-.7L19 15z"/></svg>
);
const ArrowIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
);
const ChartIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5"/><path d="M4 15l4-4 3 3 5-6 4 4"/></svg>
);

export default function HomeDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const name =
    user?.username ||
    user?.name ||
    (user?.email && String(user.email).split('@')[0]) ||
    'there';

  return (
    <div className={styles.wrap}>
      <div className={styles.grid}>
        {/* ── Left: hero + stats ── */}
        <div className={styles.left}>
          <span className={styles.welcome}><span aria-hidden="true">👋</span> Welcome back, {name}</span>

          <h1 className={styles.headline}>
            Your infrastructure.<br /><span className={styles.headlineDim}>Fully visible.</span>
          </h1>

          <p className={styles.sub}>
            RackTrack gives you real-time visibility into every device, port, and
            cable across your network.
          </p>

          <div className={styles.actions}>
            <button className={styles.primary} onClick={() => navigate('/scan')}>
              Start a new scan <ScanIcon />
            </button>
            <button className={styles.secondary} onClick={() => navigate('/profile')}>
              View past scans <ClockIcon />
            </button>
          </div>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statIcon}><LayersIcon /></span>
              <b className={styles.statNum}>30+</b>
              <span className={styles.statLabel}>Device classes</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statIcon}><BoltIcon /></span>
              <b className={styles.statNum}>0.3s</b>
              <span className={styles.statLabel}>Per rack scan</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statIcon}><TargetIcon /></span>
              <b className={styles.statNum}>98%</b>
              <span className={styles.statLabel}>Accuracy</span>
            </div>
          </div>

          <button
            className={styles.aiCard}
            onClick={() => navigate('/scan')}
            aria-label="Learn how AI scanning works"
          >
            <span className={styles.aiSpark}><SparkIcon /></span>
            <span className={styles.aiText}>
              <span className={styles.aiTitle}>Intelligent. Accurate. Instant.</span>
              <span className={styles.aiSub}>
                AI-powered scanning maps your entire rack in seconds with unmatched precision.
              </span>
            </span>
            <span className={styles.aiArrow}><ArrowIcon /></span>
          </button>
        </div>

        {/* ── Right: rack visual + live callouts ── */}
        <div className={styles.visual} aria-hidden="true">
          <div className={styles.visualStage}>
            <img src="/hero.png" alt="" className={styles.rack} />

            <div className={`${styles.callout} ${styles.calloutTop}`}>
              <span className={styles.calloutLabel}><span className={`${styles.dot} ${styles.dotLive}`} /> Live mapping</span>
              <span className={styles.calloutValue}>24 racks active</span>
            </div>

            <div className={`${styles.callout} ${styles.calloutRight}`}>
              <span className={styles.calloutLabel}><span className={`${styles.dot} ${styles.dotBlue}`} /> Ports mapped</span>
              <span className={styles.calloutValueLg}>1,048</span>
            </div>

            <div className={`${styles.callout} ${styles.calloutLeft}`}>
              <span className={styles.calloutLabel}><span className={`${styles.dot} ${styles.dotGreen}`} /> Devices detected</span>
              <span className={styles.calloutValueLg}>540+</span>
            </div>

            <div className={styles.chartChip}><ChartIcon /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
