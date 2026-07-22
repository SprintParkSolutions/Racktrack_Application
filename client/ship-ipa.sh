#!/usr/bin/env bash
# Ship the built IPA to TestFlight WITH release notes — the iOS twin of
# ship-apk.sh (which already sends notes to Firebase for Android).
#
#   ./make-ipa.sh 6GS882NNAX          # backend URL read from ../BACKEND_URL
#   ./ship-ipa.sh "• first bullet
# • second bullet
# • third bullet"
#
# It uploads via altool (App Store Connect API key auth), then sets the
# TestFlight "What to Test" notes via the API — the step Transporter can't do.
#
# The .p8 private key is NEVER committed (gitignored). Key ID / Issuer ID are
# identifiers, not secrets, and are useless without the .p8.
set -euo pipefail

NOTES="${1:-}"
if [ -z "$NOTES" ]; then
  echo "usage: ./ship-ipa.sh \"• what changed
• another bullet\""
  exit 1
fi

KEY_ID="${ASC_KEY_ID:-ZGYSK2PGM4}"
ISSUER_ID="${ASC_ISSUER_ID:-a693e02a-5a08-4740-88fa-670e02f68bf8}"
IPA="build/ipa/App.ipa"
PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"

cd "$(dirname "$0")"

[ -f "$IPA" ] || { echo "✗ $IPA not found — run ./make-ipa.sh first."; exit 1; }

# Build number the IPA carries (used to find the build in App Store Connect).
BUILD_NUM="$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PBXPROJ" | grep -oE '[0-9]+')"
[ -n "$BUILD_NUM" ] || { echo "✗ could not read CURRENT_PROJECT_VERSION"; exit 1; }

# altool looks for the key in these dirs by convention.
KEY_DIR="$HOME/.appstoreconnect/private_keys"
KEY_FILE="AuthKey_${KEY_ID}.p8"
mkdir -p "$KEY_DIR"
if [ ! -f "$KEY_DIR/$KEY_FILE" ]; then
  if [ -f "../$KEY_FILE" ]; then
    cp "../$KEY_FILE" "$KEY_DIR/$KEY_FILE"
    chmod 600 "$KEY_DIR/$KEY_FILE"
    echo "→ installed $KEY_FILE into $KEY_DIR"
  else
    echo "✗ $KEY_FILE not found (looked in $KEY_DIR and the repo root)."
    exit 1
  fi
fi

echo "→ uploading build $BUILD_NUM to TestFlight…"
xcrun altool --upload-app -t ios -f "$IPA" \
  --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
echo "✔ upload accepted (Apple now processes the build)"

echo "→ setting \"What to Test\" notes…"
node testflight-notes.mjs "$BUILD_NUM" "$NOTES"

echo ""
echo "✔ Shipped build $BUILD_NUM to TestFlight with release notes."
echo "  Testers get it once Apple finishes processing."
