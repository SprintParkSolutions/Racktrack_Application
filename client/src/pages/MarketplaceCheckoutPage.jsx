import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './MarketplaceCheckoutPage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';

const CATEGORY_ICON = {
  cable: '🔌', switch: '🔁', router: '🌐', rack: '🗄️',
  optic: '✨', server: '🖥️', pdu: '⚡', firewall: '🛡️',
  patch_panel: '🧩', other: '📦',
};

const CONDITION_LABEL = {
  'new': 'New', 'refurb': 'Refurbished', 'used': 'Used', 'for-parts': 'For parts',
};

function formatCurrency(cents, currency = 'USD') {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch { return `${currency} ${(cents / 100).toFixed(2)}`; }
}

const PLATFORM_FEE_RATE = 0.03;

export default function MarketplaceCheckoutPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const { listingId } = useParams();

  const [listing, setListing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [qty, setQty]         = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);

  // Shipping fields
  const [name, setName]       = useState('');
  const [street, setStreet]   = useState('');
  const [city, setCity]       = useState('');
  const [state, setState]     = useState('');
  const [zip, setZip]         = useState('');
  const [country, setCountry] = useState('US');

  useEffect(() => {
    if (!isAuthed) {
      navigate('/login', { state: { from: `/marketplace/checkout/${listingId}` }, replace: true });
      return;
    }
  }, [isAuthed, navigate, listingId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [listingRes, stripeRes] = await Promise.all([
          authFetch(apiUrl(`/api/marketplace/listings/${listingId}`)),
          authFetch(apiUrl('/api/marketplace/stripe/status')),
        ]);
        const data = await listingRes.json();
        if (!listingRes.ok || !data.ok) throw new Error(data.error || `HTTP ${listingRes.status}`);
        setListing(data.listing);
        const stripeData = await stripeRes.json();
        if (stripeData.ok) setStripeEnabled(!!stripeData.configured);
      } catch (err) { setError(err.message); }
      finally { setLoading(false); }
    })();
  }, [listingId]);

  const subtotal = listing ? (listing.priceCents || 0) * qty : 0;
  const fee      = Math.round(subtotal * PLATFORM_FEE_RATE);
  const total    = subtotal + fee;

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!street.trim()) { setError('Street address is required.'); return; }
    if (!city.trim()) { setError('City is required.'); return; }
    setSubmitting(true);
    try {
      const res = await authFetch(apiUrl('/api/marketplace/orders'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: Number(listingId),
          quantity: qty,
          shippingName: name.trim(),
          shippingStreet: street.trim(),
          shippingCity: city.trim(),
          shippingState: state.trim(),
          shippingZip: zip.trim(),
          shippingCountry: country.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // If Stripe is configured, redirect to Stripe Checkout
      if (data.stripeSessionUrl) {
        window.location.href = data.stripeSessionUrl;
        return;
      }
      navigate(`/marketplace/orders/${data.order.id}`, { replace: true });
    } catch (err) { setError(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className={`page page-full ${styles.page}`}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className={styles.title}>Checkout</h1>
      </header>

      {loading && <div className={styles.center}><span className={styles.spinner}/></div>}
      {!loading && error && !listing && <div className={styles.errBanner}>{error}</div>}

      {listing && (
        <form className={styles.form} onSubmit={onSubmit}>
          {/* Item summary */}
          <div className={styles.itemCard}>
            <div className={styles.itemThumb}>
              {listing.imageUrl
                ? <img src={listing.imageUrl} alt="" />
                : <span>{CATEGORY_ICON[listing.category] || '📦'}</span>}
            </div>
            <div className={styles.itemInfo}>
              <h2 className={styles.itemTitle}>{listing.title}</h2>
              <p className={styles.itemMeta}>
                {CONDITION_LABEL[listing.condition] || listing.condition}
                {listing.seller?.username && <> · @{listing.seller.username}</>}
              </p>
            </div>
            <div className={styles.itemPrice}>
              {formatCurrency(listing.priceCents, listing.currency)}
            </div>
          </div>

          {/* Quantity */}
          {listing.quantity > 1 && (
            <label className={styles.field}>
              <span className={styles.label}>Quantity (max {listing.quantity})</span>
              <input type="number" className={styles.input} value={qty}
                     min={1} max={listing.quantity}
                     onChange={(e) => setQty(Math.max(1, Math.min(listing.quantity, parseInt(e.target.value, 10) || 1)))} />
            </label>
          )}

          {/* Shipping address */}
          <div className={styles.section}>
            <h3 className={styles.sectionLabel}>Shipping Address</h3>
            <label className={styles.field}>
              <input className={styles.input} placeholder="Full name" value={name}
                     onChange={(e) => setName(e.target.value)} required />
            </label>
            <label className={styles.field}>
              <input className={styles.input} placeholder="Street address" value={street}
                     onChange={(e) => setStreet(e.target.value)} required />
            </label>
            <div className={styles.row2}>
              <input className={styles.input} placeholder="City" value={city}
                     onChange={(e) => setCity(e.target.value)} required />
              <input className={styles.input} placeholder="State" value={state}
                     onChange={(e) => setState(e.target.value)} />
            </div>
            <div className={styles.row2}>
              <input className={styles.input} placeholder="ZIP" value={zip}
                     onChange={(e) => setZip(e.target.value)} />
              <input className={styles.input} placeholder="Country" value={country}
                     onChange={(e) => setCountry(e.target.value)} />
            </div>
          </div>

          {/* Total */}
          <div className={styles.totalBox}>
            <div className={styles.totalRow}>
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal, listing.currency)}</span>
            </div>
            <div className={styles.totalRow}>
              <span>Platform fee (3%)</span>
              <span>{formatCurrency(fee, listing.currency)}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.totalBold}`}>
              <span>Total</span>
              <span>{formatCurrency(total, listing.currency)}</span>
            </div>
          </div>

          {error && <div className={styles.errBanner}>{error}</div>}

          <button type="submit" className={styles.btnPrimary} disabled={submitting}>
            {submitting
              ? 'Processing…'
              : stripeEnabled
                ? `Pay with Stripe — ${formatCurrency(total, listing.currency)}`
                : `Complete Purchase — ${formatCurrency(total, listing.currency)}`}
          </button>

          <p className={styles.hint}>
            {stripeEnabled
              ? 'You\u2019ll be redirected to Stripe for secure payment. The seller will be notified once payment is confirmed.'
              : 'Payment is processed securely. The seller will be notified and can ship once payment is confirmed.'}
          </p>
        </form>
      )}
    </div>
  );
}
