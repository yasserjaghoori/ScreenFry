#!/bin/bash
# Builds the Mac App Store edition (docs/MAC_APP_STORE.md) and exports or uploads it:
#   npm run appstore           → dist/appstore/export/ScreenFry.pkg, signed for the App Store
#   npm run appstore -- upload → also uploads that build to App Store Connect
# Signs with the Bhron, LLC team (9Y9WU7573A) through Xcode's automatic signing: Xcode must be
# signed in to an Apple Account on that team (Settings → Accounts), which creates the
# certificates and provisioning profiles as needed. Upload needs the app's App Store Connect
# record to exist. Never run while the Chrome smoke test uses dist/chrome.
set -euo pipefail
cd "$(dirname "$0")/.."

DESTINATION=export
[ "${1:-}" = upload ] && DESTINATION=upload
ARCHIVE=dist/appstore/ScreenFry.xcarchive
OPTIONS=dist/appstore/ExportOptions.plist

npm run build:safari
xcodegen generate --spec safari/ScreenFry/project.yml
rm -rf "$ARCHIVE" dist/appstore/export
xcodebuild -project safari/ScreenFry/ScreenFry.xcodeproj -scheme "ScreenFry App Store" \
  -configuration Release -derivedDataPath dist/appstore -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates archive | grep -E "error:|\*\* ARCHIVE" || true
APP="$ARCHIVE/Products/Applications/ScreenFry.app"
test -d "$APP" || { echo "The archive failed; run the xcodebuild line above without the filter for details." >&2; exit 1; }
node scripts/verify-safari.mjs "$APP"

/usr/libexec/PlistBuddy -c "Clear dict" \
  -c "Add :method string app-store-connect" \
  -c "Add :destination string $DESTINATION" \
  -c "Add :teamID string 9Y9WU7573A" \
  -c "Add :signingStyle string automatic" \
  -c "Add :manageAppVersionAndBuildNumber bool false" \
  "$OPTIONS" >/dev/null 2>&1 || true
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OPTIONS" \
  -exportPath dist/appstore/export -allowProvisioningUpdates | grep -E "error:|EXPORT|Upload|upload" || true
if [ "$DESTINATION" = export ]; then
  test -f dist/appstore/export/ScreenFry.pkg || { echo "Export failed; see the messages above." >&2; exit 1; }
  echo "Built dist/appstore/export/ScreenFry.pkg"
fi
