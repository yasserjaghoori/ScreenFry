# Safari Web Extension packaging

`safari/Screentime` holds a minimal macOS containing app plus a Safari Web Extension target, described by `project.yml` (XcodeGen). The ScreenFry containing app only tells the user how to enable the extension and shows whether Safari reports it as enabled. It is not the Phase 2 macOS app.

Requirements: macOS 13+, Xcode 16+, [XcodeGen](https://github.com/yonaskolb/XcodeGen), and an Apple Developer team for signed builds.

```bash
npm ci
npm run build:safari                 # copies dist/chrome into "Screentime Extension/Resources"
cd safari/Screentime
xcodegen generate                    # only needed after changing project.yml or top-level resource files
open Screentime.xcodeproj
```

Choose a signing team for both targets, then run the **Screentime** scheme, which produces **ScreenFry.app**. For unsigned local testing, turn on Safari ▸ Settings ▸ Advanced ▸ _Show features for web developers_, then Develop ▸ _Allow Unsigned Extensions_.

To check it compiles without signing:

```bash
xcodebuild -project Screentime.xcodeproj -scheme Screentime CODE_SIGNING_ALLOWED=NO build
```

The generated extension `Resources/` directory is not versioned. Always run `npm run build:safari` before generating or opening a fresh checkout in Xcode.

## Background execution

`npm run build:safari` copies the verified Chrome build and runs `scripts/prepare-safari.mjs`. Chrome keeps its MV3 module service worker; Safari receives a nonpersistent module background page (`background.scripts`, `type: module`, `persistent: false`). The JavaScript implementation is shared. The package verifier checks the Safari entry and background mode, in addition to icons, sandbox entitlements, attribution and version.

This packaging was introduced after Safari reported that its background content failed to load. Use Safari's Extensions settings and background-content diagnostics to verify runtime loading; a signed build alone does not establish that it is running. Network rules use schema string values, rather than Chrome-only runtime enum objects. Navigation builds a static resource URL first, then appends encoded query/fragment components.

## Packaging details

- Safari reads `manifest.json` from the root of the appex `Contents/Resources`. The top-level files are added individually; `assets/` and `icons/` are folder references so manifest paths remain intact.
- The extension declares transparent monochrome toolbar PNGs and colored extension PNGs. The containing app uses a native AppIcon asset catalog. Color icons use the supplied melting-monitor artwork; toolbar icons use a matching monochrome outline. See [Branding](../assets/branding/README.md). Regenerate all PNGs with `npm run icons` (`scripts/generate-icons.mjs`, any OS); generated images are committed so CI needs no graphics tools. The containing app is named ScreenFry (`ScreenFry.app`) but keeps the `com.screentime.*` bundle identifiers so Safari keeps its existing registration and settings. It also bundles `BrandIcon.png` and sets it as the Dock icon at launch, so a stale icon cache cannot show the generic placeholder.
- Both targets have the App Sandbox entitlement. The handler implements `NSExtensionRequestHandling`. Native messaging is unused in Phase 1.
- Network rules require `declarativeNetRequestWithHostAccess` plus granted host access in Safari. The shared manifest uses that permission, which Chrome also supports. Both package verifiers check it. See [Apple's content-blocking documentation](https://developer.apple.com/documentation/safariservices/blocking-content-with-your-safari-web-extension).
- Sandbox properties must be declared in `project.yml`, as well as the generated entitlement files. XcodeGen otherwise rewrites those files as empty dictionaries. CI runs `scripts/verify-safari.mjs` after the build to catch this.
- Bundle IDs are `com.screentime.Screentime` and `com.screentime.Screentime.Extension`. Change them in `project.yml` to match your team.

For a local signed development build, select your Apple development team in Xcode or pass signing options to `xcodebuild`. Keep signing identities out of version control. Build outside iCloud-synced directories when Finder metadata interferes with signature validation, and verify the resulting bundle with `codesign --verify --deep --strict` before installation. Keep one installed containing app to avoid duplicate Safari extension registrations.

For local updates, quit the containing app and update the installed bundle in place rather than repeatedly launching copies from DerivedData. Safari may temporarily drop the toolbar item while registrations change. Reopen the installed containing app and check its enabled status, then verify the toolbar on a normal website. Development updates still require checking that existing choices survived.

## Behaviour differences from Chrome

| Area                   | Safari behaviour                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private Browsing check | No API. Coverage is confirmed only after Screentime sees one of its tabs in a Private window. It can't detect the setting being turned off later. |
| Usage                  | Focused active tab plus reported background audio/video playback. Safari has no `idle` API.                                                       |
| Network blocking       | Network rules cover embedded frames only. Whole pages (blocked sites, Shorts/Reels links) go to the ScreenFry blocked page through the background's tab navigation, requested by tab updates and the content script, to avoid the browser's network-block error page. This routing has isolated Chrome coverage with page rules disabled, but is not yet verified in live Safari. |
| State                  | Separate from Chrome. Usage, rules and optional settings password aren't shared in Phase 1.                                                       |

Safari runtime behaviour is not verified in CI. The current native installer launches and reports Safari enabled. The user confirmed the popup opens consistently after reload, while broader live Safari enforcement acceptance remains incomplete. See `TESTING.md` and `MAC_APP_REVIEW.md`; use an isolated environment for further performance diagnosis.
