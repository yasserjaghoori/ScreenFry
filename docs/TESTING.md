# Testing

```bash
npm run check
npm run test:e2e
npm run build:safari
xcodegen generate --spec safari/Screentime/project.yml
xcodebuild -project safari/Screentime/Screentime.xcodeproj -scheme Screentime \
  -configuration Debug -derivedDataPath dist/safari CODE_SIGNING_ALLOWED=NO build
node scripts/verify-safari.mjs dist/safari/Build/Products/Debug/Screentime.app
```

Unit tests cover allowances, zero/unlimited budgets, aliases, allowed-window union, weekday and overnight windows, DST, combined next access, playback URL decisions, optional-password authorization, migration and deduplicated multi-tab accounting.

The Chrome integration test uses a throwaway profile and protocol-served local fixtures under the launch sites' origins. It checks real controls, network redirects, in-page/notification routes, media playback reporting, optional-password protection and privileged-message rejection. A small generated WebM fixture exercises actual muted video playback. No everyday browser profile or installed extension settings are changed. Local runs write screenshots under `dist/screenshots` for visual review. CI skips supplemental screenshot capture to avoid compositor timing failures; set `CAPTURE_E2E_SCREENSHOTS=1` to request captures there. Browser startup has a separate readiness wait and bounded timeout.

Do not run a build while the integration test is using `dist/chrome`.

## Manual browser acceptance

1. Load the extension, open Websites, and confirm YouTube, Instagram, X, Reddit and Substack are available without a PIN. Fresh settings should not block anything until enabled.
2. Try feed and button toggles independently. Confirm direct posts, search, messages and author pages remain usable unless their relevant setting is enabled.
3. Give YouTube a 1-minute allowance. Confirm focused usage counts, background muted video/audio counts, and an inactive paused tab does not count. Two playing YouTube tabs must not consume two minutes per elapsed minute.
4. Add two Windows entries containing YouTube. Confirm access in either window, full-site blocking outside both, and one shared daily budget. Check other sites remain unaffected unless listed. Try overnight and weekday-specific windows.
5. Enable Shorts/Reels blocking. Open from home/search, a notification, a direct link and a profile/modal, including SPA navigation. Confirm playback is suppressed rather than opened in the normal player. Verify regular videos/direct posts still work.
6. Enable an optional settings password. Reload the dashboard/popup, confirm edits need it, then turn it off using the correct password. It must not grant extra access time.
7. Enable Chrome Incognito and Safari Private Browsing permissions if desired, then repeat the checks there. Safari's status must state its observation limit.
8. Sleep/wake, restart the browser, cross midnight and change time zone. Confirm persisted usage, local-window semantics and reasonable gap accounting.

The automated fixtures validate known routes and markup, not the current DOM of every real website. Real signed-in pages, Substack selectors, opaque players and Safari runtime still require the manual checks above.

## Local installation check — November 7, 2026

Chrome loaded version 0.3.0 and displayed its welcome and website controls. Safari loaded a locally development-signed version 0.3.0, reported it enabled, and confirmed website access. Existing feed-blocking extensions were disabled for the requested comparison.

This check found and fixed XcodeGen clearing the sandbox entitlement dictionaries. The corrected bundle passes strict recursive signature verification and the packaging verifier. A single persistent Safari installation remains registered.

After the user enabled YouTube controls, Chrome's real signed-in homepage reported `display: none` for both the home feed and Notifications renderer. A direct `/shorts/` navigation redirected to Screentime's blocked URL (URL metadata only; extension contents were not inspected).

Safari was updated to a locally signed 0.3.1 with a native app icon and monochrome toolbar clock. The installed app passed strict signature and packaging checks, reported enabled, and the toolbar exposed a visible button named Screentime. On the public YouTube homepage, the home feed and Notifications button were absent after the update. A subsequent direct Shorts test reached a blank loading tab without a verifiable destination, so Safari's live short-form redirect remains unverified.

The automation tool rejected access to extension-internal settings pages, so settings were enabled manually by the user. Live time-limit exhaustion, Windows and the remaining site controls still need manual acceptance. The isolated Chrome integration checks above are separate evidence. The toolbar icon does not change the tool's extension-page access restriction.
