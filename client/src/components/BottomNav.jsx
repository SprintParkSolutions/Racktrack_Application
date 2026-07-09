import { NavLink, useNavigate } from 'react-router-dom';
import styles from './BottomNav.module.css';
import { useShutter } from '../ShutterContext.jsx';
import { useAuth } from '../AuthContext.jsx';

/* ──────────────────────────────────────────────────────────────────────
   BottomNav — white surface, 3 inline tabs (HOME / SCAN / PROFILE).
   Each tab: filled-when-active Material Symbol + uppercase label + a
   tiny black dot indicator below the active label.
   No floating FAB.
   ────────────────────────────────────────────────────────────────────── */

const TABS = [
  { to: '/',        end: true,  icon: 'home',             label: 'HOME'    },
  { to: '/scan',    end: false, icon: 'qr_code_scanner',  label: 'SCAN'    },
  { to: '/profile', end: false, icon: 'person',           label: 'PROFILE' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { fn: shutterFn, canShoot } = useShutter();
  const { isAuthed } = useAuth();

  if (!isAuthed) return null;

  // While the camera viewfinder is live on the Scan page, ScanPage registers
  // a shutter handler. We hijack the SCAN tab onClick to fire it instead of
  // navigating, so the user can capture without losing this nav.
  const handleScanClick = (e) => {
    if (typeof shutterFn === 'function') {
      e.preventDefault();
      if (canShoot) shutterFn();
    }
  };

  return (
    <nav className={styles.nav}>
      <div className={styles.bar}>
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            onClick={t.to === '/scan' ? handleScanClick : undefined}
            className={({ isActive }) => `${styles.tab} ${isActive ? styles.active : ''}`}
          >
            <span
              className={`material-symbols-outlined ${styles.icon}`}
              aria-hidden="true"
            >
              {t.icon}
            </span>
            <span className={styles.label}>{t.label}</span>
            <span className={styles.dot} aria-hidden="true" />
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
