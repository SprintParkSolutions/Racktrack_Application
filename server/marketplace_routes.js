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
const { requireAuth } = require('./auth');
const { logger } = require('./lib/observability');

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

// --- Image uploads --------------------------------------------------
// Dedicated multer instance scoped to marketplace listing photos. We
// accept jpg/png/webp up to 8 MB and write them to
// server/uploads/marketplace/. The returned URL is what the client
// stores on the listing's image_url column.
function _imgExt(originalName) {
  const m = String(originalName || '').match(/\.(jpe?g|png|webp)$/i);
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
    cb(ok ? null : new Error('Only jpg / png / webp images are accepted'), ok);
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

// Public: list categories so the UI doesn't hard-code them.
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

module.exports = router;
