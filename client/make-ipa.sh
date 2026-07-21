#!/usr/bin/env bash
# Build a signed .ipa for TestFlight.
#   usage:  ./make-ipa.sh <TEAM_ID> [https://your-backend-url]
set -euo pipefail
cd "$(dirname "$0")"

TEAM="${1:-}"
API="${2:-$(cat /tmp/cf_url.txt 2>/dev/null || true)}"

[ -z "$TEAM" ] && { echo "✖ usage: ./make-ipa.sh <TEAM_ID> [api-url]"; echo "  Find TEAM_ID: Xcode ▸ Settings ▸ Accounts ▸ your team, or developer.apple.com ▸ Membership"; exit 1; }
[ -z "$API" ]  && { echo "✖ no API url (pass one, or start the tunnel)"; exit 1; }

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"
GRADLE="android/app/build.gradle"

# 0. Bump the build number — iOS and Android in lockstep.
#
#    Nothing used to do this, so it was a manual edit in two files that was
#    easy to forget. Forgetting it is not harmless: Firebase happily accepts a
#    duplicate and testers see the same version twice, and TestFlight rejects
#    the upload outright because CFBundleVersion must strictly increase.
#
#    Take the max of the two current values so the platforms can never drift
#    apart, then add one. Pass --no-bump to rebuild the current number.
if [ "${NO_BUMP:-}" = "1" ] || [ "${3:-}" = "--no-bump" ]; then
  BUILD_NUM="$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PBXPROJ" | grep -oE '[0-9]+')"
  echo "▸ Build:   $BUILD_NUM (not bumped)"
else
  IOS_NUM="$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PBXPROJ" | grep -oE '[0-9]+')"
  AND_NUM="$(grep -m1 -oE 'versionCode +[0-9]+' "$GRADLE" | grep -oE '[0-9]+')"
  [ -n "$IOS_NUM" ] || { echo "✖ could not read CURRENT_PROJECT_VERSION from $PBXPROJ"; exit 1; }
  [ -n "$AND_NUM" ] || { echo "✖ could not read versionCode from $GRADLE"; exit 1; }
  BUILD_NUM=$(( (IOS_NUM > AND_NUM ? IOS_NUM : AND_NUM) + 1 ))
  sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = ${BUILD_NUM};/g" "$PBXPROJ"
  sed -i '' -E "s/versionCode +[0-9]+/versionCode ${BUILD_NUM}/" "$GRADLE"
  echo "▸ Build:   $BUILD_NUM (was iOS $IOS_NUM / Android $AND_NUM)"
fi

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
