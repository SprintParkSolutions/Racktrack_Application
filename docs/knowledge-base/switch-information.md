# Switch Information — Specs, Firmware & SFP Advisor

*Everything RackTrack can tell you about a switch it saw in a rack photo — who the switch is, its datasheet specs, whether its firmware is current, and which optics fit it — gathered into one card that is driven by what the camera actually read, never by a login.*

Feature · All users · Last verified: 26 July 2026 against the live code.

---

## 1. In simple terms

When you scan a rack, RackTrack looks closely at each device's faceplate and reads the text printed there — the maker's name, the model number, and the firmware version. **Switch Information** takes that reading and does the legwork you would otherwise do by hand: it looks up the switch's datasheet, checks whether the firmware you are running is the newest the vendor ships, and works out which SFP modules (the little plug-in optics) fit that exact switch.

Everything lives in a single card per switch. If the scan found several switches, a row of tabs across the top lets you flip between them; on a wide screen those tabs become a rail down the side and the details fill the rest of the width. The card's header tells you who the switch is — maker and model, its rack position, and its network address when that was read — and offers a link straight to the vendor's own login portal or support site.

Inside the card there are three tabs. **Specifications** pulls the datasheet spec table. **Firmware** tells you whether you are up to date and what the latest version is. **SFP Advisor** recommends the transceivers and cables to buy for that switch.

Two things are worth holding onto. First, this whole screen is built from the **photo**, not from logging into the device and not from your asset database (CMDB). It is the honest "what is physically in front of me" view. Second, when a label was blurry and RackTrack could not read something, it does **not** guess. It shows a plain "not detected" state and lets you type the maker, model, or version in yourself. Once you do, every lookup runs from what you typed, and your entry sticks to that switch even if you scan the rack again later.

## 2. At a glance

| | |
|---|---|
| **What it is** | A per-switch reference card: scanned identity plus live datasheet, firmware, and optics lookups. |
| **Who it is for** | Everyone — no networking background needed to read it. |
| **What feeds it** | The rack photo. RackTrack reads each switch's faceplate; you can fill in anything it could not read. |
| **The three tabs** | Specifications (datasheet), Firmware (currency check), SFP Advisor (optics to buy). |
| **Where the lookups go** | The vendor's own website — spec pages and firmware pages — fetched on demand, cached per rack. |
| **Scope** | Devices the scan classed as **switches** only. Routers and other classes are deliberately excluded. |
| **Data honesty** | Nothing is invented. Gaps are shown as "not detected" with an editor; the SFP tab has one curated backup list (see §8). |
| **What it is not** | Not a live device login, not a CMDB view, not a security or end-of-life scan. |

## 3. How it works — step by step

```
Scan a rack            →  RackTrack reads each switch's faceplate (maker / model / firmware)
        ↓
Pick a switch          →  a tab per switch when several were found (a side rail on wide screens)
        ↓
Check the identity     →  maker, model, position, and a vendor link in the header
                          (type it in yourself if the photo could not be read)
        ↓
Specifications tab     →  the datasheet spec table, looked up live from the vendor
        ↓
Firmware tab           →  your version vs. the latest the vendor ships, with a verdict
        ↓
SFP Advisor tab        →  compatible transceiver modules and plug-and-play cables to buy
```

**Walkthrough**

1. **Scan the rack.** The faceplate read runs per device — a close-up text pass on each detected switch's chassis crop — and records the maker, model, and firmware version it could make out.
2. **Open Switch Information.** You see one card per detected switch. If several were found, pick one from the tab strip (each tab is labelled by rack position, then model, then a plain number).
3. **Read the header.** It shows the combined maker-and-model title, the rack position, the network address when it was read, and a link out to the vendor — a curated **login portal** when RackTrack has one for that maker, otherwise a general **vendor site** link.
4. **Fill any gaps.** If the maker, model, or firmware version was not read, an **Identification** editor appears so you can type it in. This is the honest "not detected" path — there is no guessing.
5. **Open Specifications** for the live datasheet table, with a link out to the full product page.
6. **Open Firmware** for the up-to-date / upgrade verdict, your current version next to the latest, and a link to the vendor's page.
7. **Open SFP Advisor** for the compatible optics and cables for that switch.

## 4. What you see on screen

### The switch selector

When the scan found more than one switch, a set of tabs appears. On a narrow phone these stack; on a wide desktop the layout becomes a **master–detail** view — a rail of switch cards on the left, the selected switch's full details on the right, filling the width. Each rail card shows "Switch 1", "Switch 2"… a big label (the rack position such as `U09`, or the model), and the model underneath. A single-switch rack skips the selector and shows the details straight away.

### The switch card header

- A small switch icon, then the **title**: maker plus model (for example *MikroTik CRS328-24P-4S+RM*). When only one of the two was read, you see just that one; when neither was read, the title reads **"Unidentified device."**
- A subline with the **rack position** (highlighted), the **network address** when it is known, and a **vendor link** pill — labelled *Login portal* when RackTrack has a curated sign-in URL for that maker, or *Vendor site* when it only has a general support page. The link opens in a new tab.

### The fields grid

A thin row of tiles directly under the header, each shown only when there is something to show:

- **Firmware** — always present; shows the version, or an em-dash "—" when none is known. A version you typed yourself is tagged "· entered."
- **Serial**, **MAC**, **IP** — shown only when populated. Because this screen is built from the photo, these are usually blank for a scanned switch (the faceplate read captures maker, model, and firmware, not serial or addresses).

### The three in-card tabs

A tab strip inside the expanded card, in this order (Specifications is open by default):

**1) Specifications.** A header reading "Hardware" with a **"View full details ↗"** link to the vendor's product page when one is known. Below it, one of:
- *Looking up specs…* while it fetches;
- *Add vendor and model to see specs.* when the switch is not identified;
- *Couldn't load specs.* on an error;
- or the **spec table** — a clean two-column list of every field the datasheet gave (ports, switching capacity, PoE budget, layer, and so on).

**2) Firmware.** A header reading "Firmware" with a status pill carrying the verdict. Below it, depending on the situation:
- *Checking for updates…* while it works;
- an **Enter-version editor** when there is a model but no firmware version yet (placeholder like `1.0.6 Build 20210323`);
- *Add a model to check for updates.* when there is no model;
- *Couldn't check for updates right now.* on an error;
- or the **result**: a **Current** tile and a **Latest** tile side by side, plus a link to the vendor's page. When RackTrack could not confirm a latest version, the "Latest" tile becomes a **"Check site ↗"** link to the vendor's official download page, and a short line underneath explains why.

The verdict pill reads:
- **"Up to date"** — your version matches the latest the vendor ships;
- **"Upgrade available"** — a newer version exists;
- **"Check vendor portal"** — the vendor's page is reachable but the latest could not be confirmed automatically (often a login or bot wall); the pill points you at that page;
- **"Latest version unknown"** — nothing could be confirmed and there is no page to hand you.

**3) SFP Advisor.** An embedded advisor (marked with an *"AI"* badge) that recommends optics for the switch. You may see:
- a prompt to *Add the switch make and model* if the switch is not identified;
- **"No SFP required"** when the switch is copper-only (RJ45), with no fibre cages to fill;
- otherwise a **slot summary** (form factor and speed), a hero **"★ TOP PICK"** module card (brand, part number, spec chips, unit price, product image, and a **Buy** link), an expandable **"N more compatible modules"** list, and a **"Plug-and-play cables"** grid of DAC/AOC options that need no separate transceiver. A footer shows a datasheet link and a "N modules · M sources" note.

### Identification states

The **Identification** block appears whenever the photo did not pin down a full maker **and** model, or whenever you have entered one yourself:

- **Not detected** — neither maker nor model was read. You get a *"Not detected"* chip, an **"Enter make / model"** button, and the line *"We couldn't identify this device from the rack photo."*
- **Partly detected** — one field was read and the other was not. You get a *"Model not detected"* or *"Vendor not detected"* chip, an **"Add model"** / **"Add vendor"** button, and a line explaining that specs and firmware checks need both.
- **Manual entry** — you have typed a maker or model yourself. You get a *"Manual entry"* chip and an **"Edit"** button so you can adjust it.

The editor has a **Make / Vendor** field and a **Model** field; **Save** is enabled once both are filled, with **Cancel** and (when you already have an entry) **Clear**.

## 5. The logic behind it

- **It trusts the photo, not a login and not the CMDB.** This is the "what is physically in front of me" view. RackTrack reads the switch from the picture and looks facts up on the web; it does **not** SSH into the device, and it deliberately does **not** pull anything from your asset database here. (Reading a live switch's ports over SSH is a separate part of the product.)
- **Switches only.** Only devices the scan classified as switches appear. Routers are a different device class and are kept out on purpose, so a router never shows up mislabelled as a switch.
- **How the maker and model are derived.** After the scan, the faceplate text for each device carries a maker, a model, and a firmware version where they could be read. RackTrack then cleans that up on the way in:
  - it re-extracts a model number straight from the raw scanned text with per-vendor patterns (Cisco, TP-Link, D-Link, Juniper, Aruba, Arista, MikroTik), which often recovers a model the first pass mangled;
  - it **expands known partial fragments** to full model numbers using a small built-in map (for example a bare `CRS326` becomes `CRS326-24G-2S+RM`, `C9300` becomes `C9300-24T`, `TL-SG2428` becomes `TL-SG2428P`);
  - it trims trailing version noise off the model and pulls a tidy dotted version string out of messy firmware text.
- **When manual entry is needed — and what it does.** Manual entry fills what the scan **could not read**. If the photo gave a maker but no model, you add the model; if it gave neither, you add both; if it read no firmware version, you can type that too. When the scan **did** read a field, that reading is what drives the lookups (and garbled models are auto-corrected server-side for the specs lookup — see §6). Your entries are saved against a **stable key** for that switch — its serial number if known, otherwise its hardware address, otherwise its rack position — chosen precisely so the entry survives another scan that returns slightly different text. They persist on the device between visits.
- **It remembers the lookups per rack.** Scan Results pre-fetches the spec lookup for every unique maker-and-model pair it saw, so opening a switch usually renders instantly from cache instead of fetching again.
- **It is honest about gaps.** A field the scan could not read is shown as an explicit empty state with an editor — never a made-up value. The firmware and SFP tabs behave the same way: a real link or an honest "couldn't confirm," never a fabricated answer.

## 6. Under the hood

*(Plain-English summary above; this section is the accurate technical detail.)*

### The OCR source that feeds the card

The Switches tab is driven entirely by an **OCR devices** file, not by CMDB. The client requests `GET /api/scan/:rackId/ocr-devices`, which returns the cached `outputs/<rackId>/ocr_devices.json`. That file is produced by the `pipeline.ocr_devices` module — a per-device EasyOCR pass over each detected device's chassis crop that parses maker, model, and firmware. (A device's OCR `source` is `ocr_full` when both maker and model were read, or `ocr_make_only` when only the maker came through.) The client keeps only entries whose class is `switch`, so routers and other classes never appear. Each switch is marked as photo-derived; the maker/model cleanup described in §5 (`extractModelFromRaw`, `expandPartialModel`, `cleanModel`, `cleanVersion`) runs on the client as the list is built. CMDB is explicitly excluded from this screen.

### `POST /api/specs` — the datasheet lookup

Body: `{ vendor, model, fromOcr }`. This is served by the **Switch Spec Agent** (a standalone tool at `Agent/Agent_scrap`): a SQLite cache that answers known models in about a millisecond, with a free multi-engine web fetch-and-extract fallback (a few seconds) for models it has not seen. There is **no LLM and no API key** involved. The response follows a stable contract: `{ ok, vendor, model, productUrl, imageUrl, specs, source }`, returned with HTTP 200 on a hit and 404 on a miss (the per-call budget is 60 seconds).

When `fromOcr` is true, the server runs a **two-stage OCR-correction** pass before answering: a database-only probe first; if that misses, it takes the closest suggestion (a model-similarity score of 0.5 or better) and retries; failing that, it falls through to a live web lookup of the original query. This is what turns a garbled read like `C9300-46P` into the real `C9300-48P`. When the model was **manually entered** (i.e. you confirmed it), the client sends `fromOcr: false` so the server trusts the input and skips the extra correction pass.

### `POST /api/firmware` — the currency check

Body: `{ vendor, model, currentVersion }`. Served by a vendored `firmware_lookup` package that reads the vendor's **own** site for the latest official firmware and **never fabricates a version**. Each vendor has its own dedicated lookup tuned to that site's layout. The response maps to `{ ok, vendor, model, currentVersion, latestVersion, upToDate, releaseNotesUrl, portalUrl, authRequired, statusValue, message, confidence, changelog }`, with a 90-second budget; it returns HTTP 200 whenever the lookup ran (including auth-required or "cannot determine" cases, each of which carries a portal link) and only 502 on a genuine runner failure. `upToDate` is a real version-aware comparison (`true`/`false`), or `null` when the latest could not be confirmed. **`changelog` is always empty by design** — the package deliberately does not scrape release-note bodies (accuracy over coverage); instead it links you to the vendor's own page. Two honest caveats worth knowing: OCR auto-correction is **not** applied to firmware (the endpoint ignores any `fromOcr` hint the client sends), and the "Check site ↗" download links shown when the latest is unknown come from a small vendor→download-page map in the client (MikroTik, Cisco, Juniper, Arista, HPE, Aruba, Dell, Fortinet, Extreme, NETGEAR, TP-Link, D-Link, Ubiquiti, Huawei, Ruijie, Zyxel).

### `POST /api/sfp/analyze` — the optics advisor

Body: `{ vendor, model, interfaces }`. Both a maker and a model are required — without them the server returns a `need_make_model` status and nothing to buy. Otherwise it runs `pipeline.sfp_recommend`, which determines the switch's SFP slot type by scraping vendor datasheets and then searches the web for compatible transceiver modules. There is no hard-coded switch database; the slot type and modules are inferred from live data. In the card, the SFP Advisor is given only the rack ID plus the switch's maker and model — **not** an open-port count — so it recommends modules and cables with per-unit prices (see the sizing note in §7). If the maker/model arrived as "Unknown," the advisor makes a second attempt to recover them from the OCR devices file before giving up. Results from a small block-list of unreliable reseller domains are dropped, and when the live search returns nothing usable the advisor falls back to a **curated catalog** (MikroTik optics, hand-verified against the manufacturer's pages) so you are never left empty-handed.

### The vendor links

The header's *Login portal* / *Vendor site* link comes from a curated map generated from an internal `login-info.xlsx`: an exact/alias/substring match yields a real per-vendor sign-in URL, and a smaller fallback map supplies a general support page for makers not in the curated list.

## 7. Edge cases & limits

- **Unidentified device.** If the photo yielded neither maker nor model, the card title reads "Unidentified device," the Identification block shows "Not detected," and the Specifications and Firmware tabs stay in a "add vendor and model" state until you type them in. The SFP Advisor asks for the make and model too.
- **Model not read (maker only).** A common outcome after a partial read. You get a "Model not detected" chip and an "Add model" button, with a note that specs and firmware checks need both fields. Adding the model unlocks all three tabs.
- **Garbled model.** When the scan read a model but got a character wrong, the specs lookup's OCR-correction pass usually recovers the real model automatically (for example `C9300-46P` → `C9300-48P`). Note this correction helps the **specs** lookup; the firmware check uses the model as given.
- **You cannot edit a fully-read identity from this screen.** When the photo read **both** maker and model, the Identification editor does not appear (there is nothing marked missing to fill). Manual entry is a gap-filler, not an override for a confident read.
- **No firmware version.** If the scan did not read a version, the Firmware tab offers an "Enter version" box. Type the running version to get a verdict; leave it blank and the tab simply says it needs one.
- **Vendor DB gaps / latest unknown.** If the firmware lookup cannot confirm a latest version, you never hit a dead end: the "Latest" tile becomes a **"Check site ↗"** link to the vendor's official download page, the verdict reads "Check vendor portal" or "Latest version unknown," and a short line explains that a verified latest was not found in the database. Login-walled or bot-blocked vendor sites are handed to you as a portal link rather than guessed.
- **No changelog.** The firmware check never shows "what changed between versions" — that text is easy to get wrong, so it links you to the vendor's page instead.
- **SFP sizing is per-unit here.** In this card the SFP Advisor is not told how many SFP cages are open (that count comes from a live device login, which this screen does not do), so it shows **per-module** "each" prices and buy links rather than a "total to fill every cage" figure. Treat the prices as a guide.
- **SFP fallback can go stale.** When the live optics search is empty, the curated MikroTik catalog fills in. It is hand-verified but can drift if the manufacturer changes its pages, and the screen does not visibly mark a fallback pick as different from a live one — so confirm the part and price on the vendor's page before ordering.
- **Copper-only switches.** A switch with no fibre cages returns "No SFP required," which is the correct answer, not an error.
- **Slow first fetch.** The spec agent's web fallback (for unseen models) and the firmware lookup against live vendor sites can take a few seconds; Scan Results pre-fetches specs so the common case is instant.

## 8. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| The switch list, maker, model, firmware version, position | **REAL** — read from the rack photo, with light cleanup and expansion of partial reads. |
| Serial / MAC / IP tiles | **REAL when shown** — but usually blank here, because the photo read captures maker/model/firmware, not these. |
| The specifications table | **REAL / LIVE** — from the vendor's own product page (cache first, live web fetch for unseen models). |
| The firmware verdict and latest version | **REAL / LIVE** — read from the vendor's own site; never fabricated. |
| The "changelog" | **Not shown** — omitted by design; you get a link to the vendor's page instead. |
| Vendor login / support links, firmware download links | **REAL** — from curated maps of official pages. |
| SFP live module recommendations | **REAL / LIVE** — from real product listings. |
| SFP curated catalog (the fallback) | **SYNTHETIC / CURATED** — a hand-verified MikroTik list, used only when the live search is empty. |
| SFP product images | **REAL** — only genuine photos are shown; a missing one shows nothing. |
| Your manually entered maker / model / version | **REAL** — your input, saved on the device and surviving re-scans. |
| Any "not detected" gap | Shown honestly as an empty state with an editor — never a faked value. |

## 9. Use cases

- **Audit a switch on sight.** Scan the rack, open the switch, and read its specs and firmware status without logging into anything.
- **Fix a bad read once.** When a label was blurry, type the maker and model in. From then on every lookup runs from your correction, and it re-attaches even after another scan of the same switch.
- **Prioritise firmware upgrades.** The green "Up to date" / amber "Upgrade available" verdict tells you at a glance which switches can wait and which need attention, with a link to the vendor's page to confirm.
- **Plan and order optics.** Jump to the SFP Advisor for compatible transceivers and plug-and-play cables for that exact switch, each with a price and a buy link.
- **Settle a spec question fast.** "Does that model do Layer 3?" "How much PoE does it have?" — open the Specifications tab and read it off the vendor's own datasheet.
- **Work a multi-switch rack efficiently.** On a wide screen, the master–detail layout lets you click down the rail of detected switches and review each one's specs, firmware, and optics in place.

## 10. Common questions

**Q: Where does the switch information come from — is it reading the live device?**
No. Everything on this screen is built from the rack **photo**. RackTrack reads each switch's faceplate and then looks specs and firmware up on the vendor's website. It does not log into the switch, and it does not read from your CMDB here.

**Q: Why is my router not showing up?**
By design. Switch Information shows only devices the scan classed as switches. Routers are a different class and are kept out so they are not mislabelled.

**Q: The maker is right but the model is wrong or missing. What do I do?**
Use the Identification editor. If the model was not read, an "Add model" button appears; type the correct model and both the Specifications and Firmware tabs will run against it. Your entry is saved to that switch.

**Q: The scan read the model but got a character wrong. Do I have to fix it?**
Usually not for the specs. The datasheet lookup runs an automatic OCR-correction pass that recovers the real model for garbled reads. The firmware check, however, uses the model as read — so if firmware fails, correcting the model can help.

**Q: It says "Unidentified device." Is that a bug?**
No — it is the honest result when the photo could not be read (a blurry, angled, or obscured faceplate). Type the maker and model into the Identification editor and the card comes to life.

**Q: How do I get a firmware verdict if no version was detected?**
Open the Firmware tab and use the "Enter version" box (for example `16.12.1` or `1.0.6 Build 20210323`). RackTrack compares what you type against the latest the vendor ships.

**Q: What does "Check vendor portal" mean in the firmware tab?**
It means RackTrack reached the vendor's page but could not confirm the latest version automatically — often because the page needs a sign-in or blocks automated reading. Rather than guess, it hands you the real link so you can check it yourself.

**Q: Does the firmware check tell me what changed or whether I am vulnerable?**
No. It is a **currency** check — "are you on the newest version?" — not a changelog and not a security or end-of-life scan. It deliberately does not scrape release notes (they are easy to get wrong); it links you to the vendor's page where the real notes live.

**Q: Are the SFP prices the total I will pay?**
Treat them as per-module guide prices. In this card the advisor is not told how many SFP cages are open, so it shows each module's unit price and a buy link rather than a total to fill the switch. Some picks can also come from a curated backup list, so confirm the part and price on the vendor's page before ordering.

**Q: Why do some SFP results look "curated" rather than from a live search?**
When the live optics search comes back empty, the advisor falls back to a hand-verified catalog (MikroTik optics) so you are not left with a blank screen. It is not visibly marked as a fallback, which is exactly why the guidance is to verify before you buy.

**Q: Do my typed corrections survive another scan?**
Yes. Each entry is saved against a stable key for that switch (serial, then hardware address, then rack position), chosen so it re-attaches even when a new scan returns slightly different text. You only have to fix a bad read once.

**Q: What is the difference between the "Login portal" and "Vendor site" links in the header?**
"Login portal" is a curated, maker-specific sign-in URL RackTrack keeps on file. "Vendor site" is a general support/landing page used when there is no curated portal for that maker. Both open in a new tab.

---

*Switch Information — Specs, Firmware & SFP Advisor*
