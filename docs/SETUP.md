# Development setup

## Repository and dependencies

```bash
git clone https://github.com/yasserjaghoori/ScreenFry.git ScreenFry
cd ScreenFry
nvm install
nvm use
npm ci
npm run check
npm run test:e2e
```

`.nvmrc` selects the verified Node version. If you do not use nvm, install that Node version with your preferred manager. The extension needs no `.env`, API key, database, or backend. GitHub access is needed to push changes; `gh auth status` checks the local GitHub CLI login.

Run builds and the Chrome smoke test sequentially: builds replace `dist/chrome`, and the smoke test loads that directory into an isolated temporary browser profile. The test does not install the extension into your everyday profile or retain its test password.

## Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the repository's `dist/chrome` directory.
3. Choose your website controls. Password protection is optional in Settings. If private browsing should be covered, enable **Allow in Incognito** in the extension's details and confirm it in Settings.
4. After source changes, rebuild and reload the extension on `chrome://extensions`.

Google Chrome must be installed for `npm run test:e2e`. On macOS its default path is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Set `CHROME_PATH` to use a different compatible browser binary.

## Safari on macOS

Install Xcode and its command-line tools, then install XcodeGen with `brew install xcodegen`.

From the repository root:

```bash
npm run build:safari
xcodegen generate --spec safari/ScreenFry/project.yml
xcodebuild -project safari/ScreenFry/ScreenFry.xcodeproj \
  -scheme ScreenFry -configuration Debug -derivedDataPath dist/safari \
  CODE_SIGNING_ALLOWED=NO build
```

The compiled app is `dist/safari/Build/Products/Debug/ScreenFry.app`. The Xcode scheme and source directories retain the ScreenFry name. An unsigned build proves compilation and packaging; it does not prove the extension is enabled in Safari. For local runtime testing, follow `SAFARI.md` to allow unsigned extensions, or choose your signing team for both targets in Xcode and run the app. Enable ScreenFry, website access, and (if desired) Private Browsing access in Safari. You can optionally protect settings with your own password.

For signed development, open the project:

```bash
open safari/ScreenFry/ScreenFry.xcodeproj
```

Browser permission and private-browsing switches belong to each browser profile. Chrome and Safari do not share their settings, usage or passwords.

## Working together

Start from current `main`, create a feature branch, run the relevant checks, then open a pull request. Do not commit private conversation exports or generated build directories. The GitHub Actions workflow checks unit tests, the Chrome build and smoke test, and an unsigned Safari build on pushes and pull requests. Safari's runtime and real social-media selectors still need the manual checks in `TESTING.md`.
