# ScreenFry next: store extensions, two-way installer, community

This branch (`dev/next`) holds work that isn't ready for the public release. `main` stays the released app: bug fixes land on `main` and ship through the update feed, and this branch merges `main` in regularly to keep them. A feature merges into `main` through a pull request when it's ready to ship. The release workflow refuses to run from anything not already on `main`, so nothing here can reach users' automatic updates by accident.

Order of work: **1 → 2 → 3**, then **4 → 5** (they share a backend).

## 1. ScreenFry on the Chrome Web Store

Today Chrome runs ScreenFry as an unpacked extension (Developer mode, dragged in from the app). A Web Store version installs with one click, updates through Chrome, and needs no Developer mode.

- [ ] Sam signs in to the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (account paid for) in Claude's browser when asked.
- [ ] `npm run package:chrome-store` builds `dist/ScreenFry-chrome-store-<version>.zip` from `dist/chrome`. Upload it as a new item, **Unlisted** at first, so it can be tested without being public.
- [ ] Fill in the listing from [store/chrome-web-store.md](../store/chrome-web-store.md): description, screenshots (1280×800), small promo tile (440×280), privacy practices and a reason for each permission. Expect an in-depth review because of `<all_urls>`.
- [ ] Record the store's extension ID. The Mac app's native messaging host only lets the unpacked extension in (`allowed_origins` in `ChromeNativeHost.register`, `SettingsTransfer.swift`): add the store ID, so check-ins, loadouts and Erase Everything work with either.
- [ ] The folder update check (`reloadIfUpdatedOnDisk`) already skips store installs (`installType` isn't `development`). Make sure the stale-background heal (`healStaleBackground`, and the background's version check) also leaves store installs to Chrome's own updates.
- [ ] Settings don't move between the unpacked and store copies (different extension IDs, separate storage). Offer a share code: the app can save the unpacked copy's setup as a loadout and **Use in All Browsers** into the store copy. Write that path down in the app's Chrome card.
- [ ] Once approved, switch the listing to **Public**.

Decide: keep `<all_urls>` (windows and goals accept any website you type) or move typed websites to `optional_host_permissions` and request them when added, which makes review easier and the install prompt less scary.

## 2. Safari

Nothing is needed for an "official" Safari extension: since the Developer ID signed, notarized releases, Safari lists ScreenFry without any developer setting.

- [ ] Optional later: the **Mac App Store** (App Store review, sandboxed app, no Sparkle in that build, App Store handles updates). Worth it mainly for discoverability, and as the start of an iOS/iPadOS Safari version. Keep it a separate build configuration, not a replacement for the direct download.

## 3. Installer with two choices

The disk image offers two ScreenFrys side by side:

- **ScreenFry** (the full-color logo): uses the official extensions. Chrome's card sends you to the Web Store listing instead of Developer mode.
- **ScreenFry Developer** (the greyed logo, `assets/branding/screenfry-developer.png`): today's behavior, with the unpacked Chrome extension that updates the moment the app does. For people who want it, and for testing.

Plan (decide before building):

- [ ] **One app, two flavors**: the same bundle ID and code, with `ScreenFryChannel` = `store` or `developer` in Info.plist (set at build time). Same bundle ID means macOS treats them as one app: the second drag replaces the first instead of installing two copies, and Safari never sees two extensions.
- [ ] The release workflow builds the app twice (only Info.plist, the name and the icon differ), signs and notarizes both, and `scripts/make-dmg.mjs` lays out two icons plus Applications. Both flavors need their own update feed, or a channel in one feed (Sparkle `sparkle:channel`), so each updates to its own flavor.
- [ ] In the app: the channel picks the Chrome card (Web Store link vs. Developer mode steps) and the native host's `allowed_origins`. Show the flavor in the window ("ScreenFry Developer") and allow switching in the menu ("Switch to Official Extensions…").
- [ ] New DMG background (`assets/dmg/background.svg`) with the two choices explained in a line each.

## 4. Setup library and search (community)

Browse and search setups other people share ("YouTube for studying", "no Shorts, 30 minutes of Reddit"), preview what one changes, and apply it to a loadout. Share codes (`SF2-`, settings only) are already the format.

This is ScreenFry's first backend, so it changes the local-first rule for this feature only. **The full plan is in [SETUP_LIBRARY.md](SETUP_LIBRARY.md)**: the API, data schema, code validation, privacy, UI flow, store review, tests and build order.

Decided (Sam, November 12, 2026): an anonymous key for each install to publish (no accounts), setups go live at once and are hidden after 3 reports, Cloudflare Workers + D1 in `services/library` in this repo, and a Library tab on the Share page first (the Mac app later).

- [x] Opt-in and separate: browsing and applying setups needs no key. Publishing, upvoting and reporting make an anonymous key for the install. Nothing about you or your settings is sent unless you publish. The core app keeps working with no network.
- [x] Choose the backend: Cloudflare Workers + D1.
- [ ] Still open: the API's address (workers.dev or a custom domain), the tag list, and the contact shown for reports.
- [ ] Build it in the order in [SETUP_LIBRARY.md](SETUP_LIBRARY.md#build-order).
- [ ] Privacy page, AGENTS.md, README and store listing updates before it ships. Never include usage or history in a published setup.

## 5. Earn leaderboard

Who spent the most time on their Earn goal websites (learning apps, reading, exercise sites) this week.

- [ ] Opt-in, with a display name; only the weekly Earn minutes per goal website are sent (never other websites, never history). Leave any time.
- [ ] Needs accounts or device keys to stop easy cheating: Sign in with Apple or an anonymous key pair per install. Accept that a browser extension can't fully stop faked numbers; keep it friendly (friends' boards, weekly resets).
- [ ] Same backend as the library (Cloudflare Workers + D1, `services/library`), and the same anonymous install keys. UI: a board on the Earn page; the Mac app could show your rank in the menu.

## Working on this branch

- Start each session with `git fetch && git merge origin/main` so bug fixes from `main` are here.
- `npm run check` and `npm run test:e2e` as on `main`. Build the Mac app locally with `npm run dmg:local`; don't run the Release workflow (it refuses anyway).
- Ship a finished piece by opening a pull request from a branch off `dev/next` into `main`, with its `CHANGELOG.md` entry under Unreleased.
