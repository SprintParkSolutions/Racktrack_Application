# Marketplace

**Feature Reference** · *Buy, sell or swap surplus networking and datacenter gear — built right into RackTrack.*

**Category:** Marketplace — buy / sell / swap hardware · **Audience:** Everyone (browse openly; sign in to post) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

---

## On this page

1. In simple terms
2. At a glance
3. How it works — step by step
4. Where the input comes from
5. What it produces (output)
6. What you see on screen
7. The logic behind it
8. Detailed technical explanation
9. Real data vs. synthetic
10. Use cases

---

## 1. In simple terms

Racks turn over. You decommission a switch, a spare PDU comes off a project, someone needs a transceiver *today*. The Marketplace is a place inside RackTrack to move that gear: list your **surplus hardware for sale**, post a **"wanted" ad** for something you need, or jump straight out to a **partner marketplace** with your search already filled in.

Anyone can **browse** — no account needed to look around, filter, and open a listing. To **post** a listing, or to manage the ones you've posted, you sign in. Everything you see for sale is **real, posted by real users**; there's no demo catalog padding it out. And because it lives inside RackTrack, a listing can be **backed by a scan** — created straight from a device RackTrack detected — so a buyer can see it came from an actual, identified piece of kit rather than a typed-in description.

If what you're after isn't listed here, the **partner search** hands you off to eBay, Amazon, FS.com or Curvature with your query pre-filled. RackTrack takes no cut of those and creates nothing on the other site — it's simply a fast door out to where the part might be.

## 2. At a glance

| | |
|---|---|
| **Category** | Marketplace — buy, sell or swap surplus gear, built into RackTrack. |
| **Who uses it** | Everyone can browse; signed-in users post and manage their own listings. |
| **Where input comes from** | Users posting listings — optionally pre-filled from a scan. |
| **What it outputs** | Browsable public listings, a personal "my listings" view, and outbound partner searches. |
| **Data source** | REAL — user-posted listings; there is no seeded demo catalog. |

## 3. How it works — step by step

```
Browse or search       →   filter by keyword, category, and for-sale / wanted
        ↓
Open a listing         →   full detail, with images and the seller
        ↓
Sell something         →   publish a listing (sign-in required)
        ↓
Partner search         →   jump out to eBay / Amazon / FS.com / Curvature, pre-filled
```

**Walkthrough**

1. **Browse** the public listings. Narrow them with filters — by keyword, by category, and by whether they're **for sale** or **wanted**.
2. **Open a listing card** to see its full detail: the large image, the description, the seller, and — if it came from a scan — its "from scan" backing.
3. To sell, **sign in** and press **Sell something** to publish a listing. If you started from a scan result, the form can arrive **pre-filled** with that device's details.
4. **Manage your own listings** from your personal view: mark one **sold**, **reactivate** it, or **delete** it. These actions apply only to listings you posted.
5. Use the **partner search bar** to hand your query off to eBay, Amazon, FS.com or Curvature when you'd rather look on an outside marketplace.

## 4. Where the input comes from

- **Listing fields** — everything you type when you post: a title, a category, the condition, an optional vendor and model, a price, a quantity, a location, a photo, and a description.
- **Scan pre-fill (optional)** — if you post from a scan result, the vendor, model, category and rack ID come across from that scan to fill the form for you.
- **Browse filters** — the keyword, category, and for-sale/wanted choices you set while browsing.
- **Partner query** — the text you hand off to a third-party search.

## 5. What it produces (output)

- **Public listings** — everything posted for sale or wanted, browsable by anyone.
- **Your listings** — all of your own posts in every status, managed by you.
- **A published listing** — tied to your account, and optionally scan-backed so it carries proof of the real device behind it.
- **Partner searches** — outbound, pre-filled links to third-party marketplaces. No listing is created on those sites.

## 6. What you see on screen

- **Listing cards** — each shows an image, the category and condition, the title, the vendor/model, the price, how old the listing is, and the seller.
- **A detail view** — opening a card gives you a large image, the full description, the seller, any "from scan" backing, and — if it's yours — the owner actions.
- **A create form** — a toggle for the kind of post (for sale or wanted), category and condition choices, and a photo upload with a preview before you publish.
- **Partner links** — an outbound search bar; following it runs your query on the partner's own site. RackTrack takes no cut and creates no listing.

## 7. The logic behind it

- **Open to browse, signed-in to post.** Anyone can look around without an account. Posting a listing, and any owner action — marking sold, reactivating, deleting — needs you signed in, and only ever touches your own listings.
- **Scan-backed listings carry proof.** When you create a listing from a scan, it keeps that backing, so a buyer can see the item came from a real, RackTrack-identified device rather than just a description someone typed.
- **Partners are a hand-off, not a middleman.** The partner search only pre-fills a query and sends you out. Nothing is listed on the other site, RackTrack takes no cut, and no data leaves beyond the search text itself.

## 8. Detailed technical explanation

**Listings are live records.** Each listing is a real, live record tied to the account that posted it. When you add a photo, it's uploaded to storage and attached to the listing, so the image travels with it wherever it's shown.

**Filters you can share.** The filters you set while browsing are reflected in the page's address, so a filtered view — say, "switches, for sale" — can be bookmarked or sent to a colleague and it opens showing the same set.

**Partners are outbound only.** The partner integrations are nothing more than pre-filled search links. No listing is created on the third-party site, and nothing is exchanged with it beyond the query text you handed over — RackTrack neither posts on your behalf nor takes a cut.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The listings — both public and your own | **REAL** — posted by users; there is no demo seed data. |
| Uploaded photos | **REAL** — posted to storage along with the listing. |
| Partner searches | Outbound — live third-party search links only; nothing is created there. |
| Category and condition labels | Static lookups — the only hardcoded content on the screen. |

## 10. Use cases

- **Offloading surplus.** A "Sell this" action on a scan result pre-fills a listing for the exact device you scanned, so putting a decommissioned unit up for sale takes seconds and comes with real backing.
- **Sourcing a part.** Post a "wanted" ad for the piece you need, or use the partner search to find a replacement transceiver quickly on an outside marketplace.
- **Clearing a decommissioned rack.** After scanning gear that's coming out of service, list the pieces worth reselling one by one — each already documented by the scan behind it.

---

— Marketplace —
