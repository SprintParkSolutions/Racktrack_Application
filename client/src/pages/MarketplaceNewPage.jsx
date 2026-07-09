import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './MarketplaceNewPage.module.css';
import { apiUrl, authFetch } from '../utils/api';
import { useAuth } from '../AuthContext.jsx';

/* ──────────────────────────────────────────────────────────────────────
   MarketplaceNewPage — create a marketplace listing.

   Prefill via query params so a "Sell this" button on the
   SwitchInformationPage / ResultsPage can deep-link in:
     /marketplace/new?vendor=Cisco&model=WS-C3850-48T&category=switch&rackId=RK-XXXX
   ────────────────────────────────────────────────────────────────────── */

const CATEGORIES = [
  ['cable',       'Cables'],
  ['switch',      'Switches'],
  ['router',      'Routers'],
  ['rack',        'Racks'],
  ['optic',       'Optics / SFPs'],
  ['server',      'Servers'],
  ['pdu',         'PDUs'],
  ['firewall',    'Firewalls'],
  ['patch_panel', 'Patch panels'],
  ['other',       'Other'],
];
const CONDITIONS = [
  ['new',       'New (sealed)'],
  ['refurb',    'Refurbished'],
  ['used',      'Used — working'],
  ['for-parts', 'For parts / not working'],
];

export default function MarketplaceNewPage() {
  const navigate = useNavigate();
  const { isAuthed } = useAuth();
  const [params] = useSearchParams();

  // Bounce unauthenticated visitors to login first, then back here.
  useEffect(() => {
    if (!isAuthed) {
      navigate('/login', { state: { from: '/marketplace/new' }, replace: true });
    }
  }, [isAuthed, navigate]);

  const initialKind = params.get('kind') === 'want' ? 'want' : 'sell';
  const [kind, setKind]             = useState(initialKind);
  const [category, setCategory]     = useState(params.get('category') || 'switch');
  const [title, setTitle]           = useState('');
  const [vendor, setVendor]         = useState(params.get('vendor') || '');
  const [model, setModel]           = useState(params.get('model')  || '');
  const [condition, setCondition]   = useState('used');
  const [quantity, setQuantity]     = useState(1);
  const [price, setPrice]           = useState('');
  const [currency, setCurrency]     = useState('USD');
  const [location, setLocation]     = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl]     = useState('');
  const [imagePreview, setImagePreview] = useState(''); // blob: URL for instant preview
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState(null);
  const fileInputRef                = useRef(null);
  const [sourceRackId]              = useState(params.get('rackId') || '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [partners, setPartners]     = useState([]);

  // Suggest a title once vendor/model is typed in (the user can edit it).
  useEffect(() => {
    if (title) return;
    const t = [vendor, model].filter(Boolean).join(' ').trim();
    if (t) setTitle(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor, model]);

  // Live partner-link preview keyed off vendor + model so the user can see
  // the redirect-only option without leaving the page.
  useEffect(() => {
    const v = vendor.trim();
    const m = model.trim();
    if (!v && !m) { setPartners([]); return; }
    let cancelled = false;
    const usp = new URLSearchParams();
    if (v) usp.set('vendor', v);
    if (m) usp.set('model', m);
    usp.set('category', category);
    fetch(apiUrl('/api/marketplace/partner-search?' + usp.toString()))
      .then(r => r.json())
      .then(data => { if (!cancelled && data?.ok) setPartners(data.partners || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [vendor, model, category]);

  const titleHint = useMemo(() => {
    if (!title.trim()) return '';
    if (title.length < 6) return 'A few more words helps buyers find it.';
    return '';
  }, [title]);

  // Free the blob URL when the component unmounts or the preview changes,
  // otherwise the browser holds the picked file in memory forever.
  useEffect(() => {
    return () => { if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview); };
  }, [imagePreview]);

  const handleFilePick = async (file) => {
    if (!file) return;
    setImageError(null);
    if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) {
      setImageError('Only JPG, PNG, or WebP images are accepted.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setImageError('Image must be 8 MB or smaller.');
      return;
    }
    // Instant local preview while the upload runs.
    if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImagePreview(URL.createObjectURL(file));
    setImageUploading(true);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await authFetch(apiUrl('/api/marketplace/uploads'), {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setImageUrl(data.url);  // server-side URL, persisted on the listing
    } catch (err) {
      setImageError(err.message);
      setImageUrl('');
    } finally {
      setImageUploading(false);
    }
  };

  const clearImage = () => {
    if (imagePreview && imagePreview.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImagePreview('');
    setImageUrl('');
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const t = title.trim();
    if (!t) { setError('Title is required.'); return; }
    setSubmitting(true);
    try {
      const body = {
        kind, category, condition, quantity, currency,
        title: t,
        vendor: vendor.trim() || undefined,
        model:  model.trim()  || undefined,
        location:    location.trim()    || undefined,
        description: description.trim() || undefined,
        imageUrl:    imageUrl.trim()    || undefined,
        sourceRackId: sourceRackId || undefined,
      };
      if (price !== '' && price !== null) body.price = Number(price);
      const res  = await authFetch(apiUrl('/api/marketplace/listings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      navigate('/marketplace?tab=mine', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
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
        <h1 className={styles.title}>
          {kind === 'want' ? 'Post a want' : 'Sell an item'}
        </h1>
      </header>

      <p className={styles.intro}>
        {kind === 'want'
          ? 'Tell sellers what you\'re looking for — they\'ll see it under the “Wanted” tab.'
          : 'List your surplus gear directly on RackTrack, or use the partner-redirect option below to send buyers straight to eBay etc.'}
      </p>

      {/* Kind toggle ─ sell vs want */}
      <div className={styles.kindToggle}>
        <button type="button"
          className={`${styles.kindBtn} ${kind === 'sell' ? styles.kindActive : ''}`}
          onClick={() => setKind('sell')}>For sale</button>
        <button type="button"
          className={`${styles.kindBtn} ${kind === 'want' ? styles.kindActive : ''}`}
          onClick={() => setKind('want')}>Wanted</button>
      </div>

      {sourceRackId && (
        <div className={styles.scanHint}>
          Prefilled from scan <code>{sourceRackId}</code>.
          The buyer will see this so they know the listing is backed by a
          RackTrack scan.
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit}>
        <label className={styles.field}>
          <span className={styles.label}>Title *</span>
          <input
            className={styles.input}
            placeholder="e.g. Cisco WS-C3850-48T-S 48-port switch"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required maxLength={140}
          />
          {titleHint && <span className={styles.hint}>{titleHint}</span>}
        </label>

        <div className={styles.row2}>
          <label className={styles.field}>
            <span className={styles.label}>Category *</span>
            <select
              className={styles.input}
              value={category}
              onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Condition *</span>
            <select
              className={styles.input}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}>
              {CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>

        <div className={styles.row2}>
          <label className={styles.field}>
            <span className={styles.label}>Vendor</span>
            <input
              className={styles.input}
              placeholder="Cisco, Juniper, Arista…"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              maxLength={60}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Model</span>
            <input
              className={styles.input}
              placeholder="WS-C3850-48T-S"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              maxLength={80}
            />
          </label>
        </div>

        <div className={styles.row3}>
          <label className={styles.field}>
            <span className={styles.label}>Price</span>
            <input
              type="number"
              className={styles.input}
              placeholder="(blank = make an offer)"
              value={price}
              min={0}
              step="0.01"
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Currency</span>
            <select
              className={styles.input}
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}>
              <option>USD</option><option>EUR</option><option>GBP</option>
              <option>CAD</option><option>AUD</option><option>INR</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Quantity</span>
            <input
              type="number"
              className={styles.input}
              value={quantity}
              min={1}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Location</span>
          <input
            className={styles.input}
            placeholder="City, country — helps with shipping estimates"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={100}
          />
        </label>

        {/* ─── Image upload ──────────────────────────────────────── */}
        <div className={styles.field}>
          <span className={styles.label}>Photo</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => handleFilePick(e.target.files && e.target.files[0])}
          />
          {imagePreview ? (
            <div className={styles.photoCard}>
              <img src={imagePreview} alt="Listing photo preview" className={styles.photoPreview}/>
              <div className={styles.photoMeta}>
                <span className={styles.photoStatus}>
                  {imageUploading ? 'Uploading…' :
                   imageError      ? 'Upload failed'    :
                                     'Photo ready'}
                </span>
                <div className={styles.photoActions}>
                  <button type="button" className={styles.linkBtn}
                          onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                    Replace
                  </button>
                  <button type="button" className={styles.linkBtnDanger}
                          onClick={clearImage}>
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.photoDrop}
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}>
              <span className={styles.photoIcon} aria-hidden="true">📷</span>
              <span className={styles.photoMain}>Upload a photo</span>
              <span className={styles.photoSub}>JPG · PNG · WebP &middot; up to 8 MB</span>
            </button>
          )}
          {imageError && <span className={styles.hintError}>{imageError}</span>}
        </div>

        <label className={styles.field}>
          <span className={styles.label}>Description</span>
          <textarea
            className={styles.textarea}
            placeholder={kind === 'want'
              ? 'What exactly are you looking for? Quantity, condition, deadline…'
              : 'Hours of use, last firmware, included accessories, reason for selling…'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={2000}
          />
        </label>

        {partners.length > 0 && (
          <div className={styles.partnerBox}>
            <p className={styles.partnerHead}>
              Or skip the listing and redirect buyers to a partner search:
            </p>
            <div className={styles.partnerRow}>
              {partners.map(p => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
                   className={styles.partnerBtn} title={p.blurb}>
                  {p.name} ↗
                </a>
              ))}
            </div>
            <p className={styles.partnerNote}>
              We don't take a cut — partner links are a convenience and open
              in a new tab.
            </p>
          </div>
        )}

        {error && <div className={styles.errBanner}>{error}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.btnSecondary}
                  onClick={() => navigate('/marketplace')}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={submitting}>
            {submitting
              ? 'Publishing…'
              : kind === 'want' ? 'Post want' : 'Publish listing'}
          </button>
        </div>
      </form>
    </div>
  );
}
