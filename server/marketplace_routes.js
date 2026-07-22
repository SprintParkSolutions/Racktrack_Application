/**
 * RackTrack Marketplace — secondary market for surplus networking and
 * data-center gear (cables, switches, routers, racks, optics/SFPs, servers,
 * PDUs, etc.). Three sell paths exposed to the user:
 *
 *   1. Direct listing on RackTrack (rows in this table, anyone can browse).
 *   2. Partner redirect (eBay search URLs built from vendor + model, no
 *      account/credential storage on our side — we just hand them off).
 *   3. Buyer-matching is conceptually a "wanted" listing — sellers can
 *      browse open wanted-rows and reach out. Implemented as listings with
 *      kind='want' alongside kind='sell'.
 *
 * Storage: shares server/data/auth.db so the FK to users(id) gives free
 * cascade-on-delete and per-user scoping. No images stored yet — listings
 * carry one optional external image_url (a vendor stock photo is the
 * common case).
 *
 * Routes:
 *   GET    /api/marketplace/listings           browse public listings (paginated)
 *   GET    /api/marketplace/listings/mine      this user's own listings
 *   GET    /api/marketplace/listings/:id       one listing
 *   POST   /api/marketplace/listings           create
 *   PATCH  /api/marketplace/listings/:id       update own listing
 *   DELETE /api/marketplace/listings/:id       delete own listing
 *   GET    /api/marketplace/partner-search     ?vendor=&model= → partner URLs
 *   GET    /api/marketplace/categories         enum of accepted categories
 */
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const express  = require('express');
const multer   = require('multer');
const Database = require('better-sqlite3');
const { requireAuth, requireRole } = require('./auth');
const { logger } = require('./lib/observability');

// ── Optional Stripe (env-gated) ─────────────────────────────────────
let stripe = null;
const STRIPE_SECRET   = process.env.STRIPE_SECRET_KEY   || '';
const STRIPE_WEBHOOK  = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_BASE_URL = process.env.BASE_URL || 'https://localhost:5173';
if (STRIPE_SECRET) {
  try {
    stripe = require('stripe')(STRIPE_SECRET);
    logger.info({ event: 'marketplace.stripe' }, 'Stripe configured');
  } catch (e) {
    logger.warn(`[marketplace] stripe package not installed — payments disabled: ${e.message}`);
  }
}

// ── Optional eBay / Amazon OAuth (env-gated) ────────────────────────
const EBAY_APP_ID       = process.env.EBAY_APP_ID       || '';
const EBAY_CERT_ID      = process.env.EBAY_CERT_ID      || '';
const EBAY_REDIRECT_URI = process.env.EBAY_REDIRECT_URI || '';
const AMAZON_SP_CLIENT  = process.env.AMAZON_SP_CLIENT_ID     || '';
const AMAZON_SP_SECRET  = process.env.AMAZON_SP_CLIENT_SECRET || '';
const AMAZON_REDIRECT   = process.env.AMAZON_REDIRECT_URI     || '';

const DB_PATH = path.join(__dirname, 'data', 'auth.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'marketplace');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_listings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL DEFAULT 'sell',  -- 'sell' | 'want'
    category      TEXT    NOT NULL,                  -- see CATEGORIES below
    title         TEXT    NOT NULL,
    vendor        TEXT,
    model         TEXT,
    condition     TEXT    NOT NULL DEFAULT 'used',  -- 'new' | 'refurb' | 'used' | 'for-parts'
    quantity      INTEGER NOT NULL DEFAULT 1,
    price_cents   INTEGER,                           -- nullable: 'make an offer'
    currency      TEXT    NOT NULL DEFAULT 'USD',
    location      TEXT,
    description   TEXT,
    image_url     TEXT,
    source_rack_id TEXT,                             -- optional: scan it came from
    status        TEXT    NOT NULL DEFAULT 'active', -- 'active' | 'sold' | 'closed'
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_market_listings_user
    ON marketplace_listings(user_id);
  CREATE INDEX IF NOT EXISTS idx_market_listings_status
    ON marketplace_listings(status);
  CREATE INDEX IF NOT EXISTS idx_market_listings_category
    ON marketplace_listings(category);
`);

const CATEGORIES = [
  'cable',
  'switch',
  'router',
  'rack',
  'optic',     // SFP / SFP+ / QSFP modules
  'server',
  'pdu',
  'firewall',
  'patch_panel',
  'other',
];
const KINDS      = new Set(['sell', 'want']);
const CONDITIONS = new Set(['new', 'refurb', 'used', 'for-parts']);
const STATUSES   = new Set(['active', 'sold', 'closed']);

function rowToListing(row, viewerUserId = null) {
  if (!row) return null;
  return {
    id:            row.id,
    kind:          row.kind,
    category:      row.category,
    title:         row.title,
    vendor:        row.vendor,
    model:         row.model,
    condition:     row.condition,
    quantity:      row.quantity,
    priceCents:    row.price_cents,
    currency:      row.currency,
    price:         row.price_cents == null
      ? null
      : Number((row.price_cents / 100).toFixed(2)),
    location:      row.location,
    description:   row.description,
    imageUrl:      row.image_url,
    sourceRackId:  row.source_rack_id,
    status:        row.status,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at,
    seller: {
      id:       row.user_id,
      username: row.username || null,
    },
    isMine: viewerUserId != null && row.user_id === viewerUserId,
  };
}

// --- Partner redirect URL builders ----------------------------------
// We don't store partner credentials or use any APIs — just deep-link the
// user to a pre-filled search on each marketplace. Vendor + model gives a
// useful starting query for almost all networking gear.
function buildPartnerSearch(vendor, model, category) {
  const q = [vendor, model].filter(Boolean).join(' ').trim();
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const partners = [
    {
      id:    'ebay',
      name:  'eBay',
      url:   `https://www.ebay.com/sch/i.html?_nkw=${enc}`,
      blurb: 'Largest selection of used network gear; auctions + Buy It Now.',
    },
    {
      id:    'amazon',
      name:  'Amazon',
      url:   `https://www.amazon.com/s?k=${enc}`,
      blurb: 'New + refurbished, fast shipping.',
    },
  ];
  // Networking-specific resellers are more useful for switches/routers/optics.
  if (['switch', 'router', 'optic', 'firewall'].includes(category)) {
    partners.push({
      id:    'fs',
      name:  'FS.com',
      url:   `https://www.fs.com/search.html?keyword=${enc}`,
      blurb: 'Compatible optics + cabling; new only.',
    });
    partners.push({
      id:    'curvature',
      name:  'Curvature',
      url:   `https://www.curvature.com/search?keyword=${enc}`,
      blurb: 'Enterprise-grade refurbished networking gear.',
    });
  }
  return partners;
}

// --- Discord webhook notification ------------------------------------
// Sends a rich embed to all connected Discord webhooks when a new
// listing is created. Fire-and-forget — failures are logged but never
// block the API response.
async function sendDiscordNotification(listing) {
  let webhooks;
  try {
    webhooks = db.prepare(
      "SELECT webhook_url FROM marketplace_partner_accounts WHERE platform = 'discord' AND status = 'connected' AND webhook_url IS NOT NULL"
    ).all();
  } catch { return; }
  if (!webhooks.length) return;

  const priceStr = listing.price_cents != null
    ? `$${(listing.price_cents / 100).toFixed(2)} ${listing.currency || 'USD'}`
    : 'Make an offer';
  const equipment = [listing.vendor, listing.model].filter(Boolean).join(' ');
  const embed = {
    title: listing.title,
    description: listing.description
      ? listing.description.slice(0, 200) + (listing.description.length > 200 ? '…' : '')
      : undefined,
    color: 0x121417,
    fields: [
      { name: 'Category', value: listing.category, inline: true },
      { name: 'Condition', value: listing.condition, inline: true },
      { name: 'Price', value: priceStr, inline: true },
    ],
    footer: { text: 'RackTrack Marketplace' },
    timestamp: new Date().toISOString(),
  };
  if (equipment) embed.fields.push({ name: 'Equipment', value: equipment, inline: true });
  if (listing.location) embed.fields.push({ name: 'Location', value: listing.location, inline: true });

  const payload = JSON.stringify({
    content: `New ${listing.kind === 'want' ? 'wanted' : 'for-sale'} listing on RackTrack`,
    embeds: [embed],
  });
  for (const { webhook_url } of webhooks) {
    try {
      await fetch(webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });
    } catch (err) {
      logger.error(`[marketplace] Discord webhook failed: ${err.message}`);
    }
  }
}

// --- Image uploads --------------------------------------------------
// Dedicated multer instance scoped to marketplace listing photos. We
// accept jpg/png/webp up to 8 MB and write them to
// server/uploads/marketplace/. The returned URL is what the client
// stores on the listing's image_url column.
function _imgExt(originalName) {
  const m = String(originalName || '').match(/\.(jpe?g|png|webp|heic|heif)$/i);
  return m ? '.' + m[1].toLowerCase().replace('jpeg', 'jpg') : '';
}
const imgStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext = _imgExt(file.originalname);
    cb(null, crypto.randomUUID() + ext);
  },
});
const imgUpload = multer({
  storage: imgStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = _imgExt(file.originalname) !== '';
    cb(ok ? null : new Error('Only jpg / png / webp / heic images are accepted'), ok);
  },
});

// --- Router ---------------------------------------------------------
const router = express.Router();

// Static serve uploaded marketplace images. Mounted under
// /uploads/marketplace/<file> so the URLs the upload endpoint returns
// resolve directly.
router.use('/uploads/marketplace',
  express.static(UPLOADS_DIR, { maxAge: '7d', fallthrough: true }));

function safeAsync(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (err) {
      logger.error(`[marketplace] ${req.method} ${req.originalUrl} — ${err.message}`);
      const status = err.status || 500;
      res.status(status).json({ ok: false, error: err.message || 'request failed' });
    }
  };
}

// Gate all marketplace API routes to admin / owner only — except the three
// that are called by somebody else's server and can never carry a session.
//
//   stripe/webhook            Stripe posts this; it authenticates with a
//                             signature over the raw body, not a login.
//   partner-accounts/*/callback  the OAuth redirect back from eBay / Amazon,
//                             which arrives as a plain browser navigation and
//                             authenticates by the `state` parameter.
//
// The blanket gate rejected all three, so Stripe payments could never be
// confirmed and neither marketplace channel could finish connecting — the
// feature could not work, and the failure looked like a partner-side problem.
const requireAdminRole = requireRole('owner', 'org_admin');
const PUBLIC_MARKETPLACE_PATHS = [
  '/api/marketplace/stripe/webhook',
  '/api/marketplace/partner-accounts/ebay/callback',
  '/api/marketplace/partner-accounts/amazon/callback',
];
router.use('/api/marketplace', (req, res, next) => {
  // req.path is relative to the mount point, so compare on originalUrl's path.
  const full = (req.originalUrl || req.url).split('?')[0];
  if (PUBLIC_MARKETPLACE_PATHS.includes(full)) return next();
  return requireAdminRole(req, res, next);
});

// List categories so the UI doesn't hard-code them.
router.get('/api/marketplace/categories', (req, res) => {
  res.json({ ok: true, categories: CATEGORIES });
});

// Authed: upload a single listing image. Returns the public URL the
// client should store on the listing. The file is held in
// server/uploads/marketplace/ and served from /uploads/marketplace/<file>.
router.post('/api/marketplace/uploads',
  requireAuth,
  (req, res, next) => imgUpload.single('image')(req, res, (err) => {
    if (err) {
      const status = err.message && err.message.startsWith('Only ') ? 400 : 500;
      return res.status(status).json({ ok: false, error: err.message });
    }
    next();
  }),
  (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    const url = `/uploads/marketplace/${req.file.filename}`;
    res.json({ ok: true, url, size: req.file.size });
  }
);

// Public: partner-redirect URLs for a vendor/model query. Used both from
// the listing detail page (Buy on eBay / Amazon / etc.) and from the
// "no time to list — just redirect me" CTA on the new-listing flow.
router.get('/api/marketplace/partner-search', (req, res) => {
  const vendor   = (req.query.vendor   || '').toString().trim();
  const model    = (req.query.model    || '').toString().trim();
  const category = (req.query.category || 'other').toString().trim();
  const partners = buildPartnerSearch(vendor, model, category);
  res.json({ ok: true, partners });
});

// Public: browse active sell-listings. Query params:
//   q          — substring match against title / vendor / model
//   category   — exact match
//   kind       — 'sell' (default) or 'want'
//   condition  — exact match
//   limit/page — pagination, defaults 30 / 1
router.get('/api/marketplace/listings', (req, res) => {
  const where = [`l.status = 'active'`];
  const params = {};
  const kind = (req.query.kind || 'sell').toString();
  if (!KINDS.has(kind)) return res.status(400).json({ ok: false, error: 'bad kind' });
  where.push(`l.kind = @kind`);
  params.kind = kind;
  if (req.query.category) {
    where.push(`l.category = @category`);
    params.category = String(req.query.category);
  }
  if (req.query.condition) {
    where.push(`l.condition = @condition`);
    params.condition = String(req.query.condition);
  }
  if (req.query.q) {
    where.push(`(l.title LIKE @q OR l.vendor LIKE @q OR l.model LIKE @q)`);
    params.q = `%${String(req.query.q).replace(/[%_]/g, '\\$&')}%`;
  }
  const limit  = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 30));
  const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * limit;
  const sql = `
    SELECT l.*, u.username
    FROM marketplace_listings l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY l.created_at DESC
    LIMIT @limit OFFSET @offset
  `;
  const rows = db.prepare(sql).all({ ...params, limit, offset });
  // viewerUserId from soft-auth (so isMine works even on public routes)
  const viewerId = req.user?.id ?? null;
  res.json({
    ok: true,
    page, limit,
    listings: rows.map(r => rowToListing(r, viewerId)),
  });
});

// Authed: list this user's own listings (all statuses).
router.get('/api/marketplace/listings/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.username
    FROM marketplace_listings l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC
  `).all(req.user.id);
  res.json({ ok: true, listings: rows.map(r => rowToListing(r, req.user.id)) });
});

// Public: single listing by id (includes partner-search URLs as a
// convenience so the detail page doesn't need a second round-trip).
router.get('/api/marketplace/listings/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const row = db.prepare(`
    SELECT l.*, u.username
    FROM marketplace_listings l
    LEFT JOIN users u ON u.id = l.user_id
    WHERE l.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  const viewerId = req.user?.id ?? null;
  res.json({
    ok: true,
    listing: rowToListing(row, viewerId),
    partners: buildPartnerSearch(row.vendor, row.model, row.category),
  });
});

// Authed: create a listing.
router.post('/api/marketplace/listings', requireAuth, safeAsync(async (req, res) => {
  const b = req.body || {};
  const kind      = String(b.kind || 'sell');
  const category  = String(b.category || '').toLowerCase();
  const condition = String(b.condition || 'used').toLowerCase();
  const title     = String(b.title || '').trim();
  if (!KINDS.has(kind))           return res.status(400).json({ ok: false, error: 'bad kind' });
  if (!CATEGORIES.includes(category))
    return res.status(400).json({ ok: false, error: 'bad category' });
  if (!CONDITIONS.has(condition)) return res.status(400).json({ ok: false, error: 'bad condition' });
  if (!title)                     return res.status(400).json({ ok: false, error: 'title is required' });

  const quantity = Math.max(1, parseInt(b.quantity, 10) || 1);
  let priceCents = null;
  if (b.price != null && b.price !== '' && b.price !== false) {
    const n = Number(b.price);
    if (!Number.isFinite(n) || n < 0)
      return res.status(400).json({ ok: false, error: 'bad price' });
    priceCents = Math.round(n * 100);
  } else if (b.priceCents != null) {
    const n = parseInt(b.priceCents, 10);
    if (!Number.isFinite(n) || n < 0)
      return res.status(400).json({ ok: false, error: 'bad priceCents' });
    priceCents = n;
  }

  const info = db.prepare(`
    INSERT INTO marketplace_listings
      (user_id, kind, category, title, vendor, model, condition,
       quantity, price_cents, currency, location, description, image_url,
       source_rack_id)
    VALUES
      (@user_id, @kind, @category, @title, @vendor, @model, @condition,
       @quantity, @price_cents, @currency, @location, @description, @image_url,
       @source_rack_id)
  `).run({
    user_id:        req.user.id,
    kind, category, title, condition,
    vendor:         b.vendor ? String(b.vendor).trim() : null,
    model:          b.model  ? String(b.model).trim()  : null,
    quantity,
    price_cents:    priceCents,
    currency:       (b.currency ? String(b.currency).toUpperCase() : 'USD').slice(0, 6),
    location:       b.location    ? String(b.location).trim()    : null,
    description:    b.description ? String(b.description).trim() : null,
    image_url:      b.imageUrl    ? String(b.imageUrl).trim()    : null,
    source_rack_id: b.sourceRackId ? String(b.sourceRackId).trim() : null,
  });
  const row = db.prepare(`
    SELECT l.*, u.username FROM marketplace_listings l
    LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?
  `).get(info.lastInsertRowid);
  res.json({ ok: true, listing: rowToListing(row, req.user.id) });
}));

// Authed: update own listing. Anything not supplied is left as-is. Used
// for marking 'sold' or 'closed' as much as for editing copy.
router.patch('/api/marketplace/listings/:id', requireAuth, safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const existing = db.prepare(`SELECT * FROM marketplace_listings WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });
  if (existing.user_id !== req.user.id)
    return res.status(403).json({ ok: false, error: 'not your listing' });

  const b = req.body || {};
  const patch = {};
  if (b.title       !== undefined) patch.title       = String(b.title).trim();
  if (b.vendor      !== undefined) patch.vendor      = b.vendor      ? String(b.vendor).trim()      : null;
  if (b.model       !== undefined) patch.model       = b.model       ? String(b.model).trim()       : null;
  if (b.description !== undefined) patch.description = b.description ? String(b.description).trim() : null;
  if (b.location    !== undefined) patch.location    = b.location    ? String(b.location).trim()    : null;
  if (b.imageUrl    !== undefined) patch.image_url   = b.imageUrl    ? String(b.imageUrl).trim()    : null;
  if (b.quantity    !== undefined) patch.quantity    = Math.max(1, parseInt(b.quantity, 10) || 1);
  if (b.category    !== undefined) {
    const c = String(b.category).toLowerCase();
    if (!CATEGORIES.includes(c)) return res.status(400).json({ ok: false, error: 'bad category' });
    patch.category = c;
  }
  if (b.condition   !== undefined) {
    const c = String(b.condition).toLowerCase();
    if (!CONDITIONS.has(c)) return res.status(400).json({ ok: false, error: 'bad condition' });
    patch.condition = c;
  }
  if (b.status      !== undefined) {
    const s = String(b.status).toLowerCase();
    if (!STATUSES.has(s)) return res.status(400).json({ ok: false, error: 'bad status' });
    patch.status = s;
  }
  if (b.price !== undefined) {
    if (b.price === null || b.price === '') patch.price_cents = null;
    else {
      const n = Number(b.price);
      if (!Number.isFinite(n) || n < 0)
        return res.status(400).json({ ok: false, error: 'bad price' });
      patch.price_cents = Math.round(n * 100);
    }
  }

  const keys = Object.keys(patch);
  if (keys.length === 0)
    return res.status(400).json({ ok: false, error: 'nothing to update' });
  const setSql = keys.map(k => `${k} = @${k}`).join(', ') + `, updated_at = datetime('now')`;
  db.prepare(`UPDATE marketplace_listings SET ${setSql} WHERE id = @id`)
    .run({ ...patch, id });
  const row = db.prepare(`
    SELECT l.*, u.username FROM marketplace_listings l
    LEFT JOIN users u ON u.id = l.user_id WHERE l.id = ?
  `).get(id);
  res.json({ ok: true, listing: rowToListing(row, req.user.id) });
}));

// Authed: delete own listing.
router.delete('/api/marketplace/listings/:id', requireAuth, safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const existing = db.prepare(`SELECT user_id FROM marketplace_listings WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });
  if (existing.user_id !== req.user.id)
    return res.status(403).json({ ok: false, error: 'not your listing' });
  db.prepare(`DELETE FROM marketplace_listings WHERE id = ?`).run(id);
  res.json({ ok: true });
}));

// ═══════════════════════════════════════════════════════════════════════
//  ORDERS + MESSAGING
// ═══════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id      INTEGER NOT NULL REFERENCES marketplace_listings(id),
    buyer_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL,
    platform_fee_cents INTEGER NOT NULL DEFAULT 0,
    total_cents     INTEGER NOT NULL,
    currency        TEXT    NOT NULL DEFAULT 'USD',
    status          TEXT    NOT NULL DEFAULT 'pending',
    shipping_name   TEXT,
    shipping_street TEXT,
    shipping_city   TEXT,
    shipping_state  TEXT,
    shipping_zip    TEXT,
    shipping_country TEXT,
    carrier         TEXT,
    tracking_number TEXT,
    cancelled_by    INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_buyer  ON marketplace_orders(buyer_id);
  CREATE INDEX IF NOT EXISTS idx_orders_seller ON marketplace_orders(seller_id);

  CREATE TABLE IF NOT EXISTS marketplace_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id   INTEGER NOT NULL REFERENCES marketplace_orders(id) ON DELETE CASCADE,
    sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT    NOT NULL,
    read       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_messages_order ON marketplace_messages(order_id);
`);

const ORDER_STATUSES = new Set(['pending', 'paid', 'shipped', 'completed', 'cancelled']);
const PLATFORM_FEE_RATE = 0.03; // 3%

function orderToJson(row) {
  if (!row) return null;
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    quantity: row.quantity,
    unitPriceCents: row.unit_price_cents,
    unitPrice: Number((row.unit_price_cents / 100).toFixed(2)),
    platformFeeCents: row.platform_fee_cents,
    platformFee: Number((row.platform_fee_cents / 100).toFixed(2)),
    totalCents: row.total_cents,
    total: Number((row.total_cents / 100).toFixed(2)),
    currency: row.currency,
    status: row.status,
    shipping: {
      name: row.shipping_name, street: row.shipping_street,
      city: row.shipping_city, state: row.shipping_state,
      zip: row.shipping_zip, country: row.shipping_country,
    },
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    cancelledBy: row.cancelled_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // joined fields
    listingTitle: row.listing_title || null,
    listingCategory: row.listing_category || null,
    listingImageUrl: row.listing_image_url || null,
    listingVendor: row.listing_vendor || null,
    listingModel: row.listing_model || null,
    buyerUsername: row.buyer_username || null,
    sellerUsername: row.seller_username || null,
  };
}

const ORDER_JOIN_SQL = `
  SELECT o.*,
         l.title       AS listing_title,
         l.category    AS listing_category,
         l.image_url   AS listing_image_url,
         l.vendor      AS listing_vendor,
         l.model       AS listing_model,
         ub.username   AS buyer_username,
         us.username   AS seller_username
  FROM marketplace_orders o
  LEFT JOIN marketplace_listings l ON l.id = o.listing_id
  LEFT JOIN users ub ON ub.id = o.buyer_id
  LEFT JOIN users us ON us.id = o.seller_id
`;

// Create order (checkout)
router.post('/api/marketplace/orders', requireAuth, safeAsync(async (req, res) => {
  const b = req.body || {};
  const listingId = parseInt(b.listingId, 10);
  if (!Number.isFinite(listingId)) return res.status(400).json({ ok: false, error: 'bad listingId' });
  const listing = db.prepare(`SELECT * FROM marketplace_listings WHERE id = ?`).get(listingId);
  if (!listing) return res.status(404).json({ ok: false, error: 'listing not found' });
  if (listing.status !== 'active') return res.status(400).json({ ok: false, error: 'listing is not active' });
  // Re-enabled: buying your own listing creates a real order row, accrues a
  // platform fee and — once Stripe is configured — starts a genuine payment
  // flow, while inflating the revenue figures on the owner dashboard.
  if (listing.user_id === req.user.id) {
    return res.status(400).json({ ok: false, error: 'cannot buy your own listing' });
  }
  if (listing.price_cents == null) return res.status(400).json({ ok: false, error: 'listing has no price — contact seller' });

  const qty = Math.max(1, Math.min(listing.quantity, parseInt(b.quantity, 10) || 1));
  const unitPrice = listing.price_cents;
  const subtotal = unitPrice * qty;
  const fee = Math.round(subtotal * PLATFORM_FEE_RATE);
  const total = subtotal + fee;

  // When Stripe is configured, orders start as 'pending' and move to
  // 'paid' only after the Stripe webhook confirms payment. Without Stripe
  // the order is created as 'paid' directly (offline payment assumed).
  const initialStatus = stripe ? 'pending' : 'paid';

  const info = db.prepare(`
    INSERT INTO marketplace_orders
      (listing_id, buyer_id, seller_id, quantity, unit_price_cents,
       platform_fee_cents, total_cents, currency, status,
       shipping_name, shipping_street, shipping_city, shipping_state,
       shipping_zip, shipping_country)
    VALUES (@listing_id, @buyer_id, @seller_id, @quantity, @unit_price_cents,
            @platform_fee_cents, @total_cents, @currency, @status,
            @shipping_name, @shipping_street, @shipping_city, @shipping_state,
            @shipping_zip, @shipping_country)
  `).run({
    listing_id: listingId,
    buyer_id: req.user.id,
    seller_id: listing.user_id,
    quantity: qty,
    unit_price_cents: unitPrice,
    platform_fee_cents: fee,
    total_cents: total,
    currency: listing.currency || 'USD',
    status: initialStatus,
    shipping_name:    b.shippingName    ? String(b.shippingName).trim()    : null,
    shipping_street:  b.shippingStreet  ? String(b.shippingStreet).trim()  : null,
    shipping_city:    b.shippingCity    ? String(b.shippingCity).trim()    : null,
    shipping_state:   b.shippingState   ? String(b.shippingState).trim()   : null,
    shipping_zip:     b.shippingZip     ? String(b.shippingZip).trim()     : null,
    shipping_country: b.shippingCountry ? String(b.shippingCountry).trim() : null,
  });

  const orderId = Number(info.lastInsertRowid);

  // Decrement listing quantity or mark sold
  if (qty >= listing.quantity) {
    db.prepare(`UPDATE marketplace_listings SET status = 'sold', updated_at = datetime('now') WHERE id = ?`).run(listingId);
  } else {
    db.prepare(`UPDATE marketplace_listings SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`).run(qty, listingId);
  }

  const row = db.prepare(ORDER_JOIN_SQL + ` WHERE o.id = ?`).get(orderId);
  const orderJson = orderToJson(row);

  // If Stripe is configured, create a Checkout Session and return the URL
  if (stripe) {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: (listing.currency || 'USD').toLowerCase(),
            product_data: { name: listing.title },
            unit_amount: unitPrice + Math.round(unitPrice * PLATFORM_FEE_RATE),
          },
          quantity: qty,
        }],
        metadata: { orderId: String(orderId) },
        success_url: `${STRIPE_BASE_URL}/marketplace/orders/${orderId}?payment=success`,
        cancel_url:  `${STRIPE_BASE_URL}/marketplace/orders/${orderId}?payment=cancelled`,
      });
      return res.json({ ok: true, order: orderJson, stripeSessionUrl: session.url });
    } catch (err) {
      logger.error({ event: 'marketplace.stripe_error', error: err.message }, 'Stripe session creation failed');
      // Fall through — order is created as pending, buyer can retry
      return res.json({ ok: true, order: orderJson, stripeError: err.message });
    }
  }

  res.json({ ok: true, order: orderJson });
}));

// List orders (buying + selling tabs)
router.get('/api/marketplace/orders', requireAuth, (req, res) => {
  const role = (req.query.role || 'buying').toString();
  const col = role === 'selling' ? 'seller_id' : 'buyer_id';
  const rows = db.prepare(ORDER_JOIN_SQL + ` WHERE o.${col} = ? ORDER BY o.created_at DESC`).all(req.user.id);
  res.json({ ok: true, orders: rows.map(r => orderToJson(r)) });
});

// Unread message count for the current user.
//
// MUST stay ahead of '/orders/:id'. Express matches in registration order, so
// with the parameterised route first this path bound id='unread-count', failed
// the Number.isFinite check and 400'd with 'bad id' — the endpoint was
// unreachable and every Marketplace page load logged the failure.
router.get('/api/marketplace/orders/unread-count', requireAuth, (req, res) => {
  const row = db.prepare(`
    SELECT COUNT(*) AS cnt FROM marketplace_messages m
    JOIN marketplace_orders o ON o.id = m.order_id
    WHERE m.read = 0 AND m.sender_id != ?
      AND (o.buyer_id = ? OR o.seller_id = ?)
  `).get(req.user.id, req.user.id, req.user.id);
  res.json({ ok: true, unread: row?.cnt || 0 });
});

// Get single order (must be buyer or seller)
router.get('/api/marketplace/orders/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const row = db.prepare(ORDER_JOIN_SQL + ` WHERE o.id = ?`).get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'not found' });
  if (row.buyer_id !== req.user.id && row.seller_id !== req.user.id)
    return res.status(403).json({ ok: false, error: 'not your order' });

  const msgs = db.prepare(`
    SELECT m.*, u.username AS sender_username
    FROM marketplace_messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.order_id = ? ORDER BY m.created_at ASC
  `).all(id);

  // Mark messages as read for this user
  db.prepare(`UPDATE marketplace_messages SET read = 1 WHERE order_id = ? AND sender_id != ? AND read = 0`)
    .run(id, req.user.id);

  res.json({
    ok: true,
    order: orderToJson(row),
    messages: msgs.map(m => ({
      id: m.id, orderId: m.order_id, senderId: m.sender_id,
      senderUsername: m.sender_username, body: m.body,
      read: !!m.read, createdAt: m.created_at,
    })),
  });
});

// Update order status (seller: ship/complete, buyer or seller: cancel)
router.patch('/api/marketplace/orders/:id', requireAuth, safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const existing = db.prepare(`SELECT * FROM marketplace_orders WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });
  const isBuyer  = existing.buyer_id  === req.user.id;
  const isSeller = existing.seller_id === req.user.id;
  if (!isBuyer && !isSeller) return res.status(403).json({ ok: false, error: 'not your order' });

  const b = req.body || {};
  const updates = {};

  if (b.status) {
    const s = String(b.status).toLowerCase();
    if (!ORDER_STATUSES.has(s)) return res.status(400).json({ ok: false, error: 'bad status' });
    if (s === 'cancelled') {
      if (!['pending', 'paid'].includes(existing.status))
        return res.status(400).json({ ok: false, error: 'cannot cancel at this stage' });
      updates.status = 'cancelled';
      updates.cancelled_by = req.user.id;
    } else if (s === 'shipped' && isSeller) {
      updates.status = 'shipped';
    } else if (s === 'completed' && (isBuyer || isSeller)) {
      updates.status = 'completed';
    } else {
      return res.status(400).json({ ok: false, error: 'invalid status transition' });
    }
  }
  if (b.carrier !== undefined && isSeller) updates.carrier = b.carrier ? String(b.carrier).trim() : null;
  if (b.trackingNumber !== undefined && isSeller) updates.tracking_number = b.trackingNumber ? String(b.trackingNumber).trim() : null;

  const keys = Object.keys(updates);
  if (keys.length === 0) return res.status(400).json({ ok: false, error: 'nothing to update' });
  const setSql = keys.map(k => `${k} = @${k}`).join(', ') + `, updated_at = datetime('now')`;
  db.prepare(`UPDATE marketplace_orders SET ${setSql} WHERE id = @id`).run({ ...updates, id });

  const row = db.prepare(ORDER_JOIN_SQL + ` WHERE o.id = ?`).get(id);
  res.json({ ok: true, order: orderToJson(row) });
}));

// Send a message on an order
router.post('/api/marketplace/orders/:id/messages', requireAuth, safeAsync(async (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  if (!Number.isFinite(orderId)) return res.status(400).json({ ok: false, error: 'bad id' });
  const order = db.prepare(`SELECT * FROM marketplace_orders WHERE id = ?`).get(orderId);
  if (!order) return res.status(404).json({ ok: false, error: 'order not found' });
  if (order.buyer_id !== req.user.id && order.seller_id !== req.user.id)
    return res.status(403).json({ ok: false, error: 'not your order' });

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: 'message body required' });
  if (body.length > 2000) return res.status(400).json({ ok: false, error: 'message too long' });

  const info = db.prepare(`
    INSERT INTO marketplace_messages (order_id, sender_id, body) VALUES (?, ?, ?)
  `).run(orderId, req.user.id, body);

  const msg = db.prepare(`
    SELECT m.*, u.username AS sender_username
    FROM marketplace_messages m LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `).get(info.lastInsertRowid);

  res.json({
    ok: true,
    message: {
      id: msg.id, orderId: msg.order_id, senderId: msg.sender_id,
      senderUsername: msg.sender_username, body: msg.body,
      read: !!msg.read, createdAt: msg.created_at,
    },
  });
}));


// ═══════════════════════════════════════════════════════════════════════
//  SAVED SEARCHES + ALERTS
// ═══════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_saved_searches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT    NOT NULL,
    query      TEXT,
    category   TEXT,
    kind       TEXT    NOT NULL DEFAULT 'sell',
    max_price_cents INTEGER,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON marketplace_saved_searches(user_id);

  CREATE TABLE IF NOT EXISTS marketplace_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    saved_search_id INTEGER NOT NULL REFERENCES marketplace_saved_searches(id) ON DELETE CASCADE,
    listing_id      INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    read            INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_user ON marketplace_alerts(user_id);
`);

// List saved searches
router.get('/api/marketplace/saved-searches', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM marketplace_saved_searches WHERE user_id = ? ORDER BY created_at DESC`).all(req.user.id);
  res.json({
    ok: true,
    searches: rows.map(r => ({
      id: r.id, label: r.label, query: r.query,
      category: r.category, kind: r.kind,
      maxPriceCents: r.max_price_cents,
      maxPrice: r.max_price_cents != null ? Number((r.max_price_cents / 100).toFixed(2)) : null,
      createdAt: r.created_at,
    })),
  });
});

// Create saved search
router.post('/api/marketplace/saved-searches', requireAuth, safeAsync(async (req, res) => {
  const b = req.body || {};
  const label = String(b.label || '').trim();
  if (!label) return res.status(400).json({ ok: false, error: 'label required' });
  // Max 20
  const cnt = db.prepare(`SELECT COUNT(*) AS c FROM marketplace_saved_searches WHERE user_id = ?`).get(req.user.id);
  if (cnt.c >= 20) return res.status(400).json({ ok: false, error: 'max 20 saved searches' });

  let maxPriceCents = null;
  if (b.maxPrice != null && b.maxPrice !== '') {
    const n = Number(b.maxPrice);
    if (Number.isFinite(n) && n >= 0) maxPriceCents = Math.round(n * 100);
  }

  const info = db.prepare(`
    INSERT INTO marketplace_saved_searches (user_id, label, query, category, kind, max_price_cents)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.user.id, label, b.query ? String(b.query).trim() : null,
         b.category ? String(b.category) : null,
         b.kind === 'want' ? 'want' : 'sell',
         maxPriceCents);

  const row = db.prepare(`SELECT * FROM marketplace_saved_searches WHERE id = ?`).get(info.lastInsertRowid);
  res.json({
    ok: true,
    search: {
      id: row.id, label: row.label, query: row.query,
      category: row.category, kind: row.kind,
      maxPriceCents: row.max_price_cents,
      maxPrice: row.max_price_cents != null ? Number((row.max_price_cents / 100).toFixed(2)) : null,
      createdAt: row.created_at,
    },
  });
}));

// Delete saved search
router.delete('/api/marketplace/saved-searches/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const existing = db.prepare(`SELECT user_id FROM marketplace_saved_searches WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ ok: false, error: 'not found' });
  if (existing.user_id !== req.user.id)
    return res.status(403).json({ ok: false, error: 'not yours' });
  db.prepare(`DELETE FROM marketplace_saved_searches WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// Get alerts for the current user
router.get('/api/marketplace/alerts', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, l.title AS listing_title, l.category AS listing_category,
           l.vendor AS listing_vendor, l.model AS listing_model,
           l.price_cents AS listing_price_cents, l.currency AS listing_currency,
           l.condition AS listing_condition,
           u.username AS seller_username,
           ss.label AS search_label
    FROM marketplace_alerts a
    LEFT JOIN marketplace_listings l ON l.id = a.listing_id
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN marketplace_saved_searches ss ON ss.id = a.saved_search_id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC LIMIT 50
  `).all(req.user.id);
  res.json({
    ok: true,
    alerts: rows.map(r => ({
      id: r.id, searchLabel: r.search_label, read: !!r.read,
      createdAt: r.created_at,
      listing: {
        id: r.listing_id, title: r.listing_title, category: r.listing_category,
        vendor: r.listing_vendor, model: r.listing_model,
        condition: r.listing_condition,
        priceCents: r.listing_price_cents,
        price: r.listing_price_cents != null ? Number((r.listing_price_cents / 100).toFixed(2)) : null,
        currency: r.listing_currency,
        sellerUsername: r.seller_username,
      },
    })),
  });
});

// Mark all alerts read
router.post('/api/marketplace/alerts/mark-read', requireAuth, (req, res) => {
  db.prepare(`UPDATE marketplace_alerts SET read = 1 WHERE user_id = ? AND read = 0`).run(req.user.id);
  res.json({ ok: true });
});

// Delete an alert
router.delete('/api/marketplace/alerts/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  db.prepare(`DELETE FROM marketplace_alerts WHERE id = ? AND user_id = ?`).run(id, req.user.id);
  res.json({ ok: true });
});

// Unread alert count
router.get('/api/marketplace/alerts/unread-count', requireAuth, (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) AS cnt FROM marketplace_alerts WHERE user_id = ? AND read = 0`).get(req.user.id);
  res.json({ ok: true, unread: row?.cnt || 0 });
});

// ── Alert matching hook: run after every new listing insert ──────────
// Check all saved searches and create alerts for matching users.
function matchAlerts(listing) {
  const searches = db.prepare(`SELECT * FROM marketplace_saved_searches`).all();
  for (const s of searches) {
    if (s.user_id === listing.user_id) continue; // don't alert yourself
    if (s.kind !== listing.kind) continue;
    if (s.category && s.category !== listing.category) continue;
    if (s.max_price_cents != null && listing.price_cents != null && listing.price_cents > s.max_price_cents) continue;
    if (s.query) {
      const q = s.query.toLowerCase();
      const haystack = [listing.title, listing.vendor, listing.model].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    // Check if alert already exists
    const exists = db.prepare(`SELECT 1 FROM marketplace_alerts WHERE saved_search_id = ? AND listing_id = ?`).get(s.id, listing.id);
    if (!exists) {
      db.prepare(`INSERT INTO marketplace_alerts (user_id, saved_search_id, listing_id) VALUES (?, ?, ?)`).run(s.user_id, s.id, listing.id);
    }
  }
}

// Patch the existing POST /api/marketplace/listings handler to call matchAlerts
const _origListingsPost = router.stack.find(
  l => l.route && l.route.path === '/api/marketplace/listings' && l.route.methods.post
);
if (_origListingsPost) {
  const origHandlers = [..._origListingsPost.route.stack.filter(s => s.method === 'post').map(s => s.handle)];
  // We wrap the last handler so it calls matchAlerts after success
  const lastHandler = origHandlers[origHandlers.length - 1];
  if (lastHandler) {
    _origListingsPost.route.stack[_origListingsPost.route.stack.length - 1].handle = async (req, res) => {
      // Intercept res.json to catch the created listing
      const origJson = res.json.bind(res);
      res.json = (data) => {
        if (data?.ok && data?.listing?.id) {
          try {
            const row = db.prepare(`SELECT * FROM marketplace_listings WHERE id = ?`).get(data.listing.id);
            if (row) {
              matchAlerts(row);
              sendDiscordNotification(row).catch(e =>
                logger.error(`[marketplace] Discord notify error: ${e.message}`)
              );
            }
          } catch (e) { logger.error(`[marketplace] matchAlerts error: ${e.message}`); }
        }
        return origJson(data);
      };
      return lastHandler(req, res);
    };
  }
}


// ═══════════════════════════════════════════════════════════════════════
//  PARTNER ACCOUNTS (eBay, Amazon, Discord)
// ═══════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_partner_accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform    TEXT    NOT NULL,
    account_id  TEXT,
    webhook_url TEXT,
    status      TEXT    NOT NULL DEFAULT 'connected',
    listings_count INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, platform)
  );
`);

const PARTNER_PLATFORMS = new Set(['ebay', 'amazon', 'discord']);

// List partner accounts
router.get('/api/marketplace/partner-accounts', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM marketplace_partner_accounts WHERE user_id = ? ORDER BY platform`).all(req.user.id);
  res.json({
    ok: true,
    accounts: rows.map(r => ({
      id: r.id, platform: r.platform, accountId: r.account_id,
      webhookUrl: r.webhook_url, status: r.status,
      listingsCount: r.listings_count,
      createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  });
});

// Connect / update a partner account
router.post('/api/marketplace/partner-accounts', requireAuth, safeAsync(async (req, res) => {
  const b = req.body || {};
  const platform = String(b.platform || '').toLowerCase();
  if (!PARTNER_PLATFORMS.has(platform)) return res.status(400).json({ ok: false, error: 'bad platform' });

  const existing = db.prepare(`SELECT * FROM marketplace_partner_accounts WHERE user_id = ? AND platform = ?`).get(req.user.id, platform);

  if (platform === 'discord') {
    const url = String(b.webhookUrl || '').trim();
    if (!url) return res.status(400).json({ ok: false, error: 'webhook URL required' });
    if (existing) {
      db.prepare(`UPDATE marketplace_partner_accounts SET webhook_url = ?, status = 'connected', updated_at = datetime('now') WHERE id = ?`).run(url, existing.id);
    } else {
      db.prepare(`INSERT INTO marketplace_partner_accounts (user_id, platform, webhook_url, status) VALUES (?, ?, ?, 'connected')`).run(req.user.id, platform, url);
    }
  } else {
    // eBay / Amazon — stub OAuth connection
    const accountId = String(b.accountId || `${platform}_${req.user.id}`).trim();
    if (existing) {
      db.prepare(`UPDATE marketplace_partner_accounts SET account_id = ?, status = 'connected', updated_at = datetime('now') WHERE id = ?`).run(accountId, existing.id);
    } else {
      db.prepare(`INSERT INTO marketplace_partner_accounts (user_id, platform, account_id, status) VALUES (?, ?, ?, 'connected')`).run(req.user.id, platform, accountId);
    }
  }

  const row = db.prepare(`SELECT * FROM marketplace_partner_accounts WHERE user_id = ? AND platform = ?`).get(req.user.id, platform);
  res.json({
    ok: true,
    account: {
      id: row.id, platform: row.platform, accountId: row.account_id,
      webhookUrl: row.webhook_url, status: row.status,
      listingsCount: row.listings_count,
      createdAt: row.created_at, updatedAt: row.updated_at,
    },
  });
}));

// Disconnect a partner account
router.delete('/api/marketplace/partner-accounts/:platform', requireAuth, (req, res) => {
  const platform = String(req.params.platform).toLowerCase();
  if (!PARTNER_PLATFORMS.has(platform)) return res.status(400).json({ ok: false, error: 'bad platform' });
  db.prepare(`UPDATE marketplace_partner_accounts SET status = 'disconnected', updated_at = datetime('now') WHERE user_id = ? AND platform = ?`).run(req.user.id, platform);
  res.json({ ok: true });
});


// ═══════════════════════════════════════════════════════════════════════
//  FLAGGING / REPORTING + ADMIN MODERATION
// ═══════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_flags (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason     TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(listing_id, user_id)
  );
`);

// Flag a listing
router.post('/api/marketplace/listings/:id/flag', requireAuth, safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  const reason = String(req.body?.reason || 'inappropriate').trim();
  try {
    db.prepare(`INSERT INTO marketplace_flags (listing_id, user_id, reason) VALUES (?, ?, ?)`).run(id, req.user.id, reason);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ ok: false, error: 'already flagged' });
    throw e;
  }
  res.json({ ok: true });
}));

// Admin: hide listing (set status to 'closed')
router.post('/api/marketplace/listings/:id/moderate', requireAuth, safeAsync(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'bad id' });
  // Check if user is admin (role field or first user)
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  const isAdmin = user && (user.role === 'admin' || user.id === 1);
  if (!isAdmin) return res.status(403).json({ ok: false, error: 'admin only' });

  const action = String(req.body?.action || 'hide').toLowerCase();
  if (action === 'hide') {
    db.prepare(`UPDATE marketplace_listings SET status = 'closed', updated_at = datetime('now') WHERE id = ?`).run(id);
  } else if (action === 'restore') {
    db.prepare(`UPDATE marketplace_listings SET status = 'active', updated_at = datetime('now') WHERE id = ?`).run(id);
  }
  res.json({ ok: true });
}));


// ═══════════════════════════════════════════════════════════════════════
//  AUTO-EXPIRE (90 days) — runs on each request (debounced to 1×/hour)
// ═══════════════════════════════════════════════════════════════════════
let _lastExpireRun = 0;
function maybeExpireListings() {
  const now = Date.now();
  if (now - _lastExpireRun < 3600_000) return; // 1 hour debounce
  _lastExpireRun = now;
  try {
    const info = db.prepare(`
      UPDATE marketplace_listings SET status = 'closed', updated_at = datetime('now')
      WHERE status = 'active'
        AND created_at < datetime('now', '-90 days')
    `).run();
    if (info.changes > 0) {
      logger.info({ event: 'marketplace.auto_expire', count: info.changes },
        `auto-expired ${info.changes} listing(s)`);
    }
  } catch (e) { logger.error(`[marketplace] auto-expire error: ${e.message}`); }
}

// Hook into the browse route so it runs passively
router.use('/api/marketplace', (req, res, next) => {
  maybeExpireListings();
  next();
});


// ═══════════════════════════════════════════════════════════════════════
//  DASHBOARD / SELLER STATS
// ═══════════════════════════════════════════════════════════════════════

router.get('/api/marketplace/dashboard', requireAuth, (req, res) => {
  const uid = req.user.id;

  const listingStats = db.prepare(`
    SELECT
      COUNT(*)                                   AS total_listings,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_listings,
      SUM(CASE WHEN status = 'sold'   THEN 1 ELSE 0 END) AS sold_listings,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_listings
    FROM marketplace_listings WHERE user_id = ?
  `).get(uid);

  const orderStats = db.prepare(`
    SELECT
      COUNT(*)                                   AS total_orders,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
      SUM(CASE WHEN status = 'completed' THEN total_cents ELSE 0 END) AS revenue_cents,
      SUM(CASE WHEN status IN ('paid','shipped') THEN 1 ELSE 0 END)   AS pending_orders
    FROM marketplace_orders WHERE seller_id = ?
  `).get(uid);

  const buyStats = db.prepare(`
    SELECT
      COUNT(*) AS total_purchases,
      SUM(CASE WHEN status = 'completed' THEN total_cents ELSE 0 END) AS spent_cents
    FROM marketplace_orders WHERE buyer_id = ?
  `).get(uid);

  const recentListings = db.prepare(`
    SELECT id, title, category, status, price_cents, currency, created_at
    FROM marketplace_listings WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 10
  `).all(uid);

  res.json({
    ok: true,
    dashboard: {
      listings: {
        total:  listingStats.total_listings  || 0,
        active: listingStats.active_listings || 0,
        sold:   listingStats.sold_listings   || 0,
        closed: listingStats.closed_listings || 0,
      },
      sales: {
        totalOrders:     orderStats.total_orders     || 0,
        completedOrders: orderStats.completed_orders || 0,
        pendingOrders:   orderStats.pending_orders   || 0,
        revenueCents:    orderStats.revenue_cents     || 0,
        revenue:         Number(((orderStats.revenue_cents || 0) / 100).toFixed(2)),
      },
      purchases: {
        total:     buyStats.total_purchases || 0,
        spentCents: buyStats.spent_cents    || 0,
        spent:     Number(((buyStats.spent_cents || 0) / 100).toFixed(2)),
      },
      recentListings: recentListings.map(l => ({
        id: l.id, title: l.title, category: l.category,
        status: l.status, priceCents: l.price_cents,
        price: l.price_cents != null ? Number((l.price_cents / 100).toFixed(2)) : null,
        currency: l.currency, createdAt: l.created_at,
      })),
    },
  });
});


// ═══════════════════════════════════════════════════════════════════════
//  DISCORD — test webhook
// ═══════════════════════════════════════════════════════════════════════
router.post('/api/marketplace/partner-accounts/discord/test', requireAuth, safeAsync(async (req, res) => {
  const acct = db.prepare(
    "SELECT * FROM marketplace_partner_accounts WHERE user_id = ? AND platform = 'discord' AND status = 'connected'"
  ).get(req.user.id);
  if (!acct || !acct.webhook_url) return res.status(400).json({ ok: false, error: 'No Discord webhook connected' });
  try {
    const r = await fetch(acct.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'RackTrack webhook test — your Discord integration is working.',
        embeds: [{
          title: 'Webhook Test',
          description: 'This is a test notification from RackTrack Marketplace.',
          color: 0x22c55e,
          footer: { text: 'RackTrack Marketplace' },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!r.ok) throw new Error(`Discord returned ${r.status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: `Webhook failed: ${err.message}` });
  }
}));


// ═══════════════════════════════════════════════════════════════════════
//  STRIPE — env-gated payment integration
// ═══════════════════════════════════════════════════════════════════════

// Status check so the frontend knows whether to show Stripe or direct flow
router.get('/api/marketplace/stripe/status', (req, res) => {
  res.json({ ok: true, configured: !!stripe });
});

// Stripe webhook — receives checkout.session.completed events
router.post('/api/marketplace/stripe/webhook', express.raw({ type: 'application/json' }), safeAsync(async (req, res) => {
  if (!stripe) return res.status(404).json({ ok: false, error: 'Stripe not configured' });
  let event;
  try {
    event = STRIPE_WEBHOOK
      ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK)
      : JSON.parse(req.body);
  } catch (err) {
    return res.status(400).json({ ok: false, error: `Webhook verification failed: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const orderId = event.data?.object?.metadata?.orderId;
    if (orderId) {
      db.prepare(
        "UPDATE marketplace_orders SET status = 'paid', updated_at = datetime('now') WHERE id = ? AND status = 'pending'"
      ).run(parseInt(orderId, 10));
      logger.info({ event: 'marketplace.stripe_paid', orderId }, 'order paid via Stripe');
    }
  }
  res.json({ ok: true, received: true });
}));


// ═══════════════════════════════════════════════════════════════════════
//  eBAY / AMAZON — OAuth stubs (env-gated)
// ═══════════════════════════════════════════════════════════════════════

// eBay OAuth
router.get('/api/marketplace/partner-accounts/ebay/status', (req, res) => {
  res.json({ ok: true, configured: !!(EBAY_APP_ID && EBAY_CERT_ID && EBAY_REDIRECT_URI) });
});

router.get('/api/marketplace/partner-accounts/ebay/auth-url', requireAuth, (req, res) => {
  if (!EBAY_APP_ID || !EBAY_CERT_ID || !EBAY_REDIRECT_URI) {
    return res.status(400).json({ ok: false, error: 'eBay API keys not configured. Set EBAY_APP_ID, EBAY_CERT_ID, EBAY_REDIRECT_URI in .env' });
  }
  const scope = encodeURIComponent('https://api.ebay.com/oauth/api_scope/sell.inventory');
  const url = `https://auth.ebay.com/oauth2/authorize?client_id=${EBAY_APP_ID}&redirect_uri=${encodeURIComponent(EBAY_REDIRECT_URI)}&response_type=code&scope=${scope}&state=${req.user.id}`;
  res.json({ ok: true, url });
});

router.get('/api/marketplace/partner-accounts/ebay/callback', safeAsync(async (req, res) => {
  if (!EBAY_APP_ID || !EBAY_CERT_ID) {
    return res.status(400).json({ ok: false, error: 'eBay not configured' });
  }
  const { code, state } = req.query;
  const userId = parseInt(state, 10);
  if (!code || !Number.isFinite(userId)) return res.status(400).json({ ok: false, error: 'bad callback' });

  // Exchange code for token
  const basic = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');
  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(EBAY_REDIRECT_URI)}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    logger.error({ event: 'marketplace.ebay_oauth_error', error: tokenData }, 'eBay token exchange failed');
    return res.redirect(`${STRIPE_BASE_URL}/marketplace/partners?error=ebay_auth_failed`);
  }

  // Store credentials
  const existing = db.prepare("SELECT * FROM marketplace_partner_accounts WHERE user_id = ? AND platform = 'ebay'").get(userId);
  const accountId = tokenData.access_token ? `ebay_${userId}` : null;
  if (existing) {
    db.prepare("UPDATE marketplace_partner_accounts SET account_id = ?, status = 'connected', updated_at = datetime('now') WHERE id = ?").run(accountId, existing.id);
  } else {
    db.prepare("INSERT INTO marketplace_partner_accounts (user_id, platform, account_id, status) VALUES (?, 'ebay', ?, 'connected')").run(userId, accountId);
  }
  res.redirect(`${STRIPE_BASE_URL}/marketplace/partners?connected=ebay`);
}));

// Amazon SP-API OAuth
router.get('/api/marketplace/partner-accounts/amazon/status', (req, res) => {
  res.json({ ok: true, configured: !!(AMAZON_SP_CLIENT && AMAZON_SP_SECRET && AMAZON_REDIRECT) });
});

router.get('/api/marketplace/partner-accounts/amazon/auth-url', requireAuth, (req, res) => {
  if (!AMAZON_SP_CLIENT || !AMAZON_REDIRECT) {
    return res.status(400).json({ ok: false, error: 'Amazon API keys not configured. Set AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET, AMAZON_REDIRECT_URI in .env' });
  }
  const url = `https://sellercentral.amazon.com/apps/authorize/consent?application_id=${AMAZON_SP_CLIENT}&redirect_uri=${encodeURIComponent(AMAZON_REDIRECT)}&state=${req.user.id}`;
  res.json({ ok: true, url });
});

router.get('/api/marketplace/partner-accounts/amazon/callback', safeAsync(async (req, res) => {
  if (!AMAZON_SP_CLIENT || !AMAZON_SP_SECRET) {
    return res.status(400).json({ ok: false, error: 'Amazon not configured' });
  }
  const { spapi_oauth_code, state } = req.query;
  const userId = parseInt(state, 10);
  if (!spapi_oauth_code || !Number.isFinite(userId)) return res.status(400).json({ ok: false, error: 'bad callback' });

  // Exchange code for token
  const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${encodeURIComponent(spapi_oauth_code)}&client_id=${AMAZON_SP_CLIENT}&client_secret=${AMAZON_SP_SECRET}&redirect_uri=${encodeURIComponent(AMAZON_REDIRECT)}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    logger.error({ event: 'marketplace.amazon_oauth_error', error: tokenData }, 'Amazon token exchange failed');
    return res.redirect(`${STRIPE_BASE_URL}/marketplace/partners?error=amazon_auth_failed`);
  }

  const existing = db.prepare("SELECT * FROM marketplace_partner_accounts WHERE user_id = ? AND platform = 'amazon'").get(userId);
  const accountId = tokenData.access_token ? `amazon_${userId}` : null;
  if (existing) {
    db.prepare("UPDATE marketplace_partner_accounts SET account_id = ?, status = 'connected', updated_at = datetime('now') WHERE id = ?").run(accountId, existing.id);
  } else {
    db.prepare("INSERT INTO marketplace_partner_accounts (user_id, platform, account_id, status) VALUES (?, 'amazon', ?, 'connected')").run(userId, accountId);
  }
  res.redirect(`${STRIPE_BASE_URL}/marketplace/partners?connected=amazon`);
}));


module.exports = router;
