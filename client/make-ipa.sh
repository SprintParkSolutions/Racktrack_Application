#!/usr/bin/env bash
# Build a signed .ipa for TestFlight.
#   usage:  ./make-ipa.sh <TEAM_ID> [https://your-backend-url]
set -euo pipefail
cd "$(dirname "$0")"

PBXPROJ="ios/App/App.xcodeproj/project.pbxproj"

# Accept --no-bump in ANY position (or NO_BUMP=1 in the env); everything that
# is not the flag is treated positionally as <TEAM_ID> then [api-url]. The old
# code only recognised it as argument 3, so `./make-ipa.sh TEAM --no-bump`
# silently bumped anyway.
NO_BUMP="${NO_BUMP:-0}"
ARGS=()
for a in "$@"; do
  if [ "$a" = "--no-bump" ]; then
    NO_BUMP=1
  else
    ARGS+=("$a")
  fi
done
# bash 3.2 (the macOS default): expanding an empty array under `set -u` is an
# error, so guard the expansion.
set -- ${ARGS[@]+"${ARGS[@]}"}

TEAM="${1:-}"
# Falls back to ../BACKEND_URL, the single place the tunnel URL is recorded, so
# a moved tunnel is one edit instead of four files that drift apart.
API="${2:-$(tr -d '[:space:]' < "$(dirname "$0")/../BACKEND_URL" 2>/dev/null || cat /tmp/cf_url.txt 2>/dev/null || true)}"

[ -z "$TEAM" ] && { echo "✖ usage: ./make-ipa.sh <TEAM_ID> [api-url] [--no-bump]"; echo "  Find TEAM_ID: Xcode ▸ Settings ▸ Accounts ▸ your team, or developer.apple.com ▸ Membership"; exit 1; }
[ -z "$API" ]  && { echo "✖ no API url (pass one, or start the tunnel)"; exit 1; }

# The bump rewrites two tracked files BEFORE the long Xcode archive. Any later
# failure must not leave them half-rewritten — Android especially, which this
# script never builds. Snapshot both before the first write and roll back on a
# non-zero exit; drop the snapshots on success.
BUMPED=0
_restore_versions() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$BUMPED" = "1" ]; then
    echo "✖ failed (exit $status) — restoring $PBXPROJ to its pre-bump state"
    [ -f "$PBXPROJ.prebump" ] && mv -f "$PBXPROJ.prebump" "$PBXPROJ"
  else
    rm -f "$PBXPROJ.prebump"
  fi
}
trap _restore_versions EXIT

# 0. Bump the build number — iOS and Android in lockstep.
#
#    Nothing used to do this, so it was a manual edit in two files that was
#    easy to forget. Forgetting it is not harmless: Firebase happily accepts a
#    duplicate and testers see the same version twice, and TestFlight rejects
#    the upload outright because CFBundleVersion must strictly increase.
#
#    Take the max of the two current values so the platforms can never drift
#    apart, then add one. Pass --no-bump to rebuild the current number.
#
#    `|| true` on the greps keeps `set -e`+pipefail from killing the script on a
#    no-match BEFORE the guards below can print a clear error (that is why the
#    old guards were unreachable).
if [ "$NO_BUMP" = "1" ]; then
  BUILD_NUM="$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PBXPROJ" | grep -oE '[0-9]+' || true)"
  [ -n "$BUILD_NUM" ] || { echo "✖ could not read CURRENT_PROJECT_VERSION from $PBXPROJ"; exit 1; }
  echo "▸ Build:   $BUILD_NUM (not bumped)"
else
  # iOS counts on its own now. It used to take max(iOS, Android) + 1 and write
  # the answer to BOTH project files, which kept them in step and also let one
  # platform drag the other: on 23 September 2026 the iOS project had drifted
  # back to 3 while Android had shipped 81, so TestFlight got 82 out of
  # nowhere. The last iOS build that actually reached a tester is in
  # SHIPPED.md, and the next one is that plus one. The project file is taken
  # into account too, so a build made and never shipped can never be reused.
  IOS_NUM="$(grep -m1 -oE 'CURRENT_PROJECT_VERSION = [0-9]+' "$PBXPROJ" | grep -oE '[0-9]+' || true)"
  SHIPPED_NUM="$(node scripts/shipped.mjs last ios 2>/dev/null || echo 0)"
  [ -n "$IOS_NUM" ] || { echo "✖ could not read CURRENT_PROJECT_VERSION from $PBXPROJ"; exit 1; }
  [ -n "$SHIPPED_NUM" ] || SHIPPED_NUM=0
  # The LOG governs, not the project file. Taking the higher of the two meant
  # any number that ever landed in the project file - including one from a
  # build that was never shipped, or from the day iOS jumped to 83 by accident -
  # pinned the count above the line the owner actually put it on. What reached a
  # tester is in SHIPPED.md, and the next build is that plus one
  # (23 September 2026). Android keeps its own rule: a phone refuses to install
  # a lower version code over the one it holds.
  BUILD_NUM=$(( SHIPPED_NUM + 1 ))
  # Snapshot BEFORE the first write so the trap can roll back on any later failure.
  cp "$PBXPROJ" "$PBXPROJ.prebump"
  BUMPED=1
  sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = ${BUILD_NUM};/g" "$PBXPROJ"
  echo "▸ Build:   $BUILD_NUM (last shipped $SHIPPED_NUM; the project file said $IOS_NUM; Android is untouched)"
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
