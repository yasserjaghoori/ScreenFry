# Safari Web Extension packaging

`safari/Screentime` holds a minimal macOS containing app plus a Safari Web Extension target, described by `project.yml` (XcodeGen). The app only tells the user how to enable the extension and shows whether Safari reports it as enabled. It is not the Phase 2 macOS app.

Requirements: macOS 13+, Xcode 16+, [XcodeGen](https://github.com/yonaskolb/XcodeGen), and an Apple Developer team for signed builds.

```bash
npm install
npm run build:safari                 # copies dist/chrome into "Screentime Extension/Resources"
cd safari/Screentime
xcodegen generate                    # only needed after changing project.yml or top-level resource files
open Screentime.xcodeproj
```

Choose a signing team for both targets, then run **Screentime**. For unsigned local testing, turn on Safari ▸ Settings ▸ Advanced ▸ *Show features for web developers*, then Develop ▸ *Allow Unsigned Extensions*.

To check it compiles without signing:

```bash
xcodebuild -project Screentime.xcodeproj -scheme Screentime CODE_SIGNING_ALLOWED=NO build
```

## Packaging details

- Safari reads `manifest.json` from the root of the appex `Contents/Resources`. The top-level files are added individually and only `assets/` is a folder reference, because Vite's hashed file names change every build.
- Both targets have the App Sandbox entitlement. The handler implements `NSExtensionRequestHandling`. Native messaging is unused in Phase 1.
- Bundle IDs are `com.screentime.Screentime` and `com.screentime.Screentime.Extension`. Change them in `project.yml` to match your team.

## Behaviour differences from Chrome

| Area | Safari behaviour |
|---|---|
| Private Browsing check | No API. Coverage is confirmed only after Screentime sees one of its tabs in a Private window. It can't detect the setting being turned off later. |
| Idle detection | No `idle` API. Time counts while the window is focused and the tab is active. |
| Network blocking | Uses `declarativeNetRequest` regex redirects where Safari supports them. If they fail, tab redirects and the content script still enforce. |
| State | Separate from Chrome. Usage, rules and PIN aren't shared in Phase 1. |

Safari runtime behaviour hasn't been verified in CI. See `docs/PHASE1_AUDIT.md`.
