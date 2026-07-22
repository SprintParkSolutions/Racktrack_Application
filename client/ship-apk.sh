#!/usr/bin/env bash
# Build the Android APK and push it to every tester via Firebase App Distribution.
# Replaces hand-sharing the file in WhatsApp: testers get an email + a push in the
# "App Tester" app, and can update straight from there.
#
#   usage:  ./ship-apk.sh ["release notes"]
#
# One-time setup (see FIREBASE-SETUP below):
#   1. firebase login
#   2. put your Firebase Android App ID in .firebase-app-id (or export FIREBASE_APP_ID)
#   3. create a tester group called "testers" in the Firebase console
set -euo pipefail
cd "$(dirname "$0")"

# The tunnel URL lives in one place — ../BACKEND_URL — because it was
# previously hardcoded here, in make-ipa.sh's docs, in lab.mjs and in the setup
# guide. When the tunnel moved, builds kept shipping to a dead host and nobody
# noticed until testers reported the app was down. Change that one file.
BACKEND="${VITE_API_BASE:-$(tr -d '[:space:]' < "$(dirname "$0")/../BACKEND_URL" 2>/dev/null)}"
[ -n "$BACKEND" ] || { echo "✖ no backend URL — set VITE_API_BASE or fill in BACKEND_URL at the repo root"; exit 1; }
NOTES="${1:-New RackTrack build}"
GROUP="${FIREBASE_GROUP:-testers}"

# App ID: env var wins, else the .firebase-app-id file next to this script.
APP_ID="${FIREBASE_APP_ID:-}"
if [ -z "$APP_ID" ] && [ -f .firebase-app-id ]; then
  APP_ID="$(tr -d '[:space:]' < .firebase-app-id)"
fi
if [ -z "$APP_ID" ]; then
  echo "✖ No Firebase App ID."
  echo "  Firebase console ▸ Project settings ▸ Your apps ▸ Android ▸ App ID"
  echo "  It looks like: 1:123456789012:android:abc123def456"
  echo "  Then:  echo '<APP_ID>' > client/.firebase-app-id"
  exit 1
fi

command -v firebase >/dev/null || { echo "✖ firebase CLI missing:  npm i -g firebase-tools"; exit 1; }
firebase login:list 2>/dev/null | grep -q '@' || { echo "✖ Not logged in.  Run:  firebase login"; exit 1; }

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

echo "▸ Backend baked in : $BACKEND"
echo "▸ Tester group     : $GROUP"
echo "▸ Release notes    : $NOTES"
echo

# 1. Web build with the backend URL compiled in (guard rejects http/localhost).
VITE_API_BASE="$BACKEND" npm run build:mobile

# 2. Copy the web assets into the Android project.
npx cap copy android

# 3. Compile the APK.
( cd android && ./gradlew assembleDebug --no-daemon )

APK="android/app/build/outputs/apk/debug/racktrack.apk"
[ -f "$APK" ] || { echo "✖ APK not found at $APK"; exit 1; }

# 4. Push to every tester. They get an email + a push notification.
echo
echo "▸ Uploading to Firebase App Distribution…"
firebase appdistribution:distribute "$APK" \
  --app "$APP_ID" \
  --groups "$GROUP" \
  --release-notes "$NOTES"

echo
echo "════════════════════════════════════════════"
echo "✔ Shipped. Testers have been notified — no WhatsApp needed."
