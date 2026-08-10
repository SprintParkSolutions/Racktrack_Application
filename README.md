# RackTrack

[![CI](https://github.com/RacktrackTeam/RackTrack/actions/workflows/ci.yml/badge.svg)](https://github.com/RacktrackTeam/RackTrack/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-20-brightgreen)](.nvmrc)
[![Python](https://img.shields.io/badge/python-3.11-blue)](requirements.txt)

**AI-assisted datacenter rack identification for field technicians.** Point a phone at a rack and get back the unit map, switch model, firmware recommendation, live port state, and a reconciliation against the CMDB record in ServiceNow.

Auditing a rack by hand means reading labels in poor light, transcribing model numbers, and trusting that the CMDB was updated the last time somebody swapped a device. RackTrack replaces that with a photo: the technician captures the rack, and the server returns a structured inventory that is diffed against the system of record, so drift surfaces as a work note on the incident instead of a surprise during the next outage.

---

## Contents

- [What it produces](#what-it-produces)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Mobile builds](#mobile-builds)
- [ServiceNow bridge](#servicenow-bridge)
- [Testing and CI](#testing-and-ci)
- [Observability](#observability)
- [Security](#security)
- [Deployment](#deployment)
- [Project status](#project-status)

---

## What it produces

A technician captures the front — and optionally the rear — of a rack. A multi-stage computer-vision pipeline returns:

| Output | Detail |
| --- | --- |
| **Unit grid** | Every U position, contiguous from top to bottom |
| **Device map** | What occupies each unit: switch, server, firewall, PDU, or blank |
| **Switch identity** | Vendor and model from logo and label OCR, cross-checked against the vendor database |
| **Port layout** | Port count, type (RJ45 / SFP / SFP+ / QSFP), and per-port occupancy from cable detection |
| **Firmware** | Recommended firmware for the detected model, sourced from the vendor matrix |
| **Topology** | A 3D rendering of the rack, plus inter-rack uplinks for multi-rack scans |
| **CMDB reconciliation** | Scan matched against the ServiceNow CMDB; mismatches (wrong U, wrong model, unplugged port) generate work notes on the related incident |

## Architecture

```
 ┌─────────────────────────┐         ┌────────────────────────────┐
 │  Mobile client          │  HTTPS  │  Node / Express API        │
 │  (React + Capacitor)    │ ──────▶ │  - auth + audit (SQLite)   │
 │  iOS · Android · web    │         │  - worker pool             │
 │  AR view (ARCore/ARKit) │         │  - SSH switch probe        │
 └─────────────────────────┘         └─────────────┬──────────────┘
                                                   │ spawn
                                                   ▼
                                     ┌────────────────────────────┐
                                     │  Python CV pipeline        │
                                     │  YOLO units / devices /    │
                                     │  ports · EfficientNet      │
                                     │  cable classifier · OCR    │
                                     └─────────────┬──────────────┘
                                                   │
                                                   ▼
                                     ┌────────────────────────────┐
                                     │  ServiceNow bridge         │
                                     │  CMDB lookup + work notes  │
                                     └────────────────────────────┘
```

**`client/`** — React 18 + Vite SPA, wrapped with Capacitor 6 for iOS and Android. Three.js drives the 3D rack and topology views. A native ARCore activity on Android is exposed through a Capacitor plugin (`RackAR`).

**`server/`** — Node/Express API: JWT auth, per-tenant scoping, an audit log in SQLite, structured logging via pino, Prometheus metrics, a worker pool that fans scans out to Python subprocesses, and an SSH probe that pulls live port state from Cisco / Juniper / Arista switches.

**`pipeline/`** — the CV pipeline. YOLO detectors for devices, ports and PDU ports, an EfficientNet cable classifier, OCR for device and side labels, multi-rack splitting, firmware lookup against the vendor matrix, and quality checks that decide whether a frame is good enough to score.

**`servicenow/`** — Python bridge that correlates a ServiceNow incident with a CMDB walk and the most recent RackTrack scan, then posts a reconciliation work note back to the incident.

## Repository layout

```
client/                React + Capacitor mobile/web app
server/                Node/Express API, worker pool, SSH probe
pipeline/              Python CV pipeline (YOLO + OCR + cable + firmware)
servicenow/            ServiceNow ↔ RackTrack reconciliation
servicenow_inbox/      Incoming ServiceNow scan payloads
firmware_lookup/       Vendor firmware matrix and lookup
support-bot/           Knowledge base and support assistant
Agent/                 Spec-lookup agent tooling
active_learning_Cache/ Captured "wrong?" corrections from the field
retraining_learning/   Offline retraining pipeline that consumes them
netdisco-docker/       Netdisco container — live-network source of truth for topology
e2e/                   Playwright browser sweep used by CI
deploy/                Caddy config and demo deployment assets
docs/                  Architecture notes, feature docs, knowledge base
Test_Image/            Sample rack images for testing
cmdb_racks/            Exported CMDB rack JSON
config.json            Model paths and detection thresholds
Dockerfile             Container image for the API + pipeline
docker-compose.yml     Local stack
```

> **Model weights are not in this repository.** `Models/` is gitignored — the trained YOLO and EfficientNet weights are distributed separately. A clone will build and lint, but inference requires the weights to be placed in `Models/` as named in [`config.json`](config.json).

## Getting started

**Prerequisites**

- Node 20 (see [`.nvmrc`](.nvmrc))
- Python 3.11
- Model weights in `Models/` — see the note above
- For mobile builds: Android Studio with the Android SDK, or Xcode for iOS

**Install**

```bash
npm run install:all                  # root + client + server
pip install -r requirements.txt      # CV pipeline
pip install -r requirements-dev.txt  # test tooling
```

**Run client and server together**

```bash
npm run dev
```

This starts the API and the Vite dev server concurrently. The client proxies `/api`, `/uploads` and `/outputs` to the server, so the SPA and API share an origin in development.

## Configuration

[`config.json`](config.json) controls model paths and detection thresholds:

```json
{
  "models": {
    "devices_seg":      "Models/devices_seg.pt",
    "ports_typed":      "Models/ports_9.pt",
    "ports_status":     "Models/port_count.pt",
    "pdu_ports":        "Models/pdu_ports_v1_det_best.pt",
    "cable_classifier": "Models/cable_eff_best"
  },
  "detection": {
    "device_detect_mode": "seg",
    "units_conf":   0.25,
    "devices_conf": 0.20,
    "ports_conf":   0.23,
    "pdu_conf":     0.40
  }
}
```

Lowering a confidence threshold increases recall at the cost of false positives. The pipeline already runs a retry pass at reduced thresholds when the first pass finds nothing, so lower these only when that fallback is also coming up empty.

Runtime secrets are read from the environment, never from the repository. Copy the templates and fill them in:

```bash
cp server/.env.example server/.env
cp servicenow/.env.example servicenow/.env
```

## Mobile builds

```bash
cd client
npm run build
npx cap sync android    # or ios
npx cap open android    # or ios
```

On Android, the AR activity requires ARCore-capable hardware; devices without it fall back to the standard capture flow, which produces the same scan output.

## ServiceNow bridge

```bash
cd servicenow
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # add your PDI credentials
python main.py INC0010001
```

See [`servicenow/README.md`](servicenow/README.md) for the mock-vs-live switch and the work-note format.

## Testing and CI

```bash
cd server && npm test        # 71 tests — auth, tenancy, worker pool, scan paths
cd client && npm test        # 53 tests — media validation, redirect safety, utils
python -m pytest pipeline/tests -q   # 101 tests — geometry, config, lookup, occupancy
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request, plus weekly:

- **Secret scan** — gitleaks across full history; blocking
- **Node** — server tests and lint, client tests, production build, lint
- **Browser sweep** — Playwright drives the built client as a signed-in user across every major route, failing on a white screen, an icon rendered as literal text, horizontal overflow at 320px, a sub-16px input, or any console error
- **Python** — pipeline unit tests against the weight-free logic, plus a best-effort import smoke test

The browser sweep exists because build, lint and the unit suites once all passed while every icon in the app rendered as its own name.

## Observability

| Surface | Endpoint / location |
| --- | --- |
| Health | `GET /healthz` |
| Metrics | `GET /metrics` (Prometheus) |
| API health detail | `GET /api/health` |
| Logs | Structured JSON via pino — `server/lib/observability.js` |
| Audit | Every state-changing route writes to `audit_log` in `server/data/auth.db` |

## Security

- **Authentication** — bcrypt (cost 12, with transparent rehash on sign-in) and JWTs pinned to HS256 with issuer and audience verified. The signing secret is generated on first run and never committed.
- **Authorization** — per-tenant scoping throughout; asset routes (`/uploads`, `/outputs`) normalise and decode a path *before* deciding access, so case and percent-encoding cannot be used to reach another tenant's scans.
- **Rate limiting** — per-account token buckets on every endpoint that accepts a credential or a one-time code.
- **Transport and headers** — helmet, an explicit CORS allow-list, and a CSRF check that engages whenever a request carries an auth cookie.
- **Secrets** — SSH credentials are stored AES-256-GCM encrypted with the key held separately from the ciphertext. No credentials are committed; CI enforces this with a blocking secret scan.

To report a vulnerability, open a private security advisory on this repository rather than a public issue.

## Deployment

The API and pipeline ship as a container ([`Dockerfile`](Dockerfile), [`docker-compose.yml`](docker-compose.yml)), fronted by Caddy for TLS — see [`deploy/`](deploy/). The demo environment runs from [`docker-compose.demo.yml`](docker-compose.demo.yml).

## Project status

Pre-production. The vision pipeline, mobile capture flow, ServiceNow bridge and multi-tenant auth work end-to-end. Active areas: on-device inference for offline scans, broadening the vendor matrix beyond Cisco / Juniper / Arista / HPE, and continued multi-tenant hardening.

---

© Sprintpark LLC. All rights reserved. This repository is published for evaluation and review; it carries no open-source licence grant.
