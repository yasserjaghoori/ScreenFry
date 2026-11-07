# ScreenFry

_Repository and package names still say Screentime; the product is now ScreenFry._

A Chrome and Safari extension that combines feed removal and SocialFocus-style website controls, with daily allowances and allowed time windows.

**Development status, November 7, 2026:** source **0.4.0** renames the product to ScreenFry, adds the ember redesign and a robust macOS Dock icon, and keeps the 0.3.2 Safari redirect-permission correction on `codex/project-setup` in [draft PR #1](https://github.com/yasserjaghoori/Screentime/pull/1). Safari 0.3.2 is installed, signature/package-verified and reports enabled. All 63 unit tests and 43 isolated Chrome integration checks pass. Live Chrome Shorts blocking works; Safari's direct Shorts and search navigation remain inconclusive loading states. See the [complete AI handoff](docs/AI_HANDOFF.md) for requirements, assessment and remaining acceptance work.

## Phase 1 features

- **Five launch sites:** YouTube, Instagram, X, Reddit and Substack.
- **Individual website controls:** hide feeds, recommendations and navigation buttons using grouped toggles. Keep useful search, messages and direct posts unless you choose to hide them.
- **Per-website daily limits:** block the entire website once its allowance is used. Each site has its own budget, shared across tabs and windows, resetting at local midnight.
- **A separate Windows page:** choose recurring days and times, then whitelist websites for that window. A listed website is blocked outside all its enabled windows, even with daily time remaining. Multiple windows combine; they do not restart the allowance. Unlisted websites keep their normal settings.
- **Playback blocking:** enabling YouTube Shorts or Instagram Reels blocking rejects direct links, notification routes and detected in-page short-form players. It never converts them to a normal video player. X, Reddit and Substack also have optional video-playback controls.
- **Usage counting:** the active tab in the focused browser counts, along with background tabs actually playing audio or video. Merely open background tabs do not count. Multiple tabs on the same website count once per elapsed second.
- **Optional settings password:** protects changes to website controls, allowances and windows. No mandatory PIN, temporary access bypass, timed commitment or queued change.
- **Local storage:** no account, backend, API key or analytics. Each browser has its own settings and usage.

## Run

Use the Node version in `.nvmrc`. See [Development setup](docs/SETUP.md) for browser installation.

```bash
npm ci
npm run check       # unit tests, typecheck and Chrome build
npm run test:e2e    # isolated Chrome integration test
npm run build:safari
```

Chrome: open `chrome://extensions`, enable Developer mode, **Load unpacked** and choose `dist/chrome`. Safari: follow [Safari setup](docs/SAFARI.md).

## References and reuse

The interface is informed by the installed SocialFocus extension. Feed selectors are adapted in part from [Saner Social Media](https://github.com/tobiasdalhof/sanersocialmedia); its MIT notice is bundled in the extension's `THIRD_PARTY_NOTICES.txt`. SocialFocus source code and assets are not included.

The product should retain SocialFocus's practical interaction model: choose a website, set its own allowance, and adjust grouped feed/button/playback controls. Allowed windows belong on their own page. The optional password protects changes; it does not grant extra browsing time. The old mandatory PIN, temporary visits and commitment-based product are superseded.

The clock logo includes monochrome toolbar PNGs, colored extension icons and a native Safari containing-app icon. It was visibly present in Safari's toolbar. Regenerate the committed assets on any OS with `npm run icons` (`scripts/generate-icons.mjs`).

## Verification and remaining work

- **Source 0.3.2:** after the restart, 63 unit tests, typecheck/build and 43 isolated Chrome integration checks pass. The signed Safari build and installed bundle pass strict signature and packaging checks; one installed extension copy is registered and its host reports enabled.
- **Previous CI:** GitHub CI passed Chrome tests and unsigned Safari compilation/package checks on 0.3.1. Check PR #1 for the newest run after the 0.3.2 push.
- **Everyday browser checks:** after the restart, Chrome's YouTube home feed and Notifications were hidden, and clicking its Shorts navigation reached the blocked URL. Safari's home feed and Notifications were absent before the 0.3.2 update, and its toolbar clock survived reboot and update. Safari's direct Shorts and ordinary search attempts remained in loading states without a verified destination/content, so Safari playback enforcement and useful-page preservation remain unverified.
- **Open acceptance work:** real-profile limit exhaustion and allowed windows, regular-content preservation, all five sites' signed-in selectors, short-form notification/modal loopholes, private browsing and sleep/clock boundaries. Chrome still displayed a Shorts navigation entry despite blocking its destination; review the bare `/shorts` selector separately.

The 0.3.2 fix replaces `declarativeNetRequest` with `declarativeNetRequestWithHostAccess`, which [Apple requires for Safari redirect rules](https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension). Chrome supports the same permission. This corrects a documented compatibility mismatch; it does not yet establish the cause or resolution of the blank Safari tab.

## Docs

[AI handoff](docs/AI_HANDOFF.md) · [Project brief](docs/PROJECT_BRIEF.md) · [Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Testing](docs/TESTING.md) · [Privacy](docs/PRIVACY.md) · [Enforcement limits](docs/THREAT_MODEL.md)

Feed selectors depend on website markup. Runtime testing on real signed-in websites and Safari is still needed. The extension cannot prevent removal or enforce settings in another browser or profile.
