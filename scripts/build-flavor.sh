#!/bin/bash
# Builds one flavor of the Mac app from the generated Xcode project (docs/DISTRIBUTION.md):
#   scripts/build-flavor.sh official|developer <Debug|Release> [xcodebuild settings...]
# official  → dist/safari/Build/Products/<configuration>/ScreenFry.app
#             (uses the Chrome Web Store extension)
# developer → dist/safari-developer/Build/Products/<configuration>/ScreenFry Developer.app
#             (greyed icon, installs the unpacked Chrome extension)
# Both keep the bundle identifier com.screenfry.ScreenFry, so macOS and Safari see one
# ScreenFry. Extra arguments (signing settings) go straight to xcodebuild.
set -euo pipefail
cd "$(dirname "$0")/.."

FLAVOR=${1:?official or developer}
CONFIGURATION=${2:?Debug or Release}
shift 2
FEEDS=https://github.com/yasserjaghoori/ScreenFry/releases/download/updates

case "$FLAVOR" in
  official)
    DERIVED=dist/safari
    NAME=ScreenFry
    SETTINGS=(SCREENFRY_CHANNEL=official SCREENFRY_DISPLAY_NAME=ScreenFry
      SCREENFRY_FEED_URL="$FEEDS/appcast.xml" ASSETCATALOG_COMPILER_APPICON_NAME=AppIcon)
    ;;
  developer)
    DERIVED=dist/safari-developer
    NAME="ScreenFry Developer"
    SETTINGS=(SCREENFRY_CHANNEL=developer "SCREENFRY_DISPLAY_NAME=ScreenFry Developer"
      SCREENFRY_FEED_URL="$FEEDS/appcast-developer.xml" ASSETCATALOG_COMPILER_APPICON_NAME=AppIconDeveloper)
    ;;
  *)
    echo "Unknown flavor $FLAVOR (official or developer)" >&2
    exit 1
    ;;
esac

PRODUCTS="$DERIVED/Build/Products/$CONFIGURATION"
rm -rf "$PRODUCTS/ScreenFry Developer.app"
xcodebuild -project safari/ScreenFry/ScreenFry.xcodeproj -scheme ScreenFry \
  -configuration "$CONFIGURATION" -derivedDataPath "$DERIVED" "${SETTINGS[@]}" "$@" build
# The bundle's file name isn't part of its signature, so renaming keeps it valid.
if [ "$NAME" != ScreenFry ]; then
  mv "$PRODUCTS/ScreenFry.app" "$PRODUCTS/$NAME.app"
fi
echo "Built $PRODUCTS/$NAME.app"
