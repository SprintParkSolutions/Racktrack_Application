#!/usr/bin/env bash
# Register the three EVE-NG lab switches on a RackTrack deployment.
#
#   OWNER_TOKEN=eyJ... ./register-lab-devices.sh https://demo.racktrack.ai
#
# POSTs to /api/lab/devices, which is requireRole('owner') — a member or
# org_admin token gets 403. Idempotent: `host` is UNIQUE in the schema, so a
# switch that is already registered comes back 409 and is reported as a skip
# rather than failing the run.
#
# Addresses are the real ones (see docs/knowledge-base/lab-live-switches.md §6).
# With the WireGuard route in place there is nothing to translate — no port
# mapping, no alias hostnames.
set -euo pipefail

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo "usage: OWNER_TOKEN=<jwt> $0 <base-url>" >&2
  echo "   e.g. OWNER_TOKEN=eyJ... $0 https://demo.racktrack.ai" >&2
  exit 64
fi
if [[ -z "${OWNER_TOKEN:-}" ]]; then
  echo "OWNER_TOKEN is not set — it must be a platform OWNER's bearer token." >&2
  echo "Get one with: curl -s -X POST $BASE/api/auth/login \\" >&2
  echo "  -H 'Content-Type: application/json' \\" >&2
  echo "  -d '{\"username\":\"<owner>\",\"password\":\"<pw>\"}' | jq -r .token" >&2
  exit 64
fi
BASE="${BASE%/}"

# host|vendor|label — L2SW2, L2SW1, CoreSW.
DEVICES=(
  '192.168.1.60|cisco-ios|L2SW2'
  '192.168.1.61|cisco-ios|L2SW1'
  '192.168.1.62|cisco-ios|CoreSW'
)

fail=0
for row in "${DEVICES[@]}"; do
  IFS='|' read -r host vendor label <<<"$row"
  body=$(printf '{"host":"%s","ssh_port":22,"vendor":"%s","label":"%s"}' "$host" "$vendor" "$label")

  # Split the body from the status line so both can be reported.
  resp=$(curl -sS -o - -w '\n%{http_code}' -X POST "$BASE/api/lab/devices" \
    -H "Authorization: Bearer $OWNER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "$body") || { echo "  $label ($host) — curl failed"; fail=1; continue; }

  code="${resp##*$'\n'}"
  json="${resp%$'\n'*}"

  case "$code" in
    201) echo "  $label ($host) — registered" ;;
    409) echo "  $label ($host) — already registered, left alone" ;;
    401|403) echo "  $label ($host) — $code: OWNER_TOKEN is not an owner token"; fail=1 ;;
    *)   echo "  $label ($host) — HTTP $code: $json"; fail=1 ;;
  esac
done

if [[ "$fail" -ne 0 ]]; then
  echo
  echo "One or more devices did not register. Nothing was rolled back — re-run" >&2
  echo "after fixing; the ones that succeeded will report 409 and be skipped." >&2
  exit 1
fi

echo
echo "Done. Open the Lab page as owner — the pills go Live within a poll cycle,"
echo "or press 'Run full audit' to read a switch immediately."
