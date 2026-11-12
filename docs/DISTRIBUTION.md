# Distribution: the ScreenFry download

ScreenFry ships as one Mac app, downloaded from GitHub Releases as a disk image. Releases are signed with the Bhron, LLC Developer ID and notarized by Apple, so they open normally and Safari lists the extension without developer settings. Users drag the app into Applications and open it. The app carries both browser extensions and keeps them updated together.

## What the user does

1. Download `ScreenFry-<version>.dmg` from the [Releases page](https://github.com/yasserjaghoori/ScreenFry/releases) and open it.
2. Drag **ScreenFry** onto **Applications**, then open it from Applications. (If it's opened straight from the download, it asks to be moved first.)
3. **Safari:** click **Open Safari Settings**, turn ScreenFry on, then set **Edit Websites → Other Websites → Allow**.
4. **Chrome:** click **Open Chrome Extensions**, turn on **Developer mode**, and drag the **ScreenFry for Chrome** tile from the app onto that page.

Both are one-time steps. Apple requires the user to turn a Safari extension on themselves. Google doesn't let any Mac app install a Chrome extension from outside the Chrome Web Store: Chrome 137 removed the `--load-extension` option because malware abused it. So Chrome is loaded from a folder the app maintains.

### Testing on your own Mac (recommended)

`npm run dmg:local` builds the disk image signed with this Mac's Apple Development identity (from Xcode's Accounts settings). Safari lists that build's extension on this Mac without any developer settings, unlike the unsigned CI download. Run it from the project folder, then install the disk image it prints.

### Uninstalling

**ScreenFry → Uninstall…** (also a button at the bottom of the window) offers:
- **Keep Settings:** removes the app, its Safari extension and the Chrome extension folder. Safari and Chrome keep ScreenFry's settings (Safari keeps a web extension's storage, and its on/off choice, after the app is deleted), so a reinstall picks them up.
- **Erase Everything:** first asks ScreenFry in every browser that has connected to wipe everything it keeps: settings, windows, usage and password (the request waits in each browser's bridge folder; the extension picks it up at its next check-in, clears its storage, and in Chrome calls `chrome.management.uninstallSelf()`; the app starts a closed browser in the background). A browser that doesn't answer within 90 seconds gets Try Again or Uninstall Anyway. Safari still remembers that ScreenFry was switched on (that setting lives in Safari and no app can change it), so a reinstall may start switched on, with fresh settings. It then deletes ScreenFry's files, caches and preferences (including the empty preferences file macOS leaves behind) and ejects a still-mounted installer disk. macOS protects the Safari extension's `~/Library/Containers/com.screenfry.ScreenFry.Extension` folder from every app, so Erase Everything selects it in Finder and asks the user to drag it to the Trash. If Chrome doesn't answer within 90 seconds, or the user skips, it opens Chrome's Extensions page so they can click Remove.

### Test builds (no Developer ID)

Releases use the Developer ID secrets below. A release built without them, and any ad-hoc build, is a test build:

- **First open:** macOS says the app can't be verified. Open **System Settings → Privacy & Security** and click **Open Anyway** (once).
- **Safari:** the setup window currently always includes **Settings → Advanced → Show features for web developers**, then the **Developer** tab → **Allow unsigned extensions**. Safari turns unsigned-extension access off when it quits. After enabling ScreenFry, check **Remember for other websites** and choose **Always Allow** when prompted. Builds signed for local development may not need the unsigned-extension setting. The release workflow sets `ScreenFryShowSafariDeveloperSetup` to `false` for Developer ID builds, which removes the development step and renumbers the rest.

## How updates reach everything

| Path | What happens |
| --- | --- |
| **Drag a new download over the old one** | Finder asks to Replace. Bundle identifiers stay the same from 0.6.0 on, so Safari keeps the extension and its settings. (0.6.0 changed them to `com.screenfry.*`, so builds before it start fresh.) On next launch, the app copies its Chrome build into the same folder whenever the build differs (`build.json`'s fingerprint, so rebuilds without a version bump count too). |
| **In-app update** (Sparkle) | The app checks the feed daily and from **Check for Updates…**, then offers the new version. Installing it replaces the whole app, so the Safari extension inside updates too, and the relaunch refreshes the Chrome folder. |
| **Chrome picks it up** | The Chrome extension checks once a minute, and on browser start, whether the version or the build fingerprint (`build.json`, written by `scripts/stamp-build.mjs`) on disk differs from the one it started with, and reloads itself (`reloadIfUpdatedOnDisk` in the background). |

Settings live in each browser's extension storage, keyed to the extension, so updates never reset them. Chrome's extension ID comes from its folder path, which never changes: `~/Library/Application Support/ScreenFry/Chrome Extension`.

The app also warns if another copy of ScreenFry is installed. Two copies register two Safari extensions with the same identity, which makes Safari unreliable.

## Making a release (maintainers)

1. Bump the version: `package.json`, `package-lock.json`, `apps/extension/public/manifest.json`, `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in `safari/ScreenFry/project.yml` (and the generated `project.pbxproj`).
2. In `CHANGELOG.md`, rename `## Unreleased` to `## <version>` and start a new empty `## Unreleased` above it. The workflow refuses to release a version without notes: `scripts/release-notes.mjs` turns that section into the update window's "what's new" (embedded in `appcast.xml`) and the GitHub release notes.
3. Push a tag `v<version>`, or run the **Release** workflow manually from the Actions tab.
4. The workflow tests, builds, signs (ad-hoc or Developer ID), packages the DMG, writes `appcast.xml` when an update key exists, and publishes the GitHub Release.

**Developer ID signing and notarization** use these repository secrets, all set: `DEVELOPER_ID_P12` (the Bhron, LLC "Developer ID Application" certificate and key, base64), `DEVELOPER_ID_P12_PASSWORD`, `APPLE_TEAM_ID`, `APPLE_ID` and `APPLE_APP_PASSWORD` (an app-specific password from account.apple.com). After the Xcode build, `scripts/sign-developer-id.sh` re-signs Sparkle's helpers, the extension and the app from the inside out, with a timestamp, the hardened runtime and no `get-task-allow`. Apple's notary service rejects the app otherwise. If notarization fails, the workflow prints Apple's log. The certificate is valid until December 2027 and lives in the Account Holder's login keychain; only the Account Holder can create a replacement.

To build a disk image locally on a Mac: `npm run build:safari`, `xcodegen generate --spec safari/ScreenFry/project.yml`, build the **ScreenFry** scheme in Release, then `npm run dmg -- <path to ScreenFry.app>`.

## In-app updates (on since 0.7.6)

Sparkle only installs updates signed with ScreenFry's private EdDSA key; the app carries the matching public key (`SUPublicEDKey` in `safari/ScreenFry/project.yml`). The key was made on November 11, 2026 with Sparkle's `generate_keys --account screenfry`: the private key is in Sam's login Keychain (account `screenfry`) and in the repository **secret** `SPARKLE_PRIVATE_KEY`; the public key is also the repository **variable** `SPARKLE_PUBLIC_KEY`. Never commit the private key.

- **The feed** is `appcast.xml` on a fixed release tagged `updates`, refreshed by every signed release (GitHub's `releases/latest` link skips pre-releases, so it can't be used while releases are pre-releases).
- **The app** lives in the menu bar (closing its window keeps it running there, without a Dock icon) and starts at login, so it checks every hour, and from **Check for Updates…**. When it finds a newer version the menu bar icon turns orange and the menu offers it. With **Install updates automatically** on, it downloads the update and installs it right away, closing and reopening in the menu bar, instead of Sparkle's default of waiting for a quit, which a menu bar app hardly ever does. While its window is open, background checks wait (so it never restarts under you, and never sits on a downloaded update, which stops Sparkle noticing newer ones); closing the window checks at once. **Check for Updates…** and the menu's **Update to …** always respond: they install an update already downloaded, or open Sparkle's window with the version's notes, a download bar and Install and Relaunch. After any update, ScreenFry checks again a few seconds after reopening, so a version released meanwhile follows straight away. The feed's newest version is always the one offered, so an old copy goes to the latest in one update. **Start at login** is on the first time it runs from Applications and can be turned off in the window or the menu bar menu; Uninstall removes it.
- **Users on 0.7.5 or earlier** have no key, so they need one manual download to reach an updating build.
- To replace the key: run `generate_keys --account screenfry` (and `-x file` to export), update both repository entries and `SUPublicEDKey`, and ship one release manually, since older builds only trust the old key.

## Later: Apple Developer ID (removes the test-build steps)

With an Apple Developer Program membership, create a **Developer ID Application** certificate. Then add these repository secrets: `DEVELOPER_ID_P12` (base64 of the exported .p12), `DEVELOPER_ID_P12_PASSWORD`, `APPLE_TEAM_ID`, plus `APPLE_ID` and `APPLE_APP_PASSWORD` (an app-specific password) for notarization. The Release workflow then signs, notarizes and staples automatically. Safari 18.4 or newer accepts Developer ID–signed, notarized extensions without developer settings.

## Later: Chrome Web Store

An unlisted Web Store listing would give one-click Chrome installs and automatic updates. The app's Chrome card could then link to the listing instead of the folder. Store-installed copies skip the folder reload check (`installType` isn't `development`).

## Verifying signing before shipping

After a signed build, run `node scripts/verify-macos-signing.mjs <path/to/ScreenFry.app>`. A recursive `codesign --verify` alone can accept an ad-hoc app that dyld rejects under hardened library validation. The guard checks that hardened apps have a Team ID and matching embedded framework teams. Both the signed-download CI job and Release workflow run it. See [Mac app review](MAC_APP_REVIEW.md) for the confirmed 0.5.0 launch failure and local repair.

For local hardened development builds, sign with Apple Development rather than an ad-hoc identity. Public releases need Developer ID signing and notarization; the workflow's non-hardened ad-hoc branch is a test-download configuration.

Moving an existing unpacked Chrome install from `dist/chrome` to the app-managed folder is a one-time installation change with a different path-derived ID. Settings transfer from that older developer install is not automatic. The stable folder preserves settings for subsequent app-managed updates.

## Setup feedback and illustrations

Chrome's drag tile also reveals the extension folder when clicked. An accepted file drop changes the status to **Folder dropped — confirm below**; it does not prove Chrome installed the extension (Finder can also accept the folder). The checkbox records the user's confirmation that ScreenFry appears in Chrome, and can be unchecked to reset that confirmation. The app does not read Chrome profiles or claim to detect later removal.

The Developer mode before/after images are actual Chrome screenshots, captured in a disposable profile with `node scripts/capture-chrome-setup.mjs`. The script touches no everyday browser profiles. They are packaged as native app resources in `SetupImages`.

The browser-request link opens a prefilled GitHub issue for the user to review and submit. Safari's popup permission reminder can be dismissed persistently without altering website permissions or policy settings.
