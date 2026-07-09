import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ProfilePage.module.css';
import { useAuth } from '../AuthContext.jsx';
import { useConnections } from '../ConnectionsContext.jsx';
import { TYPE_INFO } from '../utils/connectionsApi';
import { apiUrl, authFetch } from '../utils/api';

function formatJoined(d) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  } catch { return null; }
}
function formatRelative(d) {
  if (!d) return '—';
  const ms = Date.now() - new Date(d).getTime();
  if (isNaN(ms) || ms < 0) return 'now';
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  return `${Math.floor(days/30)}mo ago`;
}

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { active: activeConnection } = useConnections();
  const [scans, setScans] = useState([]);
  const [scansLoading, setScansLoading] = useState(true);
  const [scansError, setScansError] = useState(null);
  const [showAllScans, setShowAllScans] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setScansLoading(true);
    authFetch(apiUrl('/api/scans'))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(data => { if (!cancelled) { setScans(data.scans || []); setScansError(null); } })
      .catch(err => { if (!cancelled) setScansError(err.message); })
      .finally(() => { if (!cancelled) setScansLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const initial = useMemo(() => (user?.username || user?.email || '?').charAt(0).toUpperCase(), [user]);
  const joined  = useMemo(() => formatJoined(user?.created_at), [user]);
  // Show the 5 most recent by default; "Show all" reveals the full history.
  const recent  = useMemo(() => (showAllScans ? scans : scans.slice(0, 5)), [scans, showAllScans]);

  const onSignOut = () => {
    logout();
    navigate('/', { replace: true });
  };

  const openScan = async (rackId) => {
    try {
      const meta = scans.find(s => s.rackId === rackId);
      const res  = await authFetch(apiUrl(`/api/scan/${rackId}/report?format=json`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load scan');
      const result = {
        scanId: rackId, rackId, cached: true, timestamp: meta?.timestamp,
        devices: data.devices || [], units_detected: data.units_detected || [],
        originalExt: 'jpg',
      };
      // Navigate WITH the rackId in the URL (not bare /results) so the
      // Overview tab / sidebar link matches the route and highlights, and the
      // page is a proper deep link. state.result still preloads the data so it
      // doesn't refetch.
      navigate(`/results/${rackId}`, { state: { result } });
    } catch (err) { setScansError(err.message); }
  };

  return (
    <div className={`page page-full ${styles.profile}`}>
      {/* ── Sticky white header — "PROFILE" left, logout icon right ── */}
      <header className={styles.topbar}>
        <h1 className={styles.topbarTitle}>Profile</h1>
        <button
          type="button"
          className={styles.topbarIconBtn}
          onClick={() => setConfirmingSignOut(true)}
          aria-label="Sign out">
          <span className="material-symbols-outlined" aria-hidden="true">logout</span>
        </button>
      </header>

      <main className={styles.main}>
        {/* ── Hero: centered avatar + identity ── */}
        <section className={styles.hero}>
          <div className={styles.avatar}>
            <span className={styles.avatarInitial}>{initial}</span>
          </div>
          <h2 className={styles.name}>{user?.username || 'Guest'}</h2>
          {user?.email && <p className={styles.email}>{user.email}</p>}
          <p className={styles.metaLine}>
            {user?.tenant?.name || 'Sprintpark'}
            {joined && <> · Since {joined}</>}
          </p>
        </section>

        {/* ── Administration (owner / org admin only) ── */}
        {(user?.role === 'owner' || user?.role === 'org_admin') && (
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionLabel}>Administration</h3>
              <span className={styles.sectionDot} aria-hidden="true"/>
            </div>
            <ul className={styles.rowList}>
              <li
                className={styles.row}
                onClick={() => navigate('/organizations')}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate('/organizations'); }}>
                <div className={styles.rowIcon}>
                  <span className="material-symbols-outlined" aria-hidden="true">space_dashboard</span>
                </div>
                <div className={styles.rowMain}>
                  <h4 className={styles.rowTitle}>
                    {user?.role === 'owner' ? 'Owner Dashboard' : 'Organization Dashboard'}
                  </h4>
                  <p className={styles.rowMeta}>
                    {user?.role === 'owner'
                      ? 'All organizations, sites & scans'
                      : 'Sites, members & scan activity'}
                  </p>
                </div>
                <span className={`material-symbols-outlined ${styles.rowChevron}`} aria-hidden="true">chevron_right</span>
              </li>
            </ul>
          </section>
        )}

        {/* ── Integrations (org admin only) ── */}
        {(user?.role === 'owner' || user?.role === 'org_admin') && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionLabel}>Integrations</h3>
            <span className={styles.sectionDot} aria-hidden="true"/>
          </div>
          <ul className={styles.rowList}>
            <li
              className={styles.row}
              onClick={() => navigate('/connections')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate('/connections'); }}>
              <div className={styles.rowIcon}>
                <span className="material-symbols-outlined" aria-hidden="true">dns</span>
              </div>
              <div className={styles.rowMain}>
                <h4 className={styles.rowTitle}>
                  {activeConnection ? activeConnection.name : 'Connect a database'}
                </h4>
                <p className={styles.rowMeta}>
                  {activeConnection
                    ? `${TYPE_INFO[activeConnection.type]?.label || activeConnection.type} · Active`
                    : 'Tap to set up ServiceNow, NetBox, Orion…'}
                </p>
              </div>
              <span className={`material-symbols-outlined ${styles.rowChevron}`} aria-hidden="true">chevron_right</span>
            </li>
          </ul>
        </section>
        )}

        {/* ── Recent scans ── */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionLabel}>Recent Scans</h3>
            <span className={styles.sectionDot} aria-hidden="true"/>
          </div>

          {scansError && <div className={styles.errBanner}>{scansError}</div>}

          {!scansLoading && recent.length === 0 && !scansError ? (
            <div className={styles.empty}>
              <p className={styles.emptyText}>No scans yet.</p>
              <button className={styles.startBtn} onClick={() => navigate('/scan')}>
                Start your first scan
              </button>
            </div>
          ) : (
            <ul className={styles.rowList}>
              {recent.map(s => (
                <li
                  key={s.rackId}
                  className={styles.row}
                  onClick={() => openScan(s.rackId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') openScan(s.rackId); }}>
                  <div className={styles.rowThumb}>
                    {s.image
                      ? <img src={apiUrl(s.image)} alt="" loading="lazy" />
                      : <span className="material-symbols-outlined" aria-hidden="true">terminal</span>}
                  </div>
                  <div className={styles.rowMain}>
                    <h4 className={`${styles.rowTitle} ${styles.rowTitleMono}`}>{s.rackId}</h4>
                    <p className={styles.rowMeta}>
                      {s.deviceCount} dev · {s.unitCount} units · {s.portCount} port{s.portCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className={styles.rowEnd}>
                    <span className={styles.rowTime}>{formatRelative(s.timestamp)}</span>
                    <span className={`material-symbols-outlined ${styles.rowChevron}`} aria-hidden="true">chevron_right</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!scansLoading && scans.length > 5 && (
            <button
              type="button"
              className={styles.showAllBtn}
              onClick={() => setShowAllScans(v => !v)}
            >
              {showAllScans ? 'Show less' : `Show all ${scans.length} scans`}
            </button>
          )}
        </section>
      </main>

      {/* ── Sign-out confirm modal ── */}
      {confirmingSignOut && (
        <div className={styles.confirmBackdrop}>
          <div className={styles.confirmModal}>
            <div className={styles.confirmIcon}>
              <span className="material-symbols-outlined" aria-hidden="true">logout</span>
            </div>
            <h3 className={styles.confirmTitle}>Sign out?</h3>
            <p className={styles.confirmMsg}>You'll need to sign in again to scan racks.</p>
            <div className={styles.confirmActions}>
              <button className={styles.confirmCancel} onClick={() => setConfirmingSignOut(false)}>Cancel</button>
              <button className={styles.confirmGo} onClick={onSignOut}>Sign out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
