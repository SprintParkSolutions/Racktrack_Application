import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './MarketplaceDashboardPage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';

const CATEGORY_ICON = {
  cable: '🔌', switch: '🔁', router: '🌐', rack: '🗄️',
  optic: '✨', server: '🖥️', pdu: '⚡', firewall: '🛡️',
  patch_panel: '🧩', other: '📦',
};

const STATUS_CLASS = { active: 'active', sold: 'sold', closed: 'closed' };

function formatCurrency(cents, currency = 'USD') {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch { return `${currency} ${(cents / 100).toFixed(2)}`; }
}

export default function MarketplaceDashboardPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!isAuthed) navigate('/login', { state: { from: '/marketplace/dashboard' }, replace: true });
  }, [isAuthed, navigate]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res  = await authFetch(apiUrl('/api/marketplace/dashboard'));
        const d    = await res.json();
        if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
        setData(d.dashboard);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, []);

  const d = data;

  return (
    <div className={`page page-full ${styles.page}`}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/marketplace')} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className={styles.title}>Seller Dashboard</h1>
      </header>

      {loading && <div className={styles.center}><span className={styles.spinner}/></div>}
      {error && <div className={styles.errBanner}>{error}</div>}

      {d && (
        <>
          {/* Stats grid */}
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{d.listings.total}</span>
              <span className={styles.statLabel}>Total Listings</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{d.listings.active}</span>
              <span className={styles.statLabel}>Active</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{d.listings.sold}</span>
              <span className={styles.statLabel}>Sold</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statValue}>{d.listings.closed}</span>
              <span className={styles.statLabel}>Closed / Expired</span>
            </div>
          </div>

          {/* Revenue */}
          <div className={styles.revenueRow}>
            <div className={`${styles.statCard} ${styles.revCard}`}>
              <span className={styles.statLabel}>Total Revenue</span>
              <span className={styles.revValue}>{formatCurrency(d.sales.revenueCents)}</span>
              <span className={styles.revMeta}>{d.sales.completedOrders} completed order{d.sales.completedOrders !== 1 && 's'}</span>
            </div>
            <div className={`${styles.statCard} ${styles.revCard}`}>
              <span className={styles.statLabel}>Pending Orders</span>
              <span className={styles.revValue}>{d.sales.pendingOrders}</span>
              <span className={styles.revMeta}>awaiting shipment</span>
            </div>
          </div>

          {/* Purchases */}
          <div className={styles.section}>
            <h3 className={styles.sectionLabel}>Your Purchases</h3>
            <div className={styles.purchaseRow}>
              <span>{d.purchases.total} order{d.purchases.total !== 1 && 's'}</span>
              <span className={styles.bold}>{formatCurrency(d.purchases.spentCents)} spent</span>
            </div>
          </div>

          {/* Recent listings */}
          <div className={styles.section}>
            <h3 className={styles.sectionLabel}>Recent Listings</h3>
            {d.recentListings.length === 0 ? (
              <p className={styles.emptySmall}>No listings yet.</p>
            ) : (
              <div className={styles.listingList}>
                {d.recentListings.map(l => (
                  <div key={l.id} className={styles.listingCard}>
                    <span className={styles.listingIcon}>{CATEGORY_ICON[l.category] || '📦'}</span>
                    <div className={styles.listingInfo}>
                      <h4 className={styles.listingTitle}>{l.title}</h4>
                      <span className={`${styles.statusBadge} ${styles[STATUS_CLASS[l.status]] || ''}`}>
                        {l.status}
                      </span>
                    </div>
                    <span className={styles.listingPrice}>
                      {l.priceCents != null ? formatCurrency(l.priceCents, l.currency) : 'Offer'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className={styles.quickLinks}>
            <button className={styles.btnSecondary} onClick={() => navigate('/marketplace?tab=mine')}>
              My Listings
            </button>
            <button className={styles.btnSecondary} onClick={() => navigate('/marketplace/orders')}>
              My Orders
            </button>
            <button className={styles.btnSecondary} onClick={() => navigate('/marketplace/alerts')}>
              Alerts
            </button>
            <button className={styles.btnPrimary} onClick={() => navigate('/marketplace/new')}>
              + New Listing
            </button>
          </div>
        </>
      )}
    </div>
  );
}
