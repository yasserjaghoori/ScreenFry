# Safari Web Extension packaging

The `safari/Screentime/project.yml` source describes a minimal macOS containing app plus Safari Web Extension target. It intentionally does not implement the Phase 2 native app.

Requirements: macOS, Xcode 16 or newer, an Apple Developer signing team, and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
npm install
npm run build:safari
cd safari/Screentime
xcodegen generate
open Screentime.xcodeproj
```

Select a signing team for both targets and run the containing app. Choose **Open Safari Settings**, enable Screentime, and grant website access. Enable Private Browsing access manually in Safari's extension settings if offered by the installed Safari version, then follow `docs/TESTING.md`.

The generated WebExtension resources use the same Manifest V3 code as Chrome. Safari performs its own manifest conversion/validation during the Xcode build. API differences belong in `packages/browser-adapters`; Phase 1 state is not synchronized between browsers.
