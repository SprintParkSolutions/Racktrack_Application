# Switch Information

**Feature Reference** · *Per detected switch: scanned identity, live vendor specs, firmware currency, and SFP advice — one card, three tabs, driven by the photo.*

**Category:** Per-rack switch reference — scanned identity plus live vendor lookups · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

For each detected switch this view brings together identity (vendor/model/firmware, read by OCR from the faceplate), a live datasheet spec lookup, a firmware currency check, and SFP transceiver advice — one `SwitchCard` per switch, with **Specifications / Firmware / SFP Advisor** tabs. It is driven by the scan, not by logging into the device; when a read is missed it exposes an honest "not detected" state plus an inline editor whose corrections persist per switch.

Lives at `client/src/pages/SwitchInformationPage.jsx`; `SwitchInfoContent` is exported and embedded in the Results page's Switches tab (`client/src/pages/ResultsPage.jsx`).

## 2. At a glance

| | |
|---|---|
| **Category** | Scanned switch identity plus live vendor lookups, scoped to one rack. |
| **Who uses it** | Technicians and engineers assessing what's installed. |
| **Where input comes from** | OCR identity (`/api/scan/:rackId/ocr-devices`); live specs (`/api/specs`); live firmware (`/api/firmware`); SFP advice (`/api/sfp/analyze`). |
| **What it outputs** | A per-switch card: identity header + fields grid + Specifications, Firmware and SFP Advisor tabs. |
| **Data source** | MIXED — identity scanned (OCR); specs/firmware live from the vendor; SFP has a generic fallback catalog. |

## 3. How it works — step by step

```
useSwitchData(rackId)           →  GET /api/scan/:rackId/ocr-devices, keep class_name === 'switch'  (routers excluded)
        ↓
SwitchPicker                    →  one tab per detected switch (label = position / model / index)
        ↓
SwitchCard → loadDetails()      →  effective vendor/model/version = user override ∨ OCR
        ↓  ├─ swTab 'hardware'   →  POST /api/specs   { vendor, model, fromOcr } → Switch Spec Agent (Agent/Agent_scrap)
        ↓  ├─ swTab 'firmware'   →  POST /api/firmware { vendor, model, currentVersion } → firmware_lookup package
        ↓  └─ swTab 'optics'     →  SfpAdvisor → POST /api/sfp/analyze { vendor, model, interfaces } → pipeline.sfp_recommend
        ↓
overrides persisted             →  safeStorage, keyed serial > mac > position (survives re-scan)
```

**Walkthrough**

1. `useSwitchData(rackId)` fetches `GET /api/scan/:rackId/ocr-devices` and filters to `NETWORK_CLASSES = ['switch']` — routers are a different class and are deliberately excluded (they were showing up mislabelled). The current hook returns `showingOcrOnly = true` / `data: null`; the CMDB-backed list endpoint (§4) is the alternative source.
2. `SwitchPicker` renders a tab strip when more than one switch was detected; `SwitchCard` renders the selected one.
3. `loadDetails()` computes effective vendor/model/version (user override wins over OCR), checks the prefetch cache, then fires the spec and firmware lookups in parallel.
4. The in-card tab strip switches between `swTab` values `'hardware'` (Specifications), `'firmware'` (Firmware), `'optics'` (SFP Advisor).
5. Missing reads surface an inline identification editor; saved values persist and re-attach after a re-scan.

## 4. Where the input comes from

- **Scanned identity** — `GET /api/scan/:rackId/ocr-devices` (per-device EasyOCR pass over each chassis crop; `pipeline.ocr_devices`), giving `class_name`, `make`, `model`, `version`, `position`.
- **CMDB switch list (server-side, available)** — `GET /api/cmdb/rack/:rackId/switches` (`server/app.js` ~5676) spawns `servicenow/list_rack_switches.py`, which queries `cmdb_ci_rack` by `u_racktrack_scan_id` and walks Contains-relations to switch children, returning `{ name, serial_number, model_number, ip_address, mac_address, os_version, manufacturer, position }`. Cached ~60s per rack; requires an active ServiceNow connection profile (else `400`); empty `switches[]` when SN env isn't set.
- **Live spec lookup** — `POST /api/specs` → the Switch Spec Agent at `Agent/Agent_scrap` (`runAgentCli` → `cli.py`).
- **Live firmware lookup** — `POST /api/firmware` → the vendored `firmware_lookup` package.
- **SFP advice** — `POST /api/sfp/analyze` → `pipeline.sfp_recommend`.
- **Curated vendor links** — `client/src/utils/vendorLoginUrls.js` (`findVendorLogin`) maps a make to an official login/support portal URL.
- **Manual entry** — user-typed make/model/version, persisted in `safeStorage`.

## 5. What it produces (output)

- **Identity card** — combined `vendor + model` title (or "Unidentified device"), rack position, IP when known, and a vendor-portal pill from `findVendorLogin`.
- **Fields grid** — firmware version, serial, MAC, IP — each rendered only when present (`hasDetails` gate).
- **Specifications** — the `{ vendor, model, productUrl, specs }` contract from `specPayloadFromAgent`, rendered as a two-column table + "View full details".
- **Firmware status** — `{ currentVersion, latestVersion, upToDate, releaseNotesUrl, portalUrl, authRequired, statusValue, message }` from `firmwarePayloadFromLookup` (note: `changelog` is always `[]` by design).
- **SFP recommendations** — modules and pre-terminated cables from `SfpAdvisor` (`advice.modules`, `advice.cables`, `advice.recommended`, `advice.budget`).

## 6. What you see on screen

- **`SwitchPicker`** — a tab strip when several switches were detected.
- **Identity header** — `vendor + model` title or "Unidentified device."
- **Identification editor** — a status chip plus a make/model corrector when detection was partial/missing (`editingIdent`, `editingVersion`).
- **Specifications tab** (`swTab === 'hardware'`) — two-column spec table and a product-page link.
- **Firmware tab** (`swTab === 'firmware'`) — a status headline (`fwHeadline`/`statusColor`), current and latest version, and a source / vendor-portal link.
- **SFP Advisor tab** (`swTab === 'optics'`) — the embedded `SfpAdvisor` (`client/src/components/SfpAdvisor.jsx`).

## 7. The logic behind it

- **Trusts the photo, not a login.** This is the "what's physically in front of me" view — identity from OCR + web lookups, no device SSH. (Live device login lives in the separate Ports/Drift/console path — see §8.)
- **Switches only.** `NETWORK_CLASSES = ['switch']` — routers (a different `class_name`) are excluded so a MikroTik router doesn't render as a switch.
- **Model cleanup.** `expandPartialModel` expands garbled/truncated OCR fragments against `PARTIAL_MODEL_MAP` (regex → canonical SKU, e.g. `C93006` → `C9300-48P`) so a partial read still resolves; the spec route additionally runs an OCR-correction probe when `fromOcr` is set.
- **Per-rack caching.** Live lookups are cached via `scanPrefetch` (`getCached`/`setCached`, `cacheKey.specs`, `cacheKey.firmware`), so reopening a switch is instant and Results-page prefetch is reused.
- **Honest gaps.** Explicit "not detected" states + editor rather than guessed values; firmware auth-required / bot-walled / unknown come back as a portal link + message, not an error.
- **Overrides stick.** A manual make/model/version is stored keyed to serial > MAC > position (`switchStableId`), so it survives another scan that returns different OCR text.

## 8. Detailed technical explanation

**Identity + list.** `useSwitchData` (`SwitchInformationPage.jsx` ~1157) fetches `/api/scan/:rackId/ocr-devices`, keeps `class_name === 'switch'`, and produces the switch array; `SwitchInfoContent` (exported, ~1418) is the embeddable body used by `ResultsPage.jsx`. `SwitchInformationPage` (default export) is the standalone page. Routes: `/switch-info` (rackId from `location.state`) and `/switch-info/:rackId` (deep-link via `RackSwitchesRoute`).

**Specs (`POST /api/specs`).** `server/app.js` (~7674) calls the standalone Switch Spec Agent under `Agent/Agent_scrap` via `runAgentCli` (spawns `cli.py --json`, 60s budget). The agent answers from a SQLite cache (~1ms) with a free multi-engine web fallback (~4s) for unknown models — no LLM, no API keys. When `fromOcr === true`, `resolveAgentWithOcrCorrection` runs a two-stage probe (DB-only → suggestion retry → live fallback) using `_modelSimilarity`/`_bestSuggestion` so garbled models auto-correct. `specPayloadFromAgent` maps the agent record onto the UI's `{ vendor, model, productUrl, specs }` contract.

**Firmware (`POST /api/firmware`).** `server/app.js` (~7857) → `runFirmwareLookup` spawns `python -m firmware_lookup lookup <vendor> <model> <version> --json --verbose` (90s budget). The `firmware_lookup` package (`firmware_lookup/orchestrator.py` → per-vendor providers under `firmware_lookup/providers/`, ~79 of them) reads the vendor's OWN site for the latest official version and never fabricates one; version compare is done by `firmware_lookup/versioning.py` (`is_update_available`, semver-ish parsing that handles Junos `10.2R3`, Arista `4.31.2F`, Cisco `15.2(7)E10`, etc.). Statuses (`firmware_lookup/result.py`): `ok`, `cannot_determine`, `auth_required`, `not_implemented`, `model_not_found`, `ambiguous_model`. `firmwarePayloadFromLookup` maps `FirmwareResult.to_full_dict()` onto the UI contract; `releaseNotesUrl` keeps its name for the existing link but is the vendor page / portal, and `changelog` is intentionally `[]` — the package provides no changelog (accuracy over coverage). This is a **currency check only** — not a CVE / end-of-life / vulnerability scan.

**SFP (`POST /api/sfp/analyze`).** `server/app.js` (~7832) runs `pipeline.sfp_recommend` with `--vendor/--model/--interfaces`. `SfpAdvisor.jsx` first re-fetches `/api/scan/:rackId/ocr-devices` to backfill vendor/model when the caller passed `Unknown`, then calls the analyze endpoint; `pipeline/sfp_recommend.py` infers the slot type (from specs/interfaces/model), web-searches for compatible modules, and falls back to `_SLOT_GENERIC_FALLBACK` generic third-party modules for slots with no exact listings. A client-side `generateOfflineFallback` covers a fully offline response.

**Overrides.** `userOverrideKey(rackId, sw, field)` → `racktrack:<field>:<rackId>::<switchStableId>` in `safeStorage` (`getItem`/`setItem`/`removeItem`), fields `make` / `model` / `fwVersion` (`loadOverride`/`saveOverride`, plus `loadUserVersion`/`saveUserVersion`). `switchStableId` = serial > MAC > position > CV name — deliberately not make/model, since those are the editable fields. Effective values (override ∨ OCR) drive the lookups; changing a value invalidates the cached spec/firmware results and re-fetches.

**Boundary — this is not the SSH view.** Switch Information never logs into a device. Live switch access over SSH is a separate capability: `server/lib/port_poller.js` polls `monitored_devices` on a schedule (default 1h, bounded concurrency, SQLite backoff), running the per-vendor command set from `server/data/switch_cli_matrix.json` (keys like `identity`, `port_status`, `lldp`, `poe`, `vlans` per vendor) and writing port-state drift via `port_history_db.writePoll`. That drives the Ports / Drift / console feature, not this card.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Switch list, make, model, firmware version, position | **REAL** — from the scan (OCR), with `PARTIAL_MODEL_MAP` cleanup. |
| Specifications | **REAL / LIVE** — from the vendor's product page via the Switch Spec Agent. |
| Firmware status & latest version | **REAL / LIVE** — from the vendor's own site via `firmware_lookup`. |
| Vendor portal / download links | **REAL** — from the curated `vendorLoginUrls` map. |
| Your manual make / model / version | **REAL** — saved in `safeStorage`, survives re-scans. |
| A "not detected" gap | Honest empty state + editor — never a faked value. |

## 10. Use cases

- **Audit a switch on sight.** Scan, open the switch, read its specs and firmware currency without an SSH session.
- **Fix a bad read once.** Type the model when the label was blurry; the override persists (keyed by serial/MAC/position) and every lookup works from it thereafter.
- **Plan optics.** The SFP Advisor tab recommends the right transceivers/cables for the exact model.

---

— Switch Information —
