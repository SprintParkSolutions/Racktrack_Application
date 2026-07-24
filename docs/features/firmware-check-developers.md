# Firmware Check

**Feature Reference** · *A vendor, model and current version in — a currency verdict, a version-aware comparison, and the vendor's own source page out. Reads the vendor's real site; never fabricates a version.*

**Category:** Reference tool — firmware currency check · **Audience:** The team (assumes you know the product) · **Document date:** 24 July 2026 · Part of the RackTrack documentation set.

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

The standalone Firmware Check page (`client/src/pages/FirmwarePage.jsx`, route `/firmware`) takes three fields — vendor, model, current version — and posts them to `POST /api/firmware`, which runs the vendored `firmware_lookup` package. That package reads the vendor's OWN site for the latest official firmware version, compares it to the entered version with a version-aware comparator, and returns a currency verdict plus the source page. It never fabricates a version, and it deliberately does **not** provide changelog bodies.

It is a **currency check** only: latest-vs-current. It is not a CVE / end-of-life / vulnerability scanner — there is no security-advisory data source involved.

## 2. At a glance

| | |
|---|---|
| **Category** | Reference tool — firmware currency check. |
| **Who uses it** | Anyone assessing upgrade urgency. |
| **Where input comes from** | User-typed `vendor` / `model` / `currentVersion` (or carried over from a scan). |
| **What it outputs** | `{ ok, latestVersion, upToDate, releaseNotesUrl, portalUrl, authRequired, statusValue, message }` → a plain-English verdict + comparison. |
| **Data source** | REAL / LIVE — the vendor's own site via per-vendor providers; gaps surfaced honestly. |

## 3. How it works — step by step

```
FirmwarePage form               →  vendor (type-ahead) + model + currentVersion  (all required)
        ↓
POST /api/firmware              →  { vendor, model, currentVersion }
        ↓
runFirmwareLookup (server)      →  python -m firmware_lookup lookup <vendor> <model> <ver> --json --verbose
        ↓
orchestrator → provider         →  normalize vendor → per-vendor provider reads the vendor's OWN site
        ↓
versioning.is_update_available  →  version-aware compare (not string match)
        ↓
firmwarePayloadFromLookup       →  UI contract → buildSummary → coloured verdict + details card
```

**Walkthrough**

1. `FirmwarePage` loads the vendor list from `GET /api/specs/vendors` for the make type-ahead, then requires all three fields before submit.
2. On submit it `POST`s to `/api/firmware`; the button shows "Checking…" (`loading`).
3. `buildSummary(result)` derives the tone (`ok` / `warn` / `neutral`) and headline/body from `upToDate`.
4. "Show details" reveals the version-status card (`current` → `latestVersion`, a status pill, a `source` link).
5. `ok:false` responses that carry a `portalUrl`/`message` (auth-required / bot-walled / unknown) render a neutral vendor-portal card, not an error.

## 4. Where the input comes from

- **Make / vendor** — typed; suggestions from `GET /api/specs/vendors` (`runPipelineModule('pipeline.all_vendor', ['--list-vendors'])`, which reads vendor names from `Switch_Vendors_Websites.xlsx`) — the same list the Specifications lookup uses.
- **Model** — free text.
- **Current version** — free text (e.g. `16.12.1`, `22.4R3`).
- **Carry-over** — when reached from a scanned switch, `location.state.deviceClass` and effective vendor/model/version can pre-fill.

## 5. What it produces (output)

`firmwarePayloadFromLookup` (`server/app.js` ~7913) maps a `firmware_lookup` `FirmwareResult.to_full_dict()` onto the UI contract:

- `ok` — `true` only when status is `ok`.
- `vendor`, `model`, `currentVersion` — echoed back.
- `latestVersion` — the latest official version, or `null`.
- `upToDate` — `true` / `false` / `null` (never coerce `null` to `false`).
- `releaseNotesUrl` and `portalUrl` — both the vendor page / portal (the name `releaseNotesUrl` is kept so the existing link renders; it is not a changelog URL).
- `authRequired` — `true` when status is `auth_required`.
- `statusValue` — the raw status (see §8).
- `message`, `confidence` — provider-supplied.
- `changelog` — always `[]` (the package provides no changelog, by design).

HTTP status: `200` whenever the lookup ran (including auth-required / bot-walled / unknown — each carries a portal link); `502` only on a genuine runner failure (`_runnerError`).

## 6. What you see on screen

- **Summary card** — `tone_ok` / `tone_warn` / `tone_neutral` headline + body from `buildSummary` (e.g. "You're up to date." / "An upgrade is available." / "We couldn't confirm the latest version."), with an "Open on vendor site" button and a "Show details" toggle.
- **Version-status card** — `current` → `latestVersion` (or "not detected"), a status pill (**Up to date** / **Upgrade available** / **Couldn't compare versions**), and a "source ↗" link.
- **Fallback search links** — when `!latestVersion`, generated Vendor-support and Google-search links so there's always a next step.
- **Vendor-portal card** — for `ok:false` with `portalUrl`/`message`, a neutral card with "Log in on vendor site ↗" (auth-required) or "Open on vendor site ↗".

## 7. The logic behind it

- **Currency verdict.** `upToDate` is derived from a version comparison, not a lookup table.
- **Version-aware compare.** `firmware_lookup/versioning.py` parses versions into comparable tuples and returns `-1/0/1` or `None`; `is_update_available` returns `None` (not `False`) when either side is unparseable, and the UI shows "Couldn't compare versions."
- **Honest gaps.** Missing latest → explicit empty state + search links; never an implied "all clear."
- **Never fabricates.** Providers return a `FirmwareResult` always, never raise, never invent a version (`firmware_lookup/result.py`).
- **Login/bot walls are not dead ends.** `auth_required` / `not_implemented` (bot-walled) carry the vendor's real `source_url` as a portal link.

## 8. Detailed technical explanation

**Server route.** `POST /api/firmware` (`server/app.js` ~7857, behind `auth.requireAuth` + `moduleLimit`) validates the three fields, then `runFirmwareLookup` (~7880) spawns `python -u -m firmware_lookup lookup <vendor> <model> <currentVersion> --json --verbose` with a 90s timeout (live vendor sites and browser-login providers are slow), parsing the whole of stdout as JSON.

**The package.** `firmware_lookup/orchestrator.py` `get_latest_firmware(vendor, model, current_version)` normalises the vendor (`normalize.py`), selects a provider from `build_providers()` (per-vendor modules under `firmware_lookup/providers/` — roughly 79, e.g. `dell.py`, `extreme.py`, `zyxel.py`, `moxa.py`, `nvidia.py`, plus base/session/browser-login helpers), and calls `provider.get_latest_firmware(...)`. It never raises — an unimplemented vendor yields `not_implemented`, a provider exception yields `cannot_determine`. Version comparison is `firmware_lookup/versioning.py` (`parse_version` handles Junos `10.2R3`/`-S2`, Arista `4.31.2F`, ArubaOS-CX `10.13.1000`, Cumulus `5.7.0`, and Cisco IOS parenthetical `15.2(7)E10` by normalising parens to dots).

**Result contract.** `firmware_lookup/result.py` defines `FirmwareResult` and the factory functions that are the single source of truth for the literal messages: `ok_result`, `cannot_determine`, `auth_required`, `not_implemented`, `model_not_found`, `ambiguous_model`. `Status` ∈ `ok` / `cannot_determine` / `auth_required` / `not_implemented` / `model_not_found` / `ambiguous_model`; `Confidence` ∈ High/Medium/Low. `to_full_dict()` adds `status` + `message` for the Node mapper.

**No changelog, by design.** The package intentionally does not return changelog / release-note bodies (`changelog` is hard-`[]` in `firmwarePayloadFromLookup`); the rationale is accuracy over coverage — an unreliable scraped changelog is worse than a link to the vendor's real page, which is what `source_url` / `releaseNotesUrl` / `portalUrl` carry. Note this diverges from an earlier iteration of this feature that surfaced scraped release-note excerpts; the current implementation does not.

**Not a security scanner.** There is no CVE feed, EOL calendar, or advisory source in this path. The verdict is strictly latest-version-vs-current currency.

**Client.** `FirmwarePage.jsx` — `buildSummary` for the headline/body; `showDetails` gates the version-status card; the fallback search links are built from `result.vendorUrl` (site-scoped Google) and a general Google query when `latestVersion` is absent. The same `/api/firmware` endpoint is reused inside Switch Information's Firmware tab (see the Switch Information doc), cached per rack via `scanPrefetch`.

## 9. Real data vs. synthetic

| Thing on screen | Real or synthetic |
|---|---|
| Latest version & source page | **REAL / LIVE** — read from the vendor's own site by a per-vendor provider. |
| Version comparison / `upToDate` | **REAL** — computed by `versioning.is_update_available` from the entered current version and the detected latest. |
| Coverage gaps (`cannot_determine`, no latest) | Honest empty state + search links — never faked, never coerced to "up to date." |
| Auth-required / bot-walled | Honest neutral card with the vendor's real portal link. |
| Changelog | Not shown — `changelog` is always `[]` by design. |

## 10. Use cases

- **Prioritising upgrades.** A switch several releases behind (`upToDate:false`) rises up the maintenance list.
- **Confirming currency.** A quick `upToDate:true` green light before signing off.
- **Getting to the source.** When `latestVersion` can't be confirmed, the vendor/search links give a one-click path instead of a dead end.

---

— Firmware Check —
