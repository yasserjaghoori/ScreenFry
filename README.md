# ScreenFry

<img src="apps/extension/public/icons/icon-128.png" width="96" height="96" alt="ScreenFry melting clock monitor logo" />

ScreenFry is a Chrome and Safari extension for using social websites with fewer distractions. It combines feed and button controls with per-website daily allowances and recurring allowed-time windows.

This is a development build. Chrome fixture coverage and Safari runtime acceptance are tracked separately in [Testing](docs/TESTING.md); Safari acceptance is not complete.

The GitHub repository, npm package, Xcode scheme and internal browser identifiers retain the name **Screentime**. The user-facing product and macOS app are **ScreenFry**.

## Website controls

The initial sites are **YouTube, Instagram, X, Reddit and Substack**. Choose a website to adjust its own feed, navigation, playback and time-limit controls. The popup provides the same site controls; the dashboard adds a Today usage summary and separate Windows and Settings pages. Light and dark themes are available.

- Hide selected feeds, recommendations, comments or navigation buttons. Search, messages, profiles and direct content remain available unless another selected control restricts them.
- Set a separate daily allowance for each website, or choose no limit. Exhausting the allowance blocks the entire website, including already-open tabs.
- Enable **Block Shorts entirely** for YouTube or **Block Reels entirely** for Instagram. Recognized direct routes and in-page players are blocked and playback is paused. X, Reddit and Substack also have independent video-playback controls.
- Optionally protect changes with a settings password. The password authorizes edits; it does not grant additional browsing time. A fresh installation starts unrestricted.

## How time and windows work

Time counts while a website is the active tab in the focused browser window, and while its audio or video actually plays in a background tab, including muted video. An inactive, non-playing tab does not count. Simultaneous tabs on the same website count once per elapsed second. Each browser keeps its own daily usage, resetting at local midnight.

On the **Windows** page, create one or more recurring windows and whitelist websites for each. Listed websites are blocked outside all their enabled windows, even with unused daily time. Unlisted websites retain their normal controls. Multiple matching windows combine and share the website's single daily allowance; overnight windows are supported.

For example, YouTube with a 10-minute allowance and noon–1 p.m. plus 6–8 p.m. windows gets **10 minutes total per day**, usable in either window. It is blocked at 3 p.m.

## Build and install

Use the Node version in `.nvmrc`:

```bash
nvm use
npm ci
npm run build
```

### Chrome

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/chrome`. Enable ScreenFry and grant the website access needed for its controls. After rebuilding, use **Reload** on its extension card to load the new files. Enable **Allow in Incognito** separately if desired.

### Safari on macOS

Install Xcode and XcodeGen, then run from the repository root:

```bash
npm run build:safari
xcodegen generate --spec safari/Screentime/project.yml
```

Open `safari/Screentime/Screentime.xcodeproj`, select the **Screentime** scheme, configure signing for both targets and build. The containing app is **ScreenFry.app**, with an embedded **ScreenFry Extension.appex**. Enable ScreenFry in Safari Settings → Extensions and grant website access. Private Browsing access is a separate Safari setting.

See [Safari setup](docs/SAFARI.md) for command-line builds and packaging checks. Keep one installed containing app. When upgrading from Screentime.app, preserve the internal bundle identifiers, quit the old containing app, back it up and replace/rename the installation safely rather than leaving two registered copies.

## Development and verification

```bash
npm run check       # unit tests, typecheck and verified Chrome build
npm run test:e2e    # isolated Chrome browser integration tests
npm run icons       # regenerate extension and native app icons
```

Builds and integration tests share `dist/chrome`; run them sequentially. The browser tests use local fixtures and disposable profiles. They do not establish that every selector works on today's signed-in websites or that Safari runtime behavior passes. Current results and unfinished acceptance checks belong in [Testing](docs/TESTING.md), rather than installation-specific claims in this README.

## Privacy and limitations

The extension stores settings and usage locally. It measures time only on sites with rules; it does not keep general browsing history. It has no account, backend, analytics or API key. Chrome and Safari do not share settings, passwords or allowances.

Website markup changes can break selectors. A video reached through a normal watch/embed URL without short-form signals cannot always be identified as a Short. Opaque media players may need additional support. Browser permissions must remain enabled, and the extension cannot prevent disabling or removal. See [Enforcement limits](docs/THREAT_MODEL.md).

The interface is informed by [SocialFocus](https://socialfocus.app). Selected feed selectors are adapted from [Saner Social Media](https://github.com/tobiasdalhof/sanersocialmedia), with its full MIT notice bundled in both browser builds. SocialFocus source code and assets are not included.

[Branding](assets/branding/README.md) · [Project brief](docs/PROJECT_BRIEF.md) · [Development setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Testing](docs/TESTING.md) · [Privacy](docs/PRIVACY.md) · [AI handoff](docs/AI_HANDOFF.md)
