# SFP Procurement Advisor

**Feature Reference** · *For an identified switch, the right optics and cables to buy — priced, pictured, and sized to its open SFP ports.*

**Category:** Reference tool, built into Switch Information · **Audience:** Technicians and buyers ordering optics · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

A switch has empty SFP cages, and you need to fill them — but with *what*? Optics are fussy: the module has to match the switch's slot type and speed, it has to be compatible with that vendor's gear, and you need enough of them to fill every open port. Getting it wrong means a module that won't seat, won't link, or won't be recognised.

The SFP Procurement Advisor does the matching for you. Starting from a switch RackTrack has already identified, it works out the slot type, searches for **compatible transceiver modules** you can actually buy, and lays out a clear shopping list: a **top pick**, a few **alternatives**, and — where they fit — **plug-and-play DAC/AOC cables** that need no separate transceiver at all. Each option comes with a price, a real product photo, and a link to buy it.

Best of all, it does the arithmetic. It knows how many SFP ports on that switch are open, so it shows you the **total** cost to fill them, not just the price of one module. You don't fill in a form — the advisor runs on its own from the switch you're already looking at. One honest caveat: some of what you see can come from a built-in backup list rather than a live search, so treat prices as a guide and confirm at the vendor before you order (see section 9).

## 2. At a glance

| | |
|---|---|
| **Category** | Reference tool, embedded in the Switch Information view. |
| **Who uses it** | Technicians and buyers ordering optics for a switch. |
| **Where input comes from** | The selected switch's vendor and model, and its number of open SFP ports. |
| **What it outputs** | A top pick, alternatives, and cable options — each with a price, an image, and a buy link — plus a total. |
| **Data source** | MIXED — live product results, with a curated backup list used only when the live search comes up empty. |

## 3. How it works — step by step

```
Read the switch's identity   →   vendor, model, and SFP slot type
        ↓
Look up modules              →   a live product search for compatible optics
        ↓
Fall back if empty           →   a built-in catalog fills the gap if nothing is found
        ↓
Recommend + price            →   top pick, alternatives, cables, and totals
```

**Walkthrough**

1. Open the Switch Information view for a switch RackTrack has identified. The advisor **runs automatically** from that switch's vendor and model — there's no form to fill in.
2. Behind the scenes it reads the switch's SFP slot type and speed, then runs a live product search for transceiver modules that match.
3. If the live search finds usable modules, they're used. If it finds nothing usable, a **built-in fallback catalog** is shown instead so you're never left empty-handed.
4. From the results it picks a **top pick** and lists a few **alternatives**, plus any **plug-and-play cables** that suit short runs.
5. It computes the **total** for the actual number of open SFP ports on that switch, so you can see the full cost to fill every cage. Follow a **buy link** to order.

## 4. Where the input comes from

- **The switch's vendor and model** — taken from the scan that identified the switch. If the switch's identity was unknown, a secondary lookup can recover the vendor and model so the advisor still has something to work from.
- **The number of open SFP ports** — read from the switch, and used to size the total cost so the figure reflects filling every empty cage, not just buying one module.
- **Live product listings** — real module data gathered from the web: the part, its price, a product image, the source it came from, and a datasheet link.
- **The fallback catalog** — a built-in list of modules, used only when the live search returns nothing usable.

## 5. What it produces (output)

- **A top-pick module** — its part number, a set of spec chips, the unit price and the computed total, a product image, and a buy link.
- **Alternatives** — a few more compatible modules, each with its own price, for when you want a choice.
- **Plug-and-play cables** — DAC/AOC options with their distance rating and price, for links where a full transceiver isn't needed.
- **A datasheet and source note** — provenance for the recommendation, so you can see where it came from and check the spec.

## 6. What you see on screen

- **A slot summary** — the form factor of the switch's cages (for example, SFP+) and their maximum speed.
- **A hero "TOP PICK" card** — the recommended module's brand, part number, spec chips, its unit price, and the total computed for the open ports.
- **An expandable "N more compatible modules"** — a collapsible list of alternatives you can open when you want to compare.
- **A plug-and-play cables grid** — the "no transceiver needed" cable options, grouped together.
- **A footer** — a datasheet link and a small note reading something like "N modules · M sources", so you can see the breadth behind the recommendation.
- **An empty state** — if even the fallback has nothing, a search link so you can go looking directly, rather than a blank screen.

## 7. The logic behind it

- **Sized to reality.** The total isn't the price of one module — it's computed for the actual number of open SFP ports on *that* switch, so the number you see is the real cost to fill every cage.
- **Buy links you can trust.** If a buy link points somewhere wrong — for instance, at a switch's own page instead of the module's — it's rewritten to the vendor's home page, and links from unreliable reseller domains are dropped. The aim is that following a link takes you somewhere sensible.
- **Real images only.** If a product has no genuine photo, the card simply shows no image rather than inventing a placeholder graphic — so a picture on screen is always a real one.

## 8. Detailed technical explanation

**The primary lookup.** When you open a switch, the advisor runs a live search of real product listings for that vendor and model. It reads back the modules on offer, their prices, their images, the sources they came from, and a datasheet link — the raw material for the recommendation.

**Recovering an unknown switch.** If the switch's vendor and model weren't captured in the scan, a second live pass tries to recover them, so the advisor can still find matching optics rather than giving up.

**The fallback.** When the live search turns up nothing usable, a built-in catalog is shown in its place so you always have a starting point. If the service can't be reached at all, the advisor returns an essentially empty result rather than inventing picks — an honest blank is preferred over a fabricated recommendation.

**Sizing.** Throughout, the totals are the unit price multiplied by the number of open SFP ports on the switch, so the cost shown reflects filling the actual gaps in front of you.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The live module recommendations | **REAL / LIVE** — gathered from real product listings. |
| The fallback catalog | **SYNTHETIC / CURATED** — a built-in list, used only when the live search is empty. |
| Product images | **REAL** — only genuine product photos are shown; a missing one shows nothing. |
| The totals | Computed — unit price × the number of open SFP ports. |

> **Important.** The fallback catalog is a hand-verified list (built mainly around one vendor's optics) and it can go stale if that manufacturer changes its pages. The screen does not visibly mark a fallback result as different from a live one — so treat every price here as *indicative*, and confirm it at the vendor's own page before you place an order.

## 10. Use cases

- **Ordering optics for a new switch.** The advisor lists compatible modules and tells you the total to fill every open cage, so you can raise an accurate order in one pass.
- **Choosing a short-run link.** For an in-rack or adjacent-rack connection, the plug-and-play DAC/AOC cable options save you buying and seating separate transceivers.
- **Sanity-checking a quote.** Compare the top pick and its alternatives against what a supplier has quoted, using the datasheet and source note to see exactly what's being recommended.

---

— SFP Procurement Advisor —
