#!/usr/bin/env bash
# Build a signed .ipa for TestFlight.
#   usage:  ./make-ipa.sh <TEAM_ID> [https://your-backend-url]
set -euo pipefail
cd "$(dirname "$0")"

TEAM="${1:-}"
API="${2:-$(cat /tmp/cf_url.txt 2>/dev/null || true)}"

[ -z "$TEAM" ] && { echo "✖ usage: ./make-ipa.sh <TEAM_ID> [api-url]"; echo "  Find TEAM_ID: Xcode ▸ Settings ▸ Accounts ▸ your team, or developer.apple.com ▸ Membership"; exit 1; }
[ -z "$API" ]  && { echo "✖ no API url (pass one, or start the tunnel)"; exit 1; }

echo "▸ Team:    $TEAM"
echo "▸ Backend: $API"

# 1. Web build with the backend URL baked in (guarded: rejects localhost/http)
VITE_API_BASE="$API" npm run build:mobile

# 2. Copy web assets into the iOS project
npx cap copy ios

# 3. Archive  (-allowProvisioningUpdates lets Xcode create the distribution
#    cert + App Store profile automatically for this team)
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/App.xcarchive \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates \
  clean archive

# 4. Export the .ipa
/usr/libexec/PlistBuddy -c "Delete :teamID" ios/App/ExportOptions.plist 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :teamID string $TEAM" ios/App/ExportOptions.plist

xcodebuild -exportArchive \
  -archivePath build/App.xcarchive \
  -exportOptionsPlist ios/App/ExportOptions.plist \
  -exportPath build/ipa \
  -allowProvisioningUpdates

echo
echo "════════════════════════════════════════════"
ls -lh build/ipa/*.ipa 2>/dev/null && echo "✔ IPA ready → client/build/ipa/" || { echo "✖ no .ipa produced"; exit 1; }
