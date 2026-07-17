import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './MarketplaceAlertsPage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';

const CATEGORY_LABEL = {
  cable: 'Cables', switch: 'Switches', router: 'Routers', rack: 'Racks',
  optic: 'Optics', server: 'Servers', pdu: 'PDUs', firewall: 'Firewalls',
  patch_panel: 'Patch panels', other: 'Other',
};

function formatRelative(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d + 'Z').getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

function formatCurrency(cents, currency = 'USD') {
  if (cents == null) return 'Make an offer';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch { return `${currency} ${(cents / 100).toFixed(0)}`; }
}

export default function MarketplaceAlertsPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();

  const [alerts, setAlerts]       = useState([]);
  const [searches, setSearches]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showNew, setShowNew]     = useState(false);

  // New search form
  const [label, setLabel]         = useState('');
  const [query, setQuery]         = useState('');
  const [category, setCategory]   = useState('');
  const [kind, setKind]           = useState('sell');
  const [maxPrice, setMaxPrice]   = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    if (!isAuthed) navigate('/login', { state: { from: '/marketplace/alerts' }, replace: true });
  }, [isAuthed, navigate]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [aRes, sRes] = await Promise.all([
        authFetch(apiUrl('/api/marketplace/alerts')),
        authFetch(apiUrl('/api/marketplace/saved-searches')),
      ]);
      const aData = await aRes.json();
      const sData = await sRes.json();
      if (aData.ok) setAlerts(aData.alerts || []);
      if (sData.ok) setSearches(sData.searches || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const markAllRead = async () => {
    await authFetch(apiUrl('/api/marketplace/alerts/mark-read'), { method: 'POST' });
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
  };

  const dismissAlert = async (id) => {
    await authFetch(apiUrl(`/api/marketplace/alerts/${id}`), { method: 'DELETE' });
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const deleteSavedSearch = async (id) => {
    if (!confirm('Delete this saved search? You will stop receiving alerts for it.')) return;
    await authFetch(apiUrl(`/api/marketplace/saved-searches/${id}`), { method: 'DELETE' });
    setSearches(prev => prev.filter(s => s.id !== id));
    setAlerts(prev => prev.filter(a => a.searchLabel !== searches.find(s => s.id === id)?.label));
  };

  const saveSearch = async (e) => {
    e.preventDefault();
    if (!label.trim()) { setError('Label is required'); return; }
    setSaving(true); setError(null);
    try {
      const res = await authFetch(apiUrl('/api/marketplace/saved-searches'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          query: query.trim() || undefined,
          category: category || undefined,
          kind,
          maxPrice: maxPrice ? Number(maxPrice) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSearches(prev => [data.search, ...prev]);
      setShowNew(false);
      setLabel(''); setQuery(''); setCategory(''); setKind('sell'); setMaxPrice('');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const unreadCount = alerts.filter(a => !a.read).length;

  return (
    <div className={`page page-full ${styles.page}`}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/marketplace')} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className={styles.title}>
          Alerts
          {unreadCount > 0 && <span className={styles.unreadBadge}>{unreadCount} new</span>}
        </h1>
        {unreadCount > 0 && (
          <button className={styles.markReadBtn} onClick={markAllRead}>Mark all read</button>
        )}
      </header>

      {loading && <div className={styles.center}><span className={styles.spinner}/></div>}

      {!loading && (
        <>
          {/* Alerts */}
          <div className={styles.section}>
            {alerts.length === 0 ? (
              <div className={styles.empty}>
                <p>No alerts yet. Save a search below and you'll be notified when new listings match.</p>
              </div>
            ) : (
              <div className={styles.alertList}>
                {alerts.map(a => (
                  <div key={a.id} className={`${styles.alertCard} ${a.read ? styles.alertRead : ''}`}>
                    <div className={styles.alertMain}>
                      <p className={styles.alertLabel}>New match for "{a.searchLabel}"</p>
                      <h3 className={styles.alertTitle}>{a.listing.title}</h3>
                      <p className={styles.alertMeta}>
                        {CATEGORY_LABEL[a.listing.category] || a.listing.category}
                        {a.listing.condition && <> · {a.listing.condition}</>}
                        {' · '}{formatCurrency(a.listing.priceCents, a.listing.currency)}
                        {a.listing.sellerUsername && <> · @{a.listing.sellerUsername}</>}
                        {' · '}{formatRelative(a.createdAt)}
                      </p>
                    </div>
                    <div className={styles.alertActions}>
                      <button className={styles.linkBtn}
                              onClick={() => navigate(`/marketplace?q=${encodeURIComponent(a.listing.title)}`)}>
                        View
                      </button>
                      <button className={styles.dismissBtn} onClick={() => dismissAlert(a.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Saved Searches */}
          <div className={styles.divider} />
          <div className={styles.section}>
            <h3 className={styles.sectionLabel}>My Saved Searches</h3>
            {searches.length === 0 && !showNew && (
              <p className={styles.emptySmall}>No saved searches yet.</p>
            )}
            <div className={styles.searchList}>
              {searches.map(s => (
                <div key={s.id} className={styles.searchCard}>
                  <div className={styles.searchInfo}>
                    <h4 className={styles.searchLabel}>{s.label}</h4>
                    <p className={styles.searchMeta}>
                      {s.category ? CATEGORY_LABEL[s.category] || s.category : 'Any category'}
                      {' · '}{s.kind === 'want' ? 'Wanted' : 'For Sale'}
                      {s.maxPrice != null && <> · under ${s.maxPrice}</>}
                    </p>
                  </div>
                  <button className={styles.deleteBtn} onClick={() => deleteSavedSearch(s.id)}>×</button>
                </div>
              ))}
            </div>

            {showNew ? (
              <form className={styles.newForm} onSubmit={saveSearch}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Label *</span>
                  <input className={styles.input} placeholder='e.g. "Cisco Switch under $2k"'
                         value={label} onChange={(e) => setLabel(e.target.value)} required />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Keyword (optional)</span>
                  <input className={styles.input} placeholder="Cisco, Dell, SFP…"
                         value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <div className={styles.row2}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Category</span>
                    <select className={styles.input} value={category}
                            onChange={(e) => setCategory(e.target.value)}>
                      <option value="">Any</option>
                      {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Max price</span>
                    <input type="number" className={styles.input} placeholder="No limit"
                           value={maxPrice} min={0} onChange={(e) => setMaxPrice(e.target.value)} />
                  </label>
                </div>
                <div className={styles.kindToggle}>
                  <button type="button"
                          className={`${styles.kindBtn} ${kind === 'sell' ? styles.kindActive : ''}`}
                          onClick={() => setKind('sell')}>For Sale</button>
                  <button type="button"
                          className={`${styles.kindBtn} ${kind === 'want' ? styles.kindActive : ''}`}
                          onClick={() => setKind('want')}>Wanted</button>
                </div>
                {error && <div className={styles.errBanner}>{error}</div>}
                <div className={styles.formActions}>
                  <button type="button" className={styles.btnSecondary}
                          onClick={() => setShowNew(false)}>Cancel</button>
                  <button type="submit" className={styles.btnPrimary} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Search'}
                  </button>
                </div>
              </form>
            ) : (
              <button className={styles.btnPrimary} onClick={() => setShowNew(true)}>
                + Save New Search
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
