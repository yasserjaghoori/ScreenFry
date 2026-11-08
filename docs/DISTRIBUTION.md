# Distribution: the ScreenFry download

ScreenFry ships as one Mac app, downloaded from GitHub Releases as a disk image. Users drag the app into Applications and open it. The app carries both browser extensions and keeps them updated together.

## What the user does

1. Download `ScreenFry-<version>.dmg` from the [Releases page](https://github.com/yasserjaghoori/Screentime/releases) and open it.
2. Drag **ScreenFry** onto **Applications**, then open it from Applications. (If it's opened straight from the download, it asks to be moved first.)
3. **Safari:** click **Open Safari Settings**, turn ScreenFry on, then set **Edit Websites → Other Websites → Allow**.
4. **Chrome:** click **Open Chrome Extensions**, turn on **Developer mode**, and drag the **ScreenFry for Chrome** tile from the app onto that page.

Both are one-time steps. Apple requires the user to turn a Safari extension on themselves. Google doesn't let any Mac app install a Chrome extension from outside the Chrome Web Store: Chrome 137 removed the `--load-extension` option because malware abused it. So Chrome is loaded from a folder the app maintains.

### Testing on your own Mac (recommended)

`npm run dmg:local` builds the disk image signed with this Mac's Apple Development identity (from Xcode's Accounts settings). Safari lists that build's extension on this Mac without any developer settings, unlike the unsigned CI download. Run it from the project folder, then install the disk image it prints.

### Uninstalling

**ScreenFry → Uninstall…** (also a button at the bottom of the window) offers:
- **Keep Settings:** removes the app, its Safari extension and the Chrome extension folder. Chrome keeps ScreenFry's settings until you click Remove on its Extensions page, so a reinstall picks them up.
- **Erase Everything:** also deletes ScreenFry's caches and preferences, then opens Chrome's Extensions page so you can click Remove, which deletes Chrome's copy of the settings.

### Test builds (before Apple Developer ID signing)

Until releases are signed with a Developer ID and notarized, they're test builds:

- **First open:** macOS says the app can't be verified. Open **System Settings → Privacy & Security** and click **Open Anyway** (once).
- **Safari:** if ScreenFry isn't in the Extensions list, turn on **Settings → Advanced → Show features for web developers**, then the new **Developer** tab → **Allow unsigned extensions**. Safari turns this off when it quits, so it's needed again after each Safari restart. The app shows this hint only on unsigned builds.

## How updates reach everything

| Path | What happens |
| --- | --- |
| **Drag a new download over the old one** | Finder asks to Replace. Bundle identifiers never change, so Safari keeps the extension and its settings. On next launch, the app copies its newer Chrome build into the same folder. |
| **In-app update** (Sparkle) | The app checks the feed daily and from **Check for Updates…**, then offers the new version. Installing it replaces the whole app, so the Safari extension inside updates too, and the relaunch refreshes the Chrome folder. |
| **Chrome picks it up** | The Chrome extension checks once a minute, and on browser start, whether the version on disk differs from the one running, and reloads itself (`reloadIfUpdatedOnDisk` in the background). |

Settings live in each browser's extension storage, keyed to the extension, so updates never reset them. Chrome's extension ID comes from its folder path, which never changes: `~/Library/Application Support/ScreenFry/Chrome Extension`.

The app also warns if another copy of ScreenFry is installed. Two copies register two Safari extensions with the same identity, which makes Safari unreliable.

## Making a release (maintainers)

1. Bump the version: `package.json`, `package-lock.json`, `apps/extension/public/manifest.json`, `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `safari/ScreenFry/project.yml` (and the generated `project.pbxproj`).
2. Push a tag `v<version>`, or run the **Release** workflow manually from the Actions tab.
3. The workflow tests, builds, signs (ad-hoc or Developer ID), packages the DMG, writes `appcast.xml` when an update key exists, and publishes the GitHub Release.

To build a disk image locally on a Mac: `npm run build:safari`, `xcodegen generate --spec safari/ScreenFry/project.yml`, build the **ScreenFry** scheme in Release, then `npm run dmg -- <path to ScreenFry.app>`.

## Turning on in-app updates (one time)

Sparkle only installs updates signed with your private key; the app is built with the matching public key. Until then, updates are off and the menu item is disabled.

1. On a Mac, after one Xcode build, run Sparkle's `generate_keys` from `dist/safari/SourcePackages/artifacts/sparkle/Sparkle/bin/`. It stores the private key in your login Keychain and prints the public key.
2. Export the private key: `generate_keys -x sparkle-private-key.txt`. Add its contents as the repository **secret** `SPARKLE_PRIVATE_KEY`, then delete the file. Never commit it.
3. Add the printed public key as the repository **variable** `SPARKLE_PUBLIC_KEY`.

Releases built after that include the key and a signed feed. Users on an earlier build with no key need one manual download to get onto the updating build.

## Later: Apple Developer ID (removes the test-build steps)

With an Apple Developer Program membership, create a **Developer ID Application** certificate. Then add these repository secrets: `DEVELOPER_ID_P12` (base64 of the exported .p12), `DEVELOPER_ID_P12_PASSWORD`, `APPLE_TEAM_ID`, plus `APPLE_ID` and `APPLE_APP_PASSWORD` (an app-specific password) for notarization. The Release workflow then signs, notarizes and staples automatically. Safari 18.4 or newer accepts Developer ID–signed, notarized extensions without developer settings.

## Later: Chrome Web Store

An unlisted Web Store listing would give one-click Chrome installs and automatic updates. The app's Chrome card could then link to the listing instead of the folder. Store-installed copies skip the folder reload check (`installType` isn't `development`).

## Verifying signing before shipping

After a signed build, run `node scripts/verify-macos-signing.mjs <path/to/ScreenFry.app>`. A recursive `codesign --verify` alone can accept an ad-hoc app that dyld rejects under hardened library validation. The guard checks that hardened apps have a Team ID and matching embedded framework teams. Both the signed-download CI job and Release workflow run it. See [Mac app review](MAC_APP_REVIEW.md) for the confirmed 0.5.0 launch failure and local repair.

For local hardened development builds, sign with Apple Development rather than an ad-hoc identity. Public releases need Developer ID signing and notarization; the workflow's non-hardened ad-hoc branch is a test-download configuration.

Moving an existing unpacked Chrome install from `dist/chrome` to the app-managed folder is a one-time installation change with a different path-derived ID. Settings transfer from that older developer install is not automatic. The stable folder preserves settings for subsequent app-managed updates.
