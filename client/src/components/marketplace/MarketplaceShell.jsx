import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import styles from './MarketplaceShell.module.css';
import './marketplace-theme.css';
import { apiUrl, authFetch } from '../../utils/api';
import { useAuth } from '../../AuthContext.jsx';
import ThemeToggle from '../ThemeToggle.jsx';

/* Shared chrome for every /marketplace/* route.

   Before this existed, each of the seven marketplace pages drew its own
   header and there were no links between them at all — Orders, Alerts,
   Dashboard and Partner accounts were reachable only by typing the URL.
   The section now has one sticky header and one nav, so the pages read
   as a single product rather than seven unrelated screens.

   Browse and My listings are the same route (/marketplace) separated by
   ?tab=mine, so they live in this nav too. That keeps the section to a
   single level of navigation — the old page stacked its own Browse /
   My-listings pill row underneath, which is what made the top of the
   page feel like chrome piled on chrome. */

const NAV = [
  { key: 'browse',    label: 'Browse',     to: '/marketplace' },
  { key: 'mine',      label: 'My listings', to: '/marketplace?tab=mine', authOnly: true },
  { key: 'orders',    label: 'Orders',     to: '/marketplace/orders',    authOnly: true, badge: 'orders' },
  { key: 'alerts',    label: 'Alerts',     to: '/marketplace/alerts',    authOnly: true, badge: 'alerts' },
  { key: 'dashboard', label: 'Dashboard',  to: '/marketplace/dashboard', authOnly: true },
  { key: 'partners',  label: 'Partners',   to: '/marketplace/partners',  authOnly: true },
];

function useUnreadCounts(isAuthed) {
  const [counts, setCounts] = useState({ orders: 0, alerts: 0 });
  useEffect(() => {
    if (!isAuthed) { setCounts({ orders: 0, alerts: 0 }); return; }
    let cancelled = false;
    (async () => {
      // Badges are decoration — a failure here must never surface as an
      // error on a page that otherwise loaded fine, so both reads are
      // swallowed and simply leave the count at zero.
      const read = async (path) => {
        try {
          const res  = await authFetch(apiUrl(path));
          const data = await res.json();
          if (!res.ok || !data.ok) return 0;
          return Number(data.count ?? data.unread ?? 0) || 0;
        } catch { return 0; }
      };
      const [orders, alerts] = await Promise.all([
        read('/api/marketplace/orders/unread-count'),
        read('/api/marketplace/alerts/unread-count'),
      ]);
      if (!cancelled) setCounts({ orders, alerts });
    })();
    return () => { cancelled = true; };
  }, [isAuthed]);
  return counts;
}

export default function MarketplaceShell({
  title,
  subtitle,
  action,          // omit for the default "List an item"; pass null to suppress
  // A path, or a handler for pages where back means "close the thing I
  // have open" rather than "leave" — Orders needs to step out of an open
  // order before it steps out of the page.
  backTo = null,   // null => go back where you came from (see below)
  children,
}) {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [params]  = useSearchParams();
  const { isAuthed } = useAuth();
  const counts    = useUnreadCounts(isAuthed);

  const onNew = () => {
    if (!isAuthed) {
      navigate('/login', { state: { from: '/marketplace/new' } });
      return;
    }
    navigate('/marketplace/new');
  };

  const defaultAction = location.pathname === '/marketplace/new'
    ? null
    : <button type="button" className={styles.primaryBtn} onClick={onNew}>List an item</button>;

  const resolvedAction = action === undefined ? defaultAction : action;

  // Browse and My listings share a pathname, so NavLink's own matching
  // can't tell them apart — the tab decides.
  const onRoot   = location.pathname === '/marketplace';
  const mineTab  = params.get('tab') === 'mine';
  const isActive = (item) => {
    if (item.key === 'browse') return onRoot && !mineTab;
    if (item.key === 'mine')   return onRoot && mineTab;
    return location.pathname.startsWith(item.to);
  };

  return (
    <div className={`mkt-root ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <button
            className={styles.backBtn}
            // Back should return you to whatever you were looking at. This
            // used to be a hardcoded '/', which dropped people on the welcome
            // screen — every other destination came back to where they were.
            onClick={() => {
              if (typeof backTo === 'function') return backTo();
              if (backTo) return navigate(backTo);
              const idx = window.history.state && window.history.state.idx;
              if (typeof idx === 'number' && idx > 0) return navigate(-1);
              return navigate('/scan');
            }}
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className={styles.headerText}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <div className={styles.headerActions}>
            {resolvedAction}
            <ThemeToggle />
          </div>
        </div>

        <nav className={styles.nav} aria-label="Marketplace sections">
          {NAV.filter(item => !item.authOnly || isAuthed).map(item => {
            const count = item.badge ? counts[item.badge] : 0;
            return (
              <NavLink
                key={item.key}
                to={item.to}
                className={`${styles.navItem} ${isActive(item) ? styles.navItemActive : ''}`}
                aria-current={isActive(item) ? 'page' : undefined}
              >
                {item.label}
                {count > 0 && <span className={styles.navBadge}>{count > 99 ? '99+' : count}</span>}
              </NavLink>
            );
          })}
        </nav>
      </header>

      <main className={styles.main}>{children}</main>
    </div>
  );
}
