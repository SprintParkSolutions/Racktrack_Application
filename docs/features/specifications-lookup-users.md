# Specifications Lookup

**Feature Reference** · *Type a make and model, and RackTrack fetches the device's real datasheet specs for you — no scan, no PDF hunting.*

**Category:** Reference tool — works without a scan · **Audience:** Anyone sizing, comparing or buying hardware · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

You want the specs for a piece of network gear — how many ports, how much throughput, what layer it switches at, its power draw, whether it does PoE, how many uplinks. Normally you'd open a browser, guess the vendor's website, dig through their product pages, find the right PDF datasheet, and scroll until you hit the spec table. Specifications Lookup does all of that for you.

Type the **make** and the **model**, press one button, and RackTrack goes out to the manufacturer's own product page, reads the datasheet table there, and hands the numbers straight back to you. You get a short **highlights** block with the figures an engineer usually reaches for first, and — one tap away — the **full spec table** with everything the page listed. It also gives you the link to the original product page, so you can always check the source yourself.

The important promise: **nothing here is made up**. If RackTrack can't read a clean spec table off the page, it tells you so plainly and gives you the link, rather than filling the screen with invented numbers. And you don't need to have scanned anything — this tool stands on its own, useful the moment you know a vendor and model name.

## 2. At a glance

| | |
|---|---|
| **Category** | Reference tool — looks up datasheet specs without a scan. |
| **Who uses it** | Anyone sizing, comparing or ordering hardware. |
| **Where input comes from** | You type a make (with type-ahead suggestions) and a model. |
| **What it outputs** | A summary card, a highlights block, the full spec table, and a link to the product page. |
| **Data source** | REAL / LIVE — read from the vendor's own product page; nothing is filler. |

## 3. How it works — step by step

```
Enter make + model         →   type-ahead helps you get the vendor right
        ↓
Look up                    →   RackTrack finds the manufacturer's product page
        ↓
Extract specs              →   the datasheet table on that page is read out
        ↓
Highlights + full table    →   the key figures up top, everything else one tap away
        ↓
Product-page link          →   the original source, always shown so you can verify
```

**Walkthrough**

1. Open Specifications Lookup. In the **make** field, start typing the vendor — up to six live suggestions appear beneath as you type. Click one to fill it in.
2. In the **model** field, type the model name or number. This is free text and it's required — RackTrack needs both the make and the model to find the right page.
3. Press **Get specifications**. While it works, the button reads *"Searching…"* so you know it's live and hasn't stalled.
4. Read the **highlights** block first — the four or five specs most people need to make a decision, pulled to the top.
5. If you want everything, toggle **Show all specs** to open the complete table. Toggle it again to collapse it.
6. Open the **product-page link** any time to see the manufacturer's original page and confirm anything for yourself.

## 4. Where the input comes from

- **The make (vendor)** — you type it, and a live vendor list offers matching suggestions as you go, so you don't have to remember the exact spelling or brand name.
- **The model** — free text that you type; it's required alongside the make. Between them, these two fields are all RackTrack needs to find the right datasheet.
- **Optional context from elsewhere** — if you arrived here from another screen that already knew the device's type (say, a switch), that hint is used only to tune the wording of the intro. It never changes which specs are pulled or where they come from.

## 5. What it produces (output)

- **A summary card** — confirms the vendor and model RackTrack resolved, and tells you how many specs it managed to pull from the page.
- **A highlights block** — four or five of the most decision-relevant specs, surfaced so you don't have to scan a long table to find them.
- **The full spec table** — every name-and-value pair the datasheet listed, shown in full when you ask for it.
- **A product-page link** — a direct link to the manufacturer's own page, so the source of every number is one click away.

## 6. What you see on screen

- **Vendor type-ahead** — a short list of up to six matching vendors appears as you type the make; click one to fill the field.
- **The summary card** — a plain-language line such as *"We pulled N specs from the vendor's product page…"*, naming the device and the count.
- **The highlights** — the figures engineers reach for first: Ports, Throughput, Layer, Form factor, Power, PoE, Uplinks, MAC table, Stacking (whichever the page provides).
- **The full-table toggle** — a control that reads *"Show all specs (N)"* to expand and *"Hide all specs"* to collapse, so the long detail is there when wanted and out of the way when not.
- **Honest errors** — if the page can't be read cleanly, a clear *"couldn't extract"* message with a link to the page, never a screen of placeholder numbers.

## 7. The logic behind it

- **Highlights first.** Most of the time you want a handful of figures, not the whole datasheet. Simple keyword rules pick out the four or five specs an engineer usually needs and put them up top; the complete table stays one tap away for when you need the rest.
- **No fabrication, ever.** RackTrack only shows what it actually read off the vendor's page. If the page can't be parsed into a clean spec table, the screen says so and links you to the page — it will never invent a spec to fill a gap.
- **The source is always in reach.** Because every result carries a link back to the original product page, you can verify any number yourself, which is exactly what you'd want before ordering.

## 8. Detailed technical explanation

**Finding the page.** When you press the button, RackTrack does a live web lookup for the make and model you entered and locates the manufacturer's own product page for that device — the authoritative source for its specifications.

**Reading the specs.** On that page, the specification table is read and broken down into simple name-and-value pairs — "Ports: 48", "Throughput: 176 Gbps", and so on. Those pairs become the full table you can open, and a small set of keyword rules lifts the most useful ones into the highlights.

**When it can't read the page.** If the page has no clean spec table, or it can't be parsed, RackTrack returns an explicit "couldn't extract" state together with the link to the page. It deliberately does not present invented data as if it were real — an honest gap with a link is treated as the correct answer, not a failure to paper over.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The specifications in the highlights and full table | **REAL / LIVE** — read from the vendor's own product page. |
| The vendor suggestions in the type-ahead | **REAL / LIVE** — drawn from a live vendor list. |
| Missing or unreadable data | Surfaced honestly with a link — **never** filled in with placeholder specs. |

## 10. Use cases

- **Sizing an uplink.** Check a model's throughput and uplink options before you commit to buying it, without leaving RackTrack to hunt for a datasheet.
- **Comparing two switches.** Pull the specs for each in turn and compare the figures that matter — PoE budget, MAC-table size, port count — side by side from the same clean source.
- **Settling a spec question fast.** When someone asks "does that model do Layer 3?" or "how much PoE does it have?", type the make and model and read the answer off the manufacturer's own page in seconds.

---

— Specifications Lookup —
