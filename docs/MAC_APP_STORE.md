# ScreenFry on the Mac App Store

The Mac App Store edition is the official ScreenFry (Chrome's extension from the Chrome Web Store), built App Store–safe. It ships alongside the download, not instead of it: the download (ScreenFry and ScreenFry Developer, docs/DISTRIBUTION.md) keeps Sparkle and the Developer mode choice. It ships together with the Chrome Web Store extension and the two-choice installer (docs/NEXT.md).

## How it differs from the download

| | Download (Developer ID) | Mac App Store |
| --- | --- | --- |
| Xcode target | `ScreenFry` (+ `ScreenFry Extension`) | `ScreenFry App Store` (+ `ScreenFry App Store Extension`) |
| `ScreenFryChannel` | `official` / `developer` | `appstore` |
| Sandbox | Safari extension only | App and Safari extension (required) |
| Updates | Sparkle (`#if canImport(Sparkle) && !APPSTORE`) | The App Store; no update controls |
| Chrome | Web Store, or the unpacked folder (Developer) | Web Store only; no `ChromeExtension` folder in the app |
| Safari bridge (check-ins, loadouts, reset, erase) | The extension's container, read by the app | The App Group `9Y9WU7573A.com.screenfry.ScreenFry` (`SettingsBridge.safari()`), since a sandboxed app can't read another container |
| Chrome bridge | `~/Library/Application Support/ScreenFry/Bridge/Chrome` | The same path inside the app's container; Chrome starts the app's binary as the native messaging host, which runs in the same sandbox and container |
| Chrome's native messaging manifest | Written to `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` | Written there through one temporary exception entitlement (below); allows only the Web Store extension |
| Uninstall | Moves itself to the Trash | Wipes data, then asks to be dragged to the Trash (a sandboxed app can't move itself) |
| Switch to Developer/Official | In the app menu | Not offered |

Both use the bundle identifiers `com.screenfry.ScreenFry` and `com.screenfry.ScreenFry.Extension`, so macOS and Safari see one ScreenFry; the app warns if both are installed.

## Entitlements (`ScreenFry AppStore.entitlements`, generated from `project.yml`)

- `com.apple.security.app-sandbox`
- `com.apple.security.application-groups`: `9Y9WU7573A.com.screenfry.ScreenFry` (also on the extension)
- `com.apple.security.temporary-exception.files.home-relative-path.read-write`: `/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. Chrome finds native messaging hosts only through a file in that folder, so without it ScreenFry in Chrome couldn't check in, receive loadouts or be erased. Explain it in the review notes (store/mac-app-store.md). Other Mac App Store apps with Chrome extensions (Bitwarden) do the same. If App Review refuses it, the fallback is an App Store build without the Chrome connection (the Chrome card only links to the Web Store), with Chrome loadouts done through share codes.

No network entitlement: the app opens web pages through the browser and fetches nothing itself.

## Tested (November 12, 2026)

- The `ScreenFry App Store` scheme builds, signed (Apple Development, team 9Y9WU7573A) and unsigned; `scripts/verify-safari.mjs` checks it (no Sparkle, no folder, no feed, sandboxed, same App Group in app and extension).
- Run as Chrome's native messaging host, the sandboxed binary answers a check-in.
- Run as the app (a copy with its Safari extension removed, so it couldn't disturb the installed ScreenFry), it stays up in the sandbox and writes Chrome's manifest into the real `~/Library` through the exception.
- `npm run appstore` archives and exports it, signed for the App Store ("3rd Party Mac Developer Installer: Bhron, LLC"; Xcode created that certificate and the "Mac Team Store Provisioning Profile" once signed in).
- The app exists in App Store Connect (**ScreenFry**, macOS, Apple ID `6834149513`, SKU `screenfry-mac`), and build 1.0.0 (45) was uploaded with `xcodebuild -exportArchive` (destination upload) on November 12, 2026. Its App Information (subtitle, Productivity / Utilities) and version page (description, promotional text, keywords, URLs, copyright, review notes, version 1.0.0) are filled in from store/mac-app-store.md.

Not yet: the Safari extension and app meeting in the App Group on a real install (TestFlight), App Review.

### Still to do in App Store Connect (Sam)

App Store Connect's pages mostly load in Claude's built-in browser at a desktop width (open the version page from inside the app, not by its address); the Business page doesn't, and it can't attach files.

- **Business:** accept the updated Paid Applications Schedule (Account Holder), which App Store Connect asks for before submitting new apps.
- **Screenshots:** drag the five 1280×800 images from `dist/store` (`npm run store:images`) onto the version's Mac screenshots; ideally add one of the Mac app's window.
- **Declarations** (yours to make): App Privacy → Data Not Collected; Age Rating questionnaire (none apply → 4+); Content Rights (ScreenFry changes how third-party websites display in your own browser but contains or shows none of their content itself).
- **App Review contact:** name, phone and email.
- **Pricing and Availability:** Free, all regions.
- **TestFlight:** once the build finishes processing, install it with the TestFlight app on a Mac. It replaces the download's ScreenFry (same bundle ID); its Safari extension then uses the App Group bridge, so check the Safari card shows connected, Chrome check-ins, and Use in All Browsers. Reinstall the download afterwards.

## Releasing

1. Xcode → Settings → Accounts: signed in with an Apple Account on Bhron, LLC (Account Holder or Admin).
2. App Store Connect has the app (store/mac-app-store.md has the listing).
3. `npm run appstore -- upload` archives, signs and uploads the version in `project.yml` (`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`, bumped with every release; the build number must grow with each upload).
4. In App Store Connect, try it with TestFlight, then submit it for review with the same version's download and Chrome Web Store extension.

## Later

- The release workflow could upload it too (an App Store Connect API key as secrets, plus the Apple Distribution and Mac Installer Distribution certificates).
- iPhone and iPad: a Safari web extension in an iOS app, from the same extension code. A separate project, which this edition (sandboxed, App Group bridge) prepares for.
