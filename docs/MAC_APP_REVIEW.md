# ScreenFry Mac app review and launch handoff

Reviewed November 7, 2026, source through `b541dd3`, version 0.5.0/build 20. This is a browser-extension installer/updater app; policy and time accounting still run in the extensions.

## Confirmed launch failure

The local `screenfry-crash.txt` already contains the latest ScreenFry crash export and macOS version requested by Claude. It is ignored by Git because the raw report contains machine identifiers and user paths. Do not commit it.

The report identifies a **dyld library-validation failure**, before application startup:

```text
Termination: DYLD / Library missing
Library not loaded: @rpath/Sparkle.framework/Versions/B/Sparkle
Reason: mapping process and mapped file (non-platform) have different Team IDs
```

Sparkle is present in the installed app. The failing app and framework were ad-hoc signed, and the app had the hardened-runtime flag enabled with no Team ID. The “Library missing” heading does not mean the framework was absent. Sparkle is a mandatory linked dependency even when its updater is disabled by an empty public update key.

This matches [Sparkle's documented development-signing requirement](https://sparkle-project.github.io/documentation/) and [Apple's library-validation rules](https://developer.apple.com/documentation/BundleResources/Entitlements/com.apple.security.cs.disable-library-validation). For local development, use an Apple Development identity for the app and embedded framework. For public distribution, use Developer ID signing and notarization. Claude's `b541dd3` already selects a non-hardened configuration specifically for ad-hoc CI/test downloads; that change does not repair an older downloaded app in place.

## Repair and checks

- Rebuilt the current app with an available local Apple Development identity, **retaining hardened runtime and library validation**. No signing identities were written into source.
- Installed the repaired build at `/Applications/ScreenFry.app`, preserving the prior crashing copy in Trash. Strict recursive signature/package checks pass, and the app and embedded framework have matching signing teams.
- Added `scripts/verify-macos-signing.mjs` to the signed-download CI job and Release workflow. It rejects the exact ad-hoc-plus-hardened configuration of the failed app and checks embedded framework teams for hardened builds. The old installed app failed this check; the repaired build passes.
- The tracked Xcode project was stale: it omitted the new installer Swift files, Chrome resources and Sparkle package reference from `project.yml`. Regenerated it and retained the Swift package resolution so opening the checked-in project includes the native installer implementation.
- `npm ci`, `npm run check`: **89 unit tests**, typecheck and verified build pass. Isolated Chrome integration: **46 passed, zero failed**. Native launch results are recorded in `TESTING.md`.

## Installation cleanup

Moved the two old Screentime 0.3.0 application bundles and two standalone extension bundles from `dist/safari` and `dist/safari-signed` to Trash, after unregistering their application/extension paths. No app bundles remain in the ChatGPT project folder. Source and the user's duplicate Xcode projects were preserved.

Ejected the mounted `ScreenFry-0.5.0.dmg` after installing the app. The app's duplicate-copy notice then disappeared. The installed Safari extension has one registered copy at `/Applications/ScreenFry.app`.

## Remaining product work

- In-app updates are intentionally disabled until a Sparkle public signing key is configured and releases include a signed feed. The disabled update button is expected.
- The new app-managed Chrome folder is stable **after** the one-time move to `~/Library/Application Support/ScreenFry/Chrome Extension`. An earlier unpacked install from `dist/chrome` has a different path-derived extension ID; the current installer does not migrate its settings or disable the old Chrome entry. Keep this distinction clear in setup instructions and investigate an explicit migration flow before promising existing developer-install settings transfer. No installed browser settings were read or changed during this review.
- Native launch and package checks do not establish a full Safari policy/playback acceptance pass. The user previously confirmed that the 0.4.8 popup opens consistently; preserve that result without extending it to unrelated behavior.
