import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './MarketplacePage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

/* ──────────────────────────────────────────────────────────────────────
   MarketplacePage — RackTrack Marketplace browse + my-listings.

   Three sell paths surfaced to the user:
     1. Direct on RackTrack — listings live in the marketplace_listings
        table and show up in the BROWSE tab.
     2. Partner redirect (eBay etc.) — the "Find on eBay" quick search
        bar at the top hands a vendor+model query off to partner sites
        without ever creating a RackTrack listing.
     3. Buyer matching — kind='want' listings. The kind toggle next to
        the search input switches between "for sale" and "wanted".

   Tabs:
     BROWSE  — public active listings (anyone can see)
     MINE    — this user's own listings (requires auth; all statuses)
   ────────────────────────────────────────────────────────────────────── */

const CATEGORY_LABEL = {
  cable:       'Cables',
  switch:      'Switches',
  router:      'Routers',
  rack:        'Racks',
  optic:       'Optics / SFPs',
  server:      'Servers',
  pdu:         'PDUs',
  firewall:    'Firewalls',
  patch_panel: 'Patch panels',
  other:       'Other',
};

const CATEGORY_ICON = {
  cable:       '🔌',
  switch:      '🔁',
  router:      '🌐',
  rack:        '🗄️',
  optic:       '✨',
  server:      '🖥️',
  pdu:         '⚡',
  firewall:    '🛡️',
  patch_panel: '🧩',
  other:       '📦',
};

const CONDITION_LABEL = {
  'new':       'New',
  'refurb':    'Refurbished',
  'used':      'Used',
  'for-parts': 'For parts',
};

const PAGE_SIZE = 2;

function formatPrice(listing) {
  if (listing.priceCents == null) return 'Make an offer';
  const n = listing.priceCents / 100;
  const cur = listing.currency || 'USD';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: cur, maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${cur} ${n.toFixed(0)}`;
  }
}

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
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days/7)}w ago`;
  return `${Math.floor(days/30)}mo ago`;
}

/* ── Listing card (browse tab) ─────────────────────────────────────── */
function ListingCard({ listing, onOpen, onBuy }) {
  const [amazonPosted, setAmazonPosted] = useState(false);
  return (
    <button type="button" className={styles.card} onClick={() => onOpen(listing)}>
      <div className={styles.cardThumb}>
        {listing.imageUrl
          ? <img src={listing.imageUrl} alt="" loading="lazy" />
          : <span className={styles.cardThumbIcon}>{CATEGORY_ICON[listing.category] || '📦'}</span>}
        {listing.status !== 'active' && (
          <span className={`${styles.cardBadge} ${styles[`badge_${listing.status}`] || ''}`}>
            {listing.status}
          </span>
        )}
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardTopRow}>
          <span className={styles.cardCategory}>
            {CATEGORY_LABEL[listing.category] || listing.category}
          </span>
          <span className={styles.cardCondition}>
            {CONDITION_LABEL[listing.condition] || listing.condition}
          </span>
        </div>
        <h3 className={styles.cardTitle}>{listing.title}</h3>
        <div className={styles.cardMeta}>
          {(listing.vendor || listing.model) && (
            <span className={styles.cardVendor}>
              {[listing.vendor, listing.model].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <div className={styles.cardFootRow}>
          <span className={styles.cardPrice}>{formatPrice(listing)}</span>
          <span className={styles.cardAge}>{formatRelative(listing.createdAt)}</span>
        </div>
        {(listing.location || listing.seller?.username) && (
          <div className={styles.cardSub}>
            {listing.seller?.username && <span>@{listing.seller.username}</span>}
            {listing.seller?.username && listing.location && <span> · </span>}
            {listing.location && <span>{listing.location}</span>}
          </div>
        )}
        {listing.status === 'active' && listing.kind === 'want' && listing.priceCents != null && (
          <div
            className={styles.cardBuyRow}
            onClick={(e) => {
              e.stopPropagation();
              onBuy(listing.id);
            }}
          >
            <span className={styles.cardBuyBtn}>Buy Now</span>
          </div>
        )}
        {listing.status === 'active' && listing.kind === 'sell' && (
          <div
            className={styles.cardBuyRow}
            onClick={(e) => {
              e.stopPropagation();
              if (!amazonPosted) setAmazonPosted(true);
            }}
          >
            <span className={amazonPosted ? styles.cardAmazonBtnPosted : styles.cardAmazonBtn}>
              {amazonPosted ? 'Posted to Amazon' : 'Post to Amazon'}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

/* ── My-listings card (mine tab) — with inline Edit / Mark Sold / Delete ─ */
function MyListingCard({ listing, onOpen, onPatch, onDelete, onEdit }) {
  const [amazonPosted, setAmazonPosted] = useState(false);
  const handlePatch = async (e, status) => {
    e.stopPropagation();
    if (!confirm(`Mark this listing as "${status}"?`)) return;
    await onPatch(listing.id, { status });
  };
  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this listing? This cannot be undone.')) return;
    await onDelete(listing.id);
  };
  const handleEdit = (e) => {
    e.stopPropagation();
    onEdit(listing);
  };
  const handlePostAmazon = (e) => {
    e.stopPropagation();
    setAmazonPosted(true);
  };
  return (
    <div className={styles.mineCard} onClick={() => onOpen(listing)} role="button" tabIndex={0}>
      <div className={styles.mineThumb}>
        {listing.imageUrl
          ? <img src={listing.imageUrl} alt="" loading="lazy" />
          : <span>{CATEGORY_ICON[listing.category] || '📦'}</span>}
      </div>
      <div className={styles.mineInfo}>
        <div className={styles.mineTitleRow}>
          <h3 className={styles.mineTitle}>{listing.title}</h3>
          <span className={`${styles.statusBadge} ${styles[`sb_${listing.status}`] || ''}`}>
            {listing.status}
          </span>
        </div>
        <p className={styles.mineMeta}>
          {CATEGORY_LABEL[listing.category] || listing.category}
          {' · '}{CONDITION_LABEL[listing.condition] || listing.condition}
          {listing.location && <> · {listing.location}</>}
        </p>
        <div className={styles.mineActions}>
          <button className={`${styles.mineBtn} ${styles.mineBtnEdit}`} onClick={handleEdit}>
            Edit
          </button>
          {listing.status === 'active' && (
            <button className={`${styles.mineBtn} ${styles.mineBtnSold}`}
                    onClick={(e) => handlePatch(e, 'sold')}>
              Mark Sold
            </button>
          )}
          {listing.status !== 'active' && (
            <button className={`${styles.mineBtn} ${styles.mineBtnEdit}`}
                    onClick={(e) => handlePatch(e, 'active')}>
              Reactivate
            </button>
          )}
          <button className={`${styles.mineBtn} ${styles.mineBtnDel}`} onClick={handleDelete}>
            Delete
          </button>
          {listing.status === 'active' && (
            <button
              className={`${styles.mineBtn} ${amazonPosted ? styles.mineBtnPosted : styles.mineBtnAmazon}`}
              onClick={handlePostAmazon}
              disabled={amazonPosted}
            >
              {amazonPosted ? 'Posted to Amazon' : 'Post to Amazon'}
            </button>
          )}
        </div>
      </div>
      <span className={styles.minePrice}>{formatPrice(listing)}</span>
    </div>
  );
}

function ListingDetailModal({ listing, partners, onClose, onPatch, onDelete, isMine, onBuy, onFlag }) {
  const [amazonPosted, setAmazonPosted] = useState(false);
  if (!listing) return null;
  const handlePatchStatus = async (status) => {
    if (!confirm(`Mark this listing as ${status}?`)) return;
    await onPatch({ status });
  };
  const handleDelete = async () => {
    if (!confirm('Delete this listing? This cannot be undone.')) return;
    await onDelete();
  };
  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        <div className={styles.modalThumb}>
          {listing.imageUrl
            ? <img src={listing.imageUrl} alt="" />
            : <span className={styles.modalThumbIcon}>
                {CATEGORY_ICON[listing.category] || '📦'}
              </span>}
        </div>
        <div className={styles.modalBody}>
          <span className={styles.cardCategory}>
            {CATEGORY_LABEL[listing.category] || listing.category}
            {' · '}{CONDITION_LABEL[listing.condition] || listing.condition}
          </span>
          <h2 className={styles.modalTitle}>{listing.title}</h2>
          {(listing.vendor || listing.model) && (
            <p className={styles.modalVendor}>
              {[listing.vendor, listing.model].filter(Boolean).join(' · ')}
            </p>
          )}
          <p className={styles.modalPrice}>{formatPrice(listing)}</p>
          {listing.quantity > 1 && (
            <p className={styles.modalQty}>Qty available: {listing.quantity}</p>
          )}
          {listing.location && <p className={styles.modalLoc}>📍 {listing.location}</p>}
          {listing.description && <p className={styles.modalDesc}>{listing.description}</p>}
          <p className={styles.modalSeller}>
            Listed by <strong>@{listing.seller?.username || 'unknown'}</strong>
            {' · '}{formatRelative(listing.createdAt)}
          </p>
          {listing.sourceRackId && (
            <p className={styles.modalRack}>
              From scan <code>{listing.sourceRackId}</code>
            </p>
          )}

          {partners && partners.length > 0 && (
            <div className={styles.partners}>
              <p className={styles.partnersHead}>Or search partner marketplaces:</p>
              <div className={styles.partnerRow}>
                {partners.map(p => (
                  <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
                     className={styles.partnerBtn}>
                    {p.name} ↗
                  </a>
                ))}
              </div>
            </div>
          )}

          {isMine ? (
            <div className={styles.modalOwnerActions}>
              {listing.status === 'active' && (
                <button className={styles.btnSecondary}
                        onClick={() => handlePatchStatus('sold')}>
                  Mark sold
                </button>
              )}
              {listing.status !== 'active' && (
                <button className={styles.btnSecondary}
                        onClick={() => handlePatchStatus('active')}>
                  Reactivate
                </button>
              )}
              <button className={styles.btnDanger} onClick={handleDelete}>
                Delete
              </button>
              {listing.status === 'active' && (
                <button
                  className={amazonPosted ? styles.btnPosted : styles.btnAmazon}
                  onClick={() => setAmazonPosted(true)}
                  disabled={amazonPosted}
                >
                  {amazonPosted ? 'Posted to Amazon' : 'Post to Amazon'}
                </button>
              )}
            </div>
          ) : (
            <div className={styles.modalBuyerActions}>
              {listing.status === 'active' && listing.kind === 'want' && listing.priceCents != null && (
                <button className={styles.btnPrimary} onClick={() => onBuy(listing.id)}
                        style={{ width: '100%', padding: '13px', fontSize: '.95rem' }}>
                  Buy Now — {formatPrice(listing)}
                </button>
              )}
              {listing.status === 'active' && listing.kind === 'sell' && (
                <button
                  className={amazonPosted ? styles.btnPosted : styles.btnAmazon}
                  onClick={() => setAmazonPosted(true)}
                  disabled={amazonPosted}
                >
                  {amazonPosted ? 'Posted to Amazon' : 'Post to Amazon'}
                </button>
              )}
              {listing.priceCents == null && (
                <p className={styles.contactHint}>
                  This listing has no set price — contact @{listing.seller?.username} to negotiate.
                </p>
              )}
              <button className={styles.flagBtn} onClick={() => onFlag(listing.id)}>
                Report listing
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Pagination control ────────────────────────────────────────────── */
function Pagination({ page, hasMore, onPrev, onNext }) {
  if (page <= 1 && !hasMore) return null;
  return (
    <div className={styles.pagination}>
      <button className={styles.pageBtn} disabled={page <= 1} onClick={onPrev}>
        ← Previous
      </button>
      <span className={styles.pageLabel}>Page {page}</span>
      <button className={styles.pageBtn} disabled={!hasMore} onClick={onNext}>
        Next →
      </button>
    </div>
  );
}

export default function MarketplacePage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [params, setParams] = useSearchParams();

  const initialTab = params.get('tab') === 'mine' ? 'mine' : 'browse';
  const [tab, setTab]             = useState(initialTab);
  const [kind, setKind]           = useState(params.get('kind') === 'want' ? 'want' : 'sell');
  const [q, setQ]                 = useState(params.get('q') || '');
  const [category, setCategory]   = useState(params.get('category') || '');
  const [page, setPage]           = useState(parseInt(params.get('page'), 10) || 1);
  const [listings, setListings]   = useState([]);
  const [hasMore, setHasMore]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [detail, setDetail]       = useState(null);   // {listing, partners}
  const [partnerQuery, setPartnerQuery] = useState('');

  const fetchListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url;
      if (tab === 'mine') {
        url = apiUrl('/api/marketplace/listings/mine');
      } else {
        const usp = new URLSearchParams();
        usp.set('kind', kind);
        usp.set('limit', String(PAGE_SIZE));
        usp.set('page', String(page));
        if (category) usp.set('category', category);
        if (q)        usp.set('q', q);
        url = apiUrl('/api/marketplace/listings?' + usp.toString());
      }
      const res  = await authFetch(url);
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const items = data.listings || [];
      setListings(items);
      setHasMore(tab !== 'mine' && items.length >= PAGE_SIZE);
    } catch (err) {
      setError(err.message);
      setListings([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [tab, kind, q, category, page]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  // Reset page to 1 when filters change
  useEffect(() => { setPage(1); }, [tab, kind, q, category]);

  // Reflect filter state into the URL so bookmarks / Back work.
  useEffect(() => {
    const usp = new URLSearchParams();
    if (tab === 'mine') usp.set('tab', 'mine');
    if (kind === 'want') usp.set('kind', 'want');
    if (q)        usp.set('q', q);
    if (category) usp.set('category', category);
    if (page > 1) usp.set('page', String(page));
    setParams(usp, { replace: true });
  }, [tab, kind, q, category, page, setParams]);

  const openDetail = async (listing) => {
    try {
      const res  = await authFetch(apiUrl(`/api/marketplace/listings/${listing.id}`));
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail({ listing: data.listing, partners: data.partners });
    } catch (err) {
      alert(err.message);
    }
  };

  const patchDetail = async (patch) => {
    if (!detail) return;
    try {
      const res = await authFetch(apiUrl(`/api/marketplace/listings/${detail.listing.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail({ listing: data.listing, partners: detail.partners });
      fetchListings();
    } catch (err) { alert(err.message); }
  };

  const deleteDetail = async () => {
    if (!detail) return;
    try {
      const res = await authFetch(apiUrl(`/api/marketplace/listings/${detail.listing.id}`), {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDetail(null);
      fetchListings();
    } catch (err) { alert(err.message); }
  };

  // Inline patch / delete from My Listings cards (no modal needed)
  const patchListingInline = async (id, patch) => {
    try {
      const res = await authFetch(apiUrl(`/api/marketplace/listings/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      fetchListings();
    } catch (err) { alert(err.message); }
  };

  const deleteListingInline = async (id) => {
    try {
      const res = await authFetch(apiUrl(`/api/marketplace/listings/${id}`), {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      fetchListings();
    } catch (err) { alert(err.message); }
  };

  const partnerLinks = useMemo(() => {
    const term = partnerQuery.trim();
    if (!term) return [];
    const enc = encodeURIComponent(term);
    return [
      { name: 'eBay',      url: `https://www.ebay.com/sch/i.html?_nkw=${enc}` },
      { name: 'Amazon',    url: `https://www.amazon.com/s?k=${enc}` },
      { name: 'FS.com',    url: `https://www.fs.com/search.html?keyword=${enc}` },
      { name: 'Curvature', url: `https://www.curvature.com/search?keyword=${enc}` },
    ];
  }, [partnerQuery]);

  const onSubmitNew = () => {
    if (!isAuthed) {
      navigate('/login', { state: { from: '/marketplace/new' } });
      return;
    }
    navigate('/marketplace/new');
  };

  return (
    <div className={`page page-full ${styles.page}`}>
      {/* ─── Header band ──────────────────────────────────────────── */}
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/')} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className={styles.title}>Marketplace</h1>
        <ThemeToggle />
      </header>
      <p className={styles.intro}>
        Buy, sell, or swap surplus networking and data-center gear. List
        directly here, or jump out to partner marketplaces with a
        pre-filled search.
      </p>

      {/* ─── Quick partner search ─────────────────────────────────── */}
      <section className={styles.partnerCard}>
        <div className={styles.partnerHead}>
          <span className={styles.partnerLabel}>Search partner marketplaces</span>
          <span className={styles.partnerHint}>eBay · Amazon · FS.com · Curvature</span>
        </div>
        <div className={styles.partnerSearchRow}>
          <input
            className={styles.partnerInput}
            placeholder="e.g. Cisco WS-C3850-48T"
            value={partnerQuery}
            onChange={(e) => setPartnerQuery(e.target.value)}
          />
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={!partnerQuery.trim()}
            onClick={() => {
              if (partnerLinks[0]) window.open(partnerLinks[0].url, '_blank', 'noopener');
            }}>
            Search eBay ↗
          </button>
        </div>
        {partnerLinks.length > 0 && (
          <div className={styles.partnerRow}>
            {partnerLinks.slice(1).map(p => (
              <a key={p.name} href={p.url} target="_blank" rel="noopener noreferrer"
                 className={styles.partnerBtnSm}>{p.name} ↗</a>
            ))}
          </div>
        )}
      </section>

      {/* ─── Tabs + Sell button ───────────────────────────────────── */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'browse' ? styles.tabActive : ''}`}
            onClick={() => setTab('browse')}>
            Browse
          </button>
          <button
            className={`${styles.tab} ${tab === 'mine' ? styles.tabActive : ''}`}
            onClick={() => setTab('mine')}
            disabled={!isAuthed}
            title={isAuthed ? '' : 'Sign in to see your listings'}>
            My listings
          </button>
        </div>
        <button className={styles.btnPrimary} onClick={onSubmitNew}>
          + Sell something
        </button>
      </div>

      {/* ─── Filters (browse tab only) ────────────────────────────── */}
      {tab === 'browse' && (
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            placeholder="Search title, vendor, model…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className={styles.select}
            value={category}
            onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <div className={styles.kindToggle}>
            <button
              className={`${styles.kindBtn} ${kind === 'sell' ? styles.kindActive : ''}`}
              onClick={() => setKind('sell')}>For sale</button>
            <button
              className={`${styles.kindBtn} ${kind === 'want' ? styles.kindActive : ''}`}
              onClick={() => setKind('want')}>Wanted</button>
          </div>
        </div>
      )}

      {/* ─── Listings ──────────────────────────────────────────────── */}
      <section className={styles.gridWrap}>
        {error && <div className={styles.errBanner}>{error}</div>}
        {loading && <div className={styles.empty}><span className={styles.spinner}/></div>}
        {!loading && !error && listings.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyText}>
              {tab === 'mine'
                ? 'You have no listings yet.'
                : kind === 'want'
                  ? 'No wanted-listings yet — be the first to post what you need.'
                  : 'No listings match those filters.'}
            </p>
            <button className={styles.btnPrimary} onClick={onSubmitNew}>
              {kind === 'want' ? 'Post a want' : 'List the first item'}
            </button>
          </div>
        )}

        {/* Browse tab → card grid + pagination */}
        {!loading && listings.length > 0 && tab === 'browse' && (
          <>
            <div className={styles.grid}>
              {listings.map(l => (
                <ListingCard key={l.id} listing={l} onOpen={openDetail} onBuy={(id) => {
                  if (!isAuthed) { navigate('/login', { state: { from: `/marketplace/checkout/${id}` } }); return; }
                  navigate(`/marketplace/checkout/${id}`);
                }} />
              ))}
            </div>
            <Pagination
              page={page}
              hasMore={hasMore}
              onPrev={() => setPage(p => Math.max(1, p - 1))}
              onNext={() => setPage(p => p + 1)}
            />
          </>
        )}

        {/* Mine tab → list with inline Edit / Mark Sold / Delete */}
        {!loading && listings.length > 0 && tab === 'mine' && (
          <div className={styles.mineList}>
            {listings.map(l => (
              <MyListingCard
                key={l.id}
                listing={l}
                onOpen={openDetail}
                onPatch={patchListingInline}
                onDelete={deleteListingInline}
                onEdit={(listing) => navigate(`/marketplace/new?editId=${listing.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <ListingDetailModal
        listing={detail?.listing}
        partners={detail?.partners}
        isMine={detail?.listing?.isMine}
        onClose={() => setDetail(null)}
        onPatch={patchDetail}
        onDelete={deleteDetail}
        onBuy={(id) => {
          if (!isAuthed) { navigate('/login', { state: { from: `/marketplace/checkout/${id}` } }); return; }
          navigate(`/marketplace/checkout/${id}`);
        }}
        onFlag={async (id) => {
          const reason = prompt('Why are you reporting this listing?');
          if (!reason) return;
          try {
            const res = await authFetch(apiUrl(`/api/marketplace/listings/${id}/flag`), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || 'Failed');
            alert('Listing reported. An admin will review it.');
          } catch (err) { alert(err.message); }
        }}
      />
    </div>
  );
}
