# Screentime

A Chrome and Safari extension that combines feed removal and SocialFocus-style website controls, with daily allowances and allowed time windows.

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

## Docs

[Project brief](docs/PROJECT_BRIEF.md) · [Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Testing](docs/TESTING.md) · [Privacy](docs/PRIVACY.md) · [Enforcement limits](docs/THREAT_MODEL.md)

Feed selectors depend on website markup. Runtime testing on real signed-in websites and Safari is still needed. The extension cannot prevent removal or enforce settings in another browser or profile.
