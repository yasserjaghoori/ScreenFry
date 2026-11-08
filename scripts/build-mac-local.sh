#!/bin/bash
# Builds a ScreenFry download signed with this Mac's Apple Development identity:
#   npm run dmg:local
# Safari lists development-signed extensions on the Mac that built them without the
# "Allow unsigned extensions" setting, so this is the build to test with until releases are
# Developer ID signed. Output: dist/ScreenFry-<version>.dmg
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY_LINE=$(security find-identity -v -p codesigning | grep -m1 "Apple Development" || true)
if [ -z "$IDENTITY_LINE" ]; then
  echo "No Apple Development signing identity found. Sign in to Xcode → Settings → Accounts with your Apple ID, then try again." >&2
  exit 1
fi
# The team ID is the OU of the certificate; read it from the identity's certificate.
CERT_NAME=$(echo "$IDENTITY_LINE" | sed -E 's/.*"(.*)"/\1/')
TEAM=$(security find-certificate -c "$CERT_NAME" -p | openssl x509 -noout -subject -nameopt multiline | awk -F'= ' '/organizationalUnitName/ {print $2; exit}')
if [ -z "$TEAM" ]; then
  echo "Couldn't read the team ID for \"$CERT_NAME\"." >&2
  exit 1
fi
echo "Signing as \"$CERT_NAME\" (team $TEAM)"

npm run build:safari
xcodegen generate --spec safari/ScreenFry/project.yml
xcodebuild -project safari/ScreenFry/ScreenFry.xcodeproj -scheme ScreenFry \
  -configuration Release -derivedDataPath dist/safari \
  -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" \
  build | grep -E "error:|warning: .*sign|\*\* BUILD" || true

APP=dist/safari/Build/Products/Release/ScreenFry.app
node scripts/verify-safari.mjs "$APP"
node scripts/verify-macos-signing.mjs "$APP"
npm run dmg -- "$APP"

# Building registers this copy (and its Safari extension) with macOS. Unregister it so Safari
# doesn't list a second ScreenFry and the installed app doesn't report another copy.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
pluginkit -r "$APP/Contents/PlugIns/ScreenFry Extension.appex" 2>/dev/null || true
"$LSREGISTER" -u "$APP" 2>/dev/null || true
echo
echo "Next: quit ScreenFry, eject any open ScreenFry installer, open the new disk image in dist/,"
echo "drag ScreenFry onto Applications (Replace), and open it from Applications."
