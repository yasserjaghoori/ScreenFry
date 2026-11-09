#!/bin/bash
# Re-signs a built ScreenFry.app for Developer ID distribution and notarization:
#   scripts/sign-developer-id.sh <path to ScreenFry.app> [signing identity]
# Apple's notary service rejects the app unless every executable inside it is signed with
# the Developer ID certificate, a secure timestamp and the hardened runtime, and none carry
# the get-task-allow debugging entitlement. Xcode only re-signs Sparkle's outer framework,
# leaving its helpers ad-hoc signed, so this signs everything again from the inside out.
set -euo pipefail
APP="${1:?Usage: sign-developer-id.sh <ScreenFry.app> [identity]}"
IDENTITY="${2:-Developer ID Application}"
cd "$(dirname "$0")/.."
ENTITLEMENTS=safari/ScreenFry

sign() { codesign --force --sign "$IDENTITY" --timestamp --options runtime "$@"; }

SPARKLE="$APP/Contents/Frameworks/Sparkle.framework"
if [ -d "$SPARKLE" ]; then
  # Order and flags follow Sparkle's documentation for re-signing its framework.
  sign "$SPARKLE/Versions/B/XPCServices/Installer.xpc"
  sign --preserve-metadata=entitlements "$SPARKLE/Versions/B/XPCServices/Downloader.xpc"
  sign "$SPARKLE/Versions/B/Autoupdate"
  sign "$SPARKLE/Versions/B/Updater.app"
  sign "$SPARKLE"
fi
sign --entitlements "$ENTITLEMENTS/ScreenFry Extension/ScreenFry Extension.entitlements" \
  "$APP/Contents/PlugIns/ScreenFry Extension.appex"
sign --entitlements "$ENTITLEMENTS/ScreenFry/ScreenFry.entitlements" "$APP"

# Check every executable the way the notary service will.
codesign --verify --deep --strict "$APP"
FAILED=0
while IFS= read -r -d '' FILE; do
  file -b "$FILE" | grep -q "Mach-O" || continue
  INFO=$(codesign -dvv "$FILE" 2>&1)
  NAME="${FILE#"$APP"/}"
  echo "$INFO" | grep -q "^Authority=Developer ID Application" || { echo "Not Developer ID signed: $NAME" >&2; FAILED=1; }
  echo "$INFO" | grep -q "^Timestamp=" || { echo "No secure timestamp: $NAME" >&2; FAILED=1; }
  echo "$INFO" | grep -Eq "flags=.*runtime" || { echo "No hardened runtime: $NAME" >&2; FAILED=1; }
  if codesign -d --entitlements - --xml "$FILE" 2>/dev/null | grep -q "get-task-allow"; then
    echo "Has the get-task-allow debugging entitlement: $NAME" >&2; FAILED=1
  fi
done < <(find "$APP" -type f -print0)
[ "$FAILED" = 0 ] || { echo "Developer ID signing check failed." >&2; exit 1; }
echo "Developer ID signing verified: every executable is signed, timestamped and hardened."
