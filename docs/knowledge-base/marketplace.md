# Marketplace

*Buy, sell and swap surplus network and data-center gear without leaving RackTrack.*

Feature · Admins & Owners only · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

Racks turn over. You decommission a switch, a spare PDU comes off a project, a transceiver is needed *today*. The Marketplace is a place built inside RackTrack to move that gear between organizations: **list surplus hardware for sale**, post a **"wanted" ad** for something you're hunting for, **buy** a listing another org has put up, and **track the order** — including a private message thread with the other side — all the way through to delivery.

It sits alongside the rest of RackTrack, so a listing can be **backed by a scan**: created straight from a device RackTrack detected, carrying the rack ID it came from. That lets a buyer see the item is a real, identified piece of kit rather than a description someone typed from memory.

One important thing to know up front: **the Marketplace is an admin feature.** Only a member whose role is **Organization Admin** or **Owner** can open it at all. Everyone else who tries to reach a marketplace page is sent back to the home screen, and the server refuses marketplace requests that don't come from an admin or owner. So "who can use it" is not "everyone who can browse the web" — it is the people who run the org's inventory.

If what you're after isn't listed on RackTrack, a **partner search** hands you off to eBay, Amazon, FS.com or Curvature with the part number already filled in. RackTrack takes no cut of those and creates nothing on the other site — it's simply a fast door out to where the part might be.

## 2. At a glance

| | |
|---|---|
| **What it is** | A secondary market for surplus networking and data-center gear (cables, switches, routers, racks, optics/SFPs, servers, PDUs, firewalls, patch panels), built into RackTrack. |
| **Who can use it** | **Organization Admins and Owners only.** Every marketplace page and API route is gated to those two roles; any other member is redirected away. |
| **Three ways to sell** | A direct RackTrack listing; a "wanted" request that sellers answer; or a hand-off link to a partner marketplace. |
| **Main sections** | Browse, My listings, Checkout, Orders (with messaging), Alerts (saved searches), Seller dashboard, Partner accounts. |
| **Where a listing comes from** | Typed in by the seller — optionally pre-filled from a RackTrack scan. |
| **Money** | Optional Stripe checkout. Where Stripe isn't configured, orders are recorded and payment is handled offline. A flat **3% platform fee** is added at checkout. |
| **Data source** | **Real** — every listing, order and message is posted by a real user. There is no seeded demo catalog. |

## 3. How it works — step by step

### Browse and buy

1. Open **Marketplace** (you must be signed in as an Admin or Owner). You land on **Browse**, a grid of everything currently for sale.
2. Narrow it down with the toolbar: type a **keyword** (it matches the title, vendor or model), pick a **category**, and flip the **For sale / Wanted** switch.
3. **Tap a card** to open its full detail — the large photo, the description, the seller, the price, and, if it came from a scan, its "From scan" backing.
4. On a priced, active **for-sale** listing, press **Buy now** to go to checkout. (Wanted requests and listings with no set price don't show a Buy button — you contact the seller instead.)

### Create a listing (sell surplus gear)

1. Press **List an item** (top-right on any marketplace page) to open the new-listing form.
2. Choose the type: **For sale** or **Wanted**.
3. Fill in the item — **title** (the only required field), plus optional vendor, model and a category. Set the **condition**, an optional **price** (leave it blank to invite offers), a **quantity**, and a currency.
4. Optionally **upload a photo** and add a location and description.
5. Press **Publish listing** (or **Post request** for a wanted ad). You're taken to **My listings**, where your new post appears.
6. If you started from a **scan result**, the form arrives pre-filled with that device's vendor, model, category and rack ID, so listing a decommissioned unit takes seconds.

### Checkout

1. From a listing's **Buy now**, you reach the checkout screen.
2. Pick a **quantity** (only shown when more than one is available) and fill in the **shipping address** (full name, street and city are required; state, ZIP and country are optional).
3. Review the **order summary** — unit price, quantity, subtotal, the **3% platform fee**, and the total.
4. Press the confirm button. If the server has **Stripe** configured, you're redirected to Stripe to pay securely; otherwise the order is recorded directly and payment is arranged offline with the seller. Either way you land on the order page.

### Track orders

1. Open **Orders**. Toggle between **Buying** (things you've ordered) and **Selling** (orders on your listings).
2. **Open an order** to see its status, totals, tracking and a **message thread** with the other party. The thread refreshes on its own every 30 seconds.
3. As a **seller**, once an order is paid you add a **carrier and tracking number** and press **Mark shipped**.
4. Either side can **Mark completed** once it's shipped, or **Cancel** while it's still pending or paid. Both of those ask for a second confirming click first.

### Set up alerts

1. Open **Alerts**. It has two parts: **Matches** (new listings that fit your saved searches) at the top, and **Saved searches** below.
2. Press **New search**, give it a **label**, and describe what you want — a keyword, a category, a for-sale/wanted choice, and an optional maximum price.
3. From then on, every new listing that fits lands in **Matches**, usually within minutes of being posted. Press **View** to jump to it, or dismiss it. **Mark all read** clears the unread dots.

## 4. What you see on screen

Every marketplace page shares one header and one row of tabs — **Browse, My listings, Orders, Alerts, Dashboard, Partners** — plus a **List an item** button. The Orders and Alerts tabs carry a small badge showing how many unread messages or matches are waiting.

**The browse grid.** Cards laid out like a shop. Each shows a photo (or a category icon when there's none), the category and condition, the title, the vendor/model, the price (or "Make an offer"), how long ago it was listed, and the seller's username. Priced for-sale cards carry a **Buy now** button. A count beside the heading tells you how many results there are, and a **Previous / Next** pager sits underneath (24 per page). At the very bottom is a quiet **partner-search strip** — type a part number and it opens eBay, Amazon, FS.com or Curvature in a new tab. When nothing matches, an empty-state panel offers to clear the filters or to list an item.

**The listing detail (a pop-up).** Opening a card brings up a dialog with the big photo, category and condition, title, vendor/model and price, and a facts panel — **seller, listed date**, and where present, **quantity available, location** and the **"From scan"** rack ID. Below that is the description. If the listing is **yours**, you get owner controls (**Mark sold / Relist, Delete**). If it's **someone else's**, you get **Buy now** (on priced for-sale items), a note to make an offer when there's no price, and a **Report listing** link that opens a short reason box. A **"Compare elsewhere"** row links out to matching partner searches.

**The new-listing form.** Grouped into named sections — a **For sale / Wanted** toggle, **Item** (title, vendor, model, category), **Condition & pricing** (condition, price, currency, quantity), **Photo** (drag-or-tap upload with an instant preview, up to 8 MB), and **Location & details** (location, a description with a live character count up to 2,000). A scan-prefilled form shows a "Prefilled from scan" note. Once a vendor or model is typed, an **"Or send buyers to a partner"** box appears with outbound links. A pinned action bar at the bottom holds **Cancel** and **Publish**.

**The orders list and order detail.** The list shows a row per order — thumbnail, title, the other party, quantity, age and total — each with a coloured status dot (pending, paid, shipped, completed, cancelled). Opening one shows the item, an order facts panel (order number, placed date, quantity, tracking), the total, the state-appropriate action (ship / complete / cancel), and the **message thread** with a composer at the foot (Enter sends).

**The alerts page.** **Matches** are rows carrying the listing's title and details, with an ink dot marking unread ones; each has **View** and a dismiss button. **Saved searches** are rows showing the search's filters as small pills, each with a delete button, plus a **New search** form.

**The partner accounts page.** Three identical cards — **eBay, Amazon, Discord** — each with a status pill (Connected / Not connected) and a connect button. eBay and Amazon connect over OAuth but only when the server has API keys configured (otherwise the card reads "API keys not configured on this server"). Discord takes a **webhook URL** and offers a **Send test** button.

**The seller dashboard.** Plain number tiles grouped under three headings — **Listings** (total, active, sold, closed), **Sales** (revenue from completed orders, total orders, completed, pending), and **Purchases** (spent, orders) — followed by your **10 most recent listings**.

## 5. The logic behind it

**For sale vs Wanted.** Every listing has a *kind*. A **For sale** listing (`sell`) is gear you're offering; a **Wanted** listing (`want`) is a request describing gear you're hunting for, so sellers can browse open requests and reach out. The browse toolbar, the new-listing form and the saved-search form all carry the same For sale / Wanted switch, and the two never mix in a result set — you're always looking at one or the other. Only priced, active **for-sale** listings get a Buy button; a Wanted request is a conversation starter, not something you check out.

**Prices and offers.** A price is optional. Leave it blank and the listing reads **"Make an offer"** — there's no Buy button, and a buyer is pointed to contact the seller instead. A set price is what checkout charges, plus the flat 3% fee.

**Listing lifecycle.** A new listing is **active**. It becomes **sold** when the seller marks it so, or automatically when an order takes the last of its quantity (a partial order just decrements the quantity). It becomes **closed** when the seller withdraws it, when an admin hides it, or automatically once it's more than **90 days** old. A closed or sold listing can be **relisted** back to active by its owner.

**The order flow.** Placing an order checks that the listing is active, that it has a price, and that you're not buying your own listing. It then records the order and adjusts the listing's stock. From there the status moves in one direction:

```
pending ──▶ paid ──▶ shipped ──▶ completed
   │          │
   └──────────┴──▶ cancelled   (only while pending or paid)
```

- **pending / paid** — where Stripe is on, an order starts *pending* and flips to *paid* once Stripe confirms payment; where Stripe is off, it's created *paid* straight away (offline payment assumed).
- **shipped** — only the **seller** sets this, and only from *paid*, attaching a carrier and tracking number.
- **completed** — **either** party can close it out, but only once it's *shipped*.
- **cancelled** — **either** party can cancel, but only while it's still *pending* or *paid*; once it's shipped, cancelling is off the table.

**Access is enforced twice.** The rule that the Marketplace is admin/owner-only isn't just a hidden menu item — the browser routes redirect non-admins home, *and* the server independently rejects marketplace API calls that don't carry an admin or owner session. (The only exceptions are three machine-to-machine callbacks — the Stripe payment webhook and the eBay/Amazon OAuth returns — which authenticate by signature or a state token rather than a login.)

**Partners are a hand-off, not a middleman.** Partner search links only pre-fill a query and open in a new tab. Nothing is listed on the other site through them, no credentials are exchanged, and RackTrack takes no cut.

## 6. Under the hood

**Frontend.** Seven lazy-loaded pages under `client/src/pages/`, all wrapped in `<AdminRoute>` in `client/src/App.jsx`, which requires `user.role` to be `org_admin` or `owner` (and redirects otherwise):

| Page | Route | File |
|---|---|---|
| Browse / My listings | `/marketplace` | `MarketplacePage.jsx` |
| New listing | `/marketplace/new` | `MarketplaceNewPage.jsx` |
| Checkout | `/marketplace/checkout/:listingId` | `MarketplaceCheckoutPage.jsx` |
| Orders + order detail | `/marketplace/orders`, `/marketplace/orders/:orderId` | `MarketplaceOrdersPage.jsx` |
| Alerts | `/marketplace/alerts` | `MarketplaceAlertsPage.jsx` |
| Seller dashboard | `/marketplace/dashboard` | `MarketplaceDashboardPage.jsx` |
| Partner accounts | `/marketplace/partners` | `MarketplacePartnerAccountsPage.jsx` |

Shared chrome (header, tab nav, unread badges) lives in `client/src/components/marketplace/MarketplaceShell.jsx`.

**Backend.** All endpoints live in `server/marketplace_routes.js` and share the `server/data/auth.db` SQLite database (WAL mode, foreign keys on). A single guard gates the whole `/api/marketplace/*` tree behind `requireRole('owner', 'org_admin')`, exempting only the Stripe webhook and the eBay/Amazon OAuth callbacks. Tables: `marketplace_listings`, `marketplace_orders`, `marketplace_messages`, `marketplace_saved_searches`, `marketplace_alerts`, `marketplace_partner_accounts`, `marketplace_flags`.

*Listings, uploads, categories*

| Method & path | What it does |
|---|---|
| `GET /api/marketplace/categories` | The accepted category list. |
| `GET /api/marketplace/listings` | Browse active listings; filters `q` (title/vendor/model substring), `category`, `kind` (default `sell`), `condition`; paginated (`limit` default 30, max 100). |
| `GET /api/marketplace/listings/mine` | The caller's own listings, every status. |
| `GET /api/marketplace/listings/:id` | One listing, plus partner-search URLs for it. |
| `POST /api/marketplace/listings` | Create a listing (title required; validates kind/category/condition). Also fires alert matching and any Discord webhook. |
| `PATCH /api/marketplace/listings/:id` | Update your own listing — copy, price, quantity, or status (sold/active/closed). |
| `DELETE /api/marketplace/listings/:id` | Delete your own listing — refused with 409 if it already has orders. |
| `POST /api/marketplace/uploads` | Upload one image (jpg/png/webp/heic, ≤ 8 MB) to `server/uploads/marketplace/`; returns its URL. |
| `GET /api/marketplace/partner-search` | Build outbound eBay/Amazon (+ FS.com/Curvature for networking categories) search URLs from a vendor/model query. |

*Orders and messaging*

| Method & path | What it does |
|---|---|
| `POST /api/marketplace/orders` | Create an order (adds the 3% fee; opens a Stripe session when configured). Can't buy your own listing or one with no price. |
| `GET /api/marketplace/orders` | List orders for the `?role=buying` or `selling` tab. |
| `GET /api/marketplace/orders/:id` | One order plus its message thread (marks incoming messages read). |
| `PATCH /api/marketplace/orders/:id` | Status transitions (ship/complete/cancel, per the rules above) and tracking fields. |
| `POST /api/marketplace/orders/:id/messages` | Post a message on an order (≤ 2,000 chars). |
| `GET /api/marketplace/orders/unread-count` | Unread-message badge count. |

*Saved searches and alerts*

| Method & path | What it does |
|---|---|
| `GET/POST/DELETE /api/marketplace/saved-searches[/:id]` | Manage saved searches (label required; **max 20 per user**). |
| `GET /api/marketplace/alerts` | Matches for the caller (most recent 50). |
| `POST /api/marketplace/alerts/mark-read` | Mark all matches read. |
| `DELETE /api/marketplace/alerts/:id` | Dismiss one match. |
| `GET /api/marketplace/alerts/unread-count` | Unread-match badge count. |

Alert matching runs synchronously right after a listing is created: it walks every saved search and creates a match where the *kind* is the same, the *category* matches (if set), the *price* is within the search's max (if set) and the *keyword* appears in the title/vendor/model. It never alerts you to your own listing.

*Partners, moderation, dashboard, payments*

| Method & path | What it does |
|---|---|
| `GET/POST/DELETE /api/marketplace/partner-accounts[/:platform]` | Connect/list/disconnect eBay, Amazon (OAuth) and Discord (webhook). |
| `POST /api/marketplace/partner-accounts/discord/test` | Send a test message to the connected Discord webhook. |
| `POST /api/marketplace/listings/:id/flag` | Report a listing (reason; one report per user per listing). |
| `POST /api/marketplace/listings/:id/moderate` | Admin: hide (close) or restore a listing. |
| `GET /api/marketplace/dashboard` | Seller stats: listing counts, sales (revenue/orders/pending), purchases (spent/orders), 10 recent listings. |
| `GET /api/marketplace/stripe/status` | Whether Stripe is configured on this server. |
| `POST /api/marketplace/stripe/webhook` | Stripe posts `checkout.session.completed` here; the matching order flips *pending → paid*. |
| `GET .../partner-accounts/{ebay,amazon}/status \| auth-url \| callback` | OAuth status, consent URL, and token-exchange callback for eBay/Amazon. |

A passive **auto-expire** job runs on marketplace requests (debounced to once an hour) and closes any active listing older than 90 days. When a listing is created, a **Discord notification** (a rich embed) is sent, fire-and-forget, to every connected webhook.

## 7. Edge cases and limits

- **Admins and Owners only.** No other role can open the Marketplace; the redirect and the server guard both enforce it. A signed-out user hitting a marketplace URL is sent to log in first.
- **You can't buy your own listing**, and you can't buy one that has no price (you're pointed to contact the seller) or one that isn't active.
- **A listing with orders can't be deleted.** The delete is refused (409) so order history is preserved; mark it *sold* or *closed* instead.
- **Buying the last of the stock** flips the listing to *sold*; a partial buy just lowers the quantity.
- **Cancelling** is only possible while an order is *pending* or *paid* — once *shipped*, it can only be *completed*.
- **Only the seller** can mark an order shipped or set its tracking.
- **Saved searches cap at 20** per user; the alerts list shows the **50** most recent matches.
- **Uploads** must be an image (jpg/png/webp/heic/heif) of **8 MB or less**; anything else is rejected with a clear message.
- **Descriptions** are capped at 2,000 characters, order **messages** at 2,000, and the **title** at 140.
- **Listings auto-expire after 90 days** of being active.
- **A report is one-per-person-per-listing** — you can't file the same flag twice.

## 8. Real vs synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Listings, orders, messages, alerts | **Real** — all posted by real users; there is no seeded demo catalog. |
| Uploaded photos | **Real** — stored on the server and served back with the listing. |
| Seller dashboard numbers | **Real** — computed live from your listings and orders. |
| Partner **search** links (eBay/Amazon/FS.com/Curvature) | **Outbound only** — pre-filled searches on third-party sites; nothing is created there and RackTrack takes no cut. |
| Stripe checkout, eBay/Amazon OAuth | **Real flows, but off unless configured.** These are gated behind server credentials; without them, checkout falls back to recording the order for offline payment and the eBay/Amazon cards show "not configured". |
| Discord notifications | **Real and working** — they just need a webhook URL saved on the Partner accounts page. |
| Category and condition labels | Static lookups — the only hardcoded text on the screen. |

## 9. Common questions

**Q: Who is allowed to use the Marketplace?**
Only members whose role is **Organization Admin** or **Owner**. Any other member who opens a marketplace link is redirected to the home screen, and the server rejects the request as well. This is stricter than most RackTrack features.

**Q: Do I need to be signed in just to look around?**
Yes. Unlike a public shop, browsing here requires an admin/owner login — a signed-out visitor is sent to the login page first.

**Q: What's the difference between "For sale" and "Wanted"?**
"For sale" is gear you're offering; "Wanted" is a request describing something you need so sellers can find you and reach out. Only priced, active for-sale listings can be bought directly.

**Q: How do I sell a device I just scanned?**
Use the **Sell** action from a scan result. It opens the new-listing form pre-filled with the device's vendor, model, category and rack ID — the listing is then "scan-backed", which buyers can see.

**Q: What is the 3% fee?**
A flat platform fee added to the subtotal at checkout. The order summary shows the unit price, quantity, subtotal, the 3% fee and the total before you confirm.

**Q: Do I have to pay through the app?**
Only if this RackTrack server has Stripe configured — then you're redirected to Stripe to pay. If it isn't, the order is simply recorded and you arrange payment offline with the seller; the seller is told to ship once payment is confirmed.

**Q: I left the price blank — can people still buy it?**
No. A listing with no price reads "Make an offer" and has no Buy button; interested buyers are pointed to contact you directly.

**Q: How do the buyer and seller talk to each other?**
Every order carries a private message thread on the order page. It refreshes every 30 seconds, and either side can post (up to 2,000 characters a message).

**Q: What do the order statuses mean?**
*Pending* (awaiting payment), *Paid* (ready to ship), *Shipped* (on its way, with tracking), *Completed* (closed out by either party), *Cancelled* (stopped while still pending or paid).

**Q: I can't delete a listing — why?**
Because it already has one or more orders. To keep that history intact, deletion is blocked; mark the listing **sold** or **closed** instead.

**Q: How do alerts find things for me?**
Save a search — a label plus any of keyword, category, for-sale/wanted and a max price. Every new listing that matches all of your set filters drops into your **Matches** list, usually within minutes. You won't get alerted about your own listings, and you can keep up to 20 saved searches.

**Q: Are the eBay, Amazon and FS.com links real listings on those sites?**
No. They're just pre-filled searches that open in a new tab. RackTrack doesn't post anything on those sites through them and takes no cut — they're a convenience for looking further afield.

**Q: What are Partner accounts for?**
Connecting your own eBay or Amazon seller account (over OAuth, where the server has API keys) or a Discord channel (via webhook, which announces new listings). Discord works out of the box once you paste a webhook URL and can be tested with one button.
