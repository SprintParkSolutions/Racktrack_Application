# RackTrack Marketplace — Feature Report

**Date:** 2026-07-16
**Status:** Active development — Stripe, eBay, and Amazon integrations are env-gated stubs awaiting credentials.

---

## Overview

The Marketplace is a secondary market built into RackTrack for buying and selling surplus networking and data-center gear (cables, switches, routers, racks, optics, servers, PDUs, firewalls, patch panels). It supports three sell paths:

1. **Direct listing on RackTrack** — rows in the `marketplace_listings` table, anyone with admin/owner role can browse.
2. **Partner redirect** — deep-link search URLs for eBay, Amazon, FS.com, Curvature built from vendor + model. No credential storage on our side.
3. **Buyer matching (Wanted)** — listings with `kind='want'` alongside `kind='sell'`. Sellers browse open wanted-rows and reach out.

---

## Backend

**File:** `server/marketplace_routes.js`
**Storage:** Shared `server/data/auth.db` (SQLite) — foreign key to `users(id)` gives free cascade-on-delete and per-user scoping.

### Database Tables

| Table | Purpose |
|---|---|
| `marketplace_listings` | All for-sale and wanted listings (kind: sell/want) |
| `marketplace_orders` | Purchase orders linking buyer, seller, listing |
| `marketplace_messages` | Per-order buyer/seller messaging thread |
| `marketplace_saved_searches` | User-saved search filters for alert matching |
| `marketplace_alerts` | Notifications when new listings match saved searches |
| `marketplace_partner_accounts` | Connected eBay, Amazon, Discord accounts per user |
| `marketplace_flags` | User-reported/flagged listings |

### Listing CRUD

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/marketplace/categories` | Admin | Returns accepted category enum |
| `GET /api/marketplace/listings` | Admin | Browse active listings (paginated, filterable by q/category/kind/condition) |
| `GET /api/marketplace/listings/mine` | Auth | User's own listings (all statuses) |
| `GET /api/marketplace/listings/:id` | Admin | Single listing + partner search URLs |
| `POST /api/marketplace/listings` | Auth | Create listing (triggers alert matching + Discord webhook) |
| `PATCH /api/marketplace/listings/:id` | Auth | Update own listing (title, price, status, etc.) |
| `DELETE /api/marketplace/listings/:id` | Auth | Delete own listing |

**Categories:** cable, switch, router, rack, optic, server, pdu, firewall, patch_panel, other
**Conditions:** new, refurb, used, for-parts
**Kinds:** sell, want

### Orders & Checkout

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/marketplace/orders` | Auth | Create order (calculates 3% platform fee; creates Stripe session if configured) |
| `GET /api/marketplace/orders` | Auth | List orders (buying or selling tab via `?role=`) |
| `GET /api/marketplace/orders/:id` | Auth | Single order + message thread (marks messages read) |
| `PATCH /api/marketplace/orders/:id` | Auth | Update order status (ship/complete/cancel) + tracking info |
| `POST /api/marketplace/orders/:id/messages` | Auth | Send a message on an order (max 2000 chars) |
| `GET /api/marketplace/orders/unread-count` | Auth | Unread message count badge |

**Order statuses:** pending → paid → shipped → completed / cancelled
**Platform fee:** 3% of subtotal

### Saved Searches & Alerts

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/marketplace/saved-searches` | Auth | List saved searches (max 20 per user) |
| `POST /api/marketplace/saved-searches` | Auth | Create saved search (label, query, category, kind, max price) |
| `DELETE /api/marketplace/saved-searches/:id` | Auth | Delete saved search |
| `GET /api/marketplace/alerts` | Auth | List alerts (last 50, with listing detail) |
| `POST /api/marketplace/alerts/mark-read` | Auth | Mark all alerts read |
| `DELETE /api/marketplace/alerts/:id` | Auth | Delete single alert |
| `GET /api/marketplace/alerts/unread-count` | Auth | Unread alert count |

**Alert matching:** Runs automatically after every new listing insert. Checks all saved searches for matching category, kind, query substring, and max price. Users are not alerted on their own listings.

### Partner Accounts (eBay, Amazon, Discord)

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/marketplace/partner-accounts` | Auth | List connected accounts |
| `POST /api/marketplace/partner-accounts` | Auth | Connect/update (Discord: webhook URL; eBay/Amazon: account ID) |
| `DELETE /api/marketplace/partner-accounts/:platform` | Auth | Disconnect |

### Discord Integration

| Endpoint | Auth | Description |
|---|---|---|
| `POST .../partner-accounts/discord/test` | Auth | Send test webhook message |
| `sendDiscordNotification()` (internal) | — | Fire-and-forget rich embed to all connected webhooks on new listing |

Embed includes: title, description (truncated 200 chars), category, condition, price, equipment, location, timestamp.

### Stripe Payment Integration (env-gated)

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/marketplace/stripe/status` | Admin | Returns `{ configured: true/false }` |
| `POST /api/marketplace/stripe/webhook` | None | Receives `checkout.session.completed` → marks order `paid` |

**Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BASE_URL`

**Flow:**
1. Order created with status `pending`
2. Stripe Checkout Session URL returned to frontend
3. User redirected to Stripe to pay
4. Stripe fires `checkout.session.completed` webhook
5. Order status updated to `paid`

When Stripe is not configured, orders are created directly as `paid` (offline payment assumed).

### eBay / Amazon OAuth (env-gated stubs)

| Endpoint | Description |
|---|---|
| `GET .../ebay/status` | Check if eBay API keys configured |
| `GET .../ebay/auth-url` | Generate eBay OAuth consent URL |
| `GET .../ebay/callback` | Exchange auth code for token, store partner account |
| `GET .../amazon/status` | Check if Amazon SP-API configured |
| `GET .../amazon/auth-url` | Generate Amazon seller consent URL |
| `GET .../amazon/callback` | Exchange auth code for token, store partner account |

**eBay env vars:** `EBAY_APP_ID`, `EBAY_CERT_ID`, `EBAY_REDIRECT_URI`
**Amazon env vars:** `AMAZON_SP_CLIENT_ID`, `AMAZON_SP_CLIENT_SECRET`, `AMAZON_REDIRECT_URI`

### Moderation & Flagging

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/marketplace/listings/:id/flag` | Auth | Flag a listing (reason required, unique per user) |
| `POST /api/marketplace/listings/:id/moderate` | Admin | Hide (close) or restore a listing |

### Seller Dashboard

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/marketplace/dashboard` | Auth | Listing stats, sales stats (orders/revenue/pending), purchase stats (total/spent), recent 10 listings |

### Partner Search (redirect URLs)

| Endpoint | Description |
|---|---|
| `GET /api/marketplace/partner-search` | Builds deep-link search URLs for eBay, Amazon, FS.com, Curvature from vendor + model query |

FS.com and Curvature links only appear for networking-specific categories (switch, router, optic, firewall).

### Image Uploads

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/marketplace/uploads` | Auth | Upload single listing image (jpg/png/webp/heic, max 8 MB) |

Images are stored in `server/uploads/marketplace/` and served from `/uploads/marketplace/<filename>`.

### Auto-Expire

Listings older than 90 days are automatically marked `closed`. Runs passively on any marketplace API request, debounced to once per hour.

---

## Frontend Pages

| Page | Route | File |
|---|---|---|
| Marketplace (browse/mine) | `/marketplace` | `client/src/pages/MarketplacePage.jsx` |
| New Listing | `/marketplace/new` | `client/src/pages/MarketplaceNewPage.jsx` |
| Checkout | `/marketplace/checkout/:listingId` | `client/src/pages/MarketplaceCheckoutPage.jsx` |
| Orders | `/marketplace/orders` | `client/src/pages/MarketplaceOrdersPage.jsx` |
| Alerts | `/marketplace/alerts` | `client/src/pages/MarketplaceAlertsPage.jsx` |
| Dashboard | `/marketplace/dashboard` | `client/src/pages/MarketplaceDashboardPage.jsx` |
| Partner Accounts | `/marketplace/partners` | `client/src/pages/MarketplacePartnerAccountsPage.jsx` |

### MarketplacePage

- **Browse tab** — paginated listing grid with search, category filter, kind toggle (For Sale / Wanted)
- **My Listings tab** — user's own listings with Edit, Mark Sold, Reactivate, Delete, and **Post to Amazon** (static) actions
- **Listing detail modal** — full listing details, partner marketplace links (eBay/Amazon/FS.com/Curvature), Buy Now for buyers, owner actions + Post to Amazon for owners
- **Buy Now button** — on every priced active listing card in both For Sale and Wanted tabs, navigates to checkout page
- **Partner search bar** — vendor + model → eBay/Amazon/FS.com/Curvature redirect links
- **Post to Amazon** — static button that toggles to "Posted to Amazon" on click (local state only, ready for real API integration once Amazon credentials are configured)

### MarketplaceNewPage

- Prefill via query params (`vendor`, `model`, `category`, `rackId`) from scan results "Sell" button
- Image upload with instant blob preview (8 MB max, jpg/png/webp/heic)
- Blocks form submission while image is still uploading
- Kind toggle (sell/want), category, condition, quantity, price, currency, location, description fields

### MarketplaceCheckoutPage

- Fetches listing details and Stripe status in parallel on mount
- Shipping address form (name, street, city, state, zip, country)
- Quantity picker (when listing has qty > 1)
- Price breakdown: subtotal + 3% platform fee + total
- **Stripe-aware UI:**
  - When Stripe is configured: "Pay with Stripe — $X.XX" button, redirects to Stripe Checkout
  - When Stripe is off: "Complete Purchase — $X.XX" button, navigates to order page
- Contextual hint text changes based on Stripe availability

### Scan Results Integration

- **Sell button** in the port-located view bottom action bar (alongside Change Device / New Scan)
- **Sell button** on each device card in the All Components view
- **Pagination** (2 devices per page) on the All Components device list
- All Sell buttons navigate to `/marketplace/new` with category, vendor, model, and rackId pre-filled from the detected device

---

## Environment Variables

| Variable | Purpose | Status |
|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe payments | Optional, env-gated |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification | Optional |
| `BASE_URL` | Stripe success/cancel redirect URLs | Defaults to `https://localhost:5173` |
| `EBAY_APP_ID` | eBay OAuth client ID | Optional, stub |
| `EBAY_CERT_ID` | eBay OAuth client secret | Optional, stub |
| `EBAY_REDIRECT_URI` | eBay OAuth callback URL | Optional, stub |
| `AMAZON_SP_CLIENT_ID` | Amazon SP-API OAuth client ID | Optional, stub |
| `AMAZON_SP_CLIENT_SECRET` | Amazon SP-API OAuth client secret | Optional, stub |
| `AMAZON_REDIRECT_URI` | Amazon OAuth callback URL | Optional, stub |

---

## What's Static / Stubbed (needs real credentials to activate)

| Feature | Current State | What's Needed |
|---|---|---|
| **Post to Amazon** | Button toggles local state only ("Posted to Amazon"), no API call | Amazon SP-API credentials + real listing push logic |
| **eBay OAuth** | Full OAuth flow coded, exchanges token, stores account | `EBAY_APP_ID` + `EBAY_CERT_ID` + `EBAY_REDIRECT_URI` in .env |
| **Amazon OAuth** | Full OAuth flow coded, exchanges token, stores account | `AMAZON_SP_CLIENT_ID` + `AMAZON_SP_CLIENT_SECRET` + `AMAZON_REDIRECT_URI` in .env |
| **Stripe Payments** | Full Checkout Session + webhook flow coded | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in .env, `stripe` npm package installed |
| **Discord Webhooks** | Fully functional | Just needs a webhook URL saved via Partner Accounts page |

---

## Architecture Notes

- All marketplace data lives in the shared `server/data/auth.db` SQLite database (WAL mode, foreign keys enabled)
- All marketplace API routes are gated behind `requireRole('owner', 'org_admin')`
- Image uploads use `multer` with disk storage, scoped to `server/uploads/marketplace/`
- Partner search URLs are constructed client-side from vendor+model — no API keys or credentials involved
- Alert matching is synchronous and runs inline after listing creation (alongside Discord notification which is async/fire-and-forget)
- Auto-expire is passive (no cron) — triggered on any marketplace API request, debounced to 1 hour
