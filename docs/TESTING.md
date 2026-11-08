# ScreenFry testing

```bash
npm run check
npm run test:e2e
npm run build:safari
xcodegen generate --spec safari/Screentime/project.yml
xcodebuild -project safari/Screentime/Screentime.xcodeproj -scheme Screentime \
  -configuration Debug -derivedDataPath dist/safari CODE_SIGNING_ALLOWED=NO build
node scripts/verify-safari.mjs dist/safari/Build/Products/Debug/ScreenFry.app
```

Unit tests cover allowances, zero/unlimited budgets, aliases, allowed-window union, weekday and overnight windows, DST, combined next access, playback URL decisions, optional-password authorization, migration and deduplicated multi-tab accounting.

The Chrome integration test uses a throwaway profile and protocol-served local fixtures under the launch sites' origins. It checks real controls, network redirects, in-page/notification routes, media playback reporting, optional-password protection and privileged-message rejection. A small generated WebM fixture exercises actual muted video playback. No everyday browser profile or installed extension settings are changed. Local runs write screenshots under `dist/screenshots` for visual review. CI skips supplemental screenshot capture to avoid compositor timing failures; set `CAPTURE_E2E_SCREENSHOTS=1` to request captures there. Browser startup has a separate readiness wait and bounded timeout.

Do not run a build while the integration test is using `dist/chrome`.

## Current verification — 0.4.6, November 7, 2026

- Reviewed and fast-forwarded Claude's `b8fe2c0`, `41dc7c8` and `390102b`: coalesced background work, skipped unchanged state writes/rule installs, idle unrelated frames, faster boundary-based forecasts, Safari top-level blocked-page messaging, rule-only usage and the shared site registry. These changes have automated coverage; their live Safari behavior is still unverified.
- Replaced the earlier clock logo with Sam's supplied melting-monitor artwork. The metadata-cleaned source has exactly the same RGBA pixels as the attachment. Regenerated color extension/UI/favicon assets, native AppIcon and Dock/setup fallback, plus the corresponding monochrome toolbar mark. Visually checked exports against light/dark backgrounds and the installed native setup window.
- Node **24.14.0**, `npm ci` (zero vulnerabilities), `npm run check`: **84 unit tests**, typecheck and verified build passed. `npm run test:e2e`: **44 passed, zero failed**, including style-removal responsiveness, direct/SPA/modal short-form blocking, limits/windows, background muted playback and password authorization.
- Signed **ScreenFry.app 0.4.6, build 15** built successfully and was installed in place. Built and installed bundles passed strict recursive signature and Safari package verification. One persistent Safari extension registration remains; unrelated duplicate Xcode projects were preserved.
- Chrome's native extension-management page confirmed **0.4.6 enabled** after Reload. Live YouTube search returned result headings, and a direct Shorts URL reached the blocked destination with the original URL preserved. Only navigation metadata was inspected at the blocked extension page. The test tab was closed.
- **Safari remains disabled**, confirmed by the installed containing app. This update did not repeat the earlier everyday-profile Safari performance test. The corrected packaging and automated coverage do not prove live Safari responsiveness or blocked-page routing; those remain acceptance work in an isolated environment first.

The 0.4.2 and earlier results below are historical. For current source behavior see the architecture and privacy documents; do not infer a live Safari pass from a successful build.

## Historical verification — 0.4.2, November 7, 2026

- Synced Claude's `877f8f7` and `2e78a48`: the ScreenFry rename, ember theme, Today summaries, popup site buttons, native clock fallback, broader Shorts navigation selectors and isolated-world lookup fix.
- Node 24.14.0 / `npm ci` succeeded. The final `npm run check` passed **70 unit tests**, typecheck and verified build. The final isolated Chrome suite passed **44 checks**, including a new style-removal responsiveness regression.
- **Freeze reproduced and regression-tested:** against the old 0.4.1 content script, a fixture repeatedly removing the injected style prevented a normal page timer from firing; the integration call timed out after 20 seconds. The 0.4.2 content script coalesces mutations into 50 ms macrotasks, ignores its own style-text changes and observes DOM mutations only on supported social sites. The same fixture's 200 ms timer now completes below the 1.5-second limit. Playback-event pausing remains synchronous; policy/storage/timer enforcement remains active on other domains.
- The signed **ScreenFry.app 0.4.2, build 11** was built and installed at `~/Applications/ScreenFry.app`. Both built and installed bundles pass strict recursive signature and package verification. The original Screentime.app was renamed/replaced with a backup; unrelated duplicate Xcode projects were preserved.
- Chrome's extension-management page confirms **0.4.2 enabled** after the final Reload. Live YouTube search returned result headings, the homepage remained usable with no Shorts/Notifications entry in its accessibility tree, and a direct Shorts URL reached the blocked URL with its original destination preserved. Only URL metadata was inspected at that extension-page destination. Test tabs were closed.
- Safari 0.4.0 showed hidden home/Notifications/Shorts controls and ordinary search results. A direct Shorts route produced a user-confirmed invalid-address error. Later extension reloads exposed a background-content load failure. Safari packaging now selects a nonpersistent module background page, and network rules use portable schema strings. Safari was observed enabled with background content loaded during 0.4.1 testing.
- **Safari performance acceptance failed:** the user reported a very slow browser, had to force quit it, then disabled ScreenFry and reported a substantial recovery. Safari is intentionally **left disabled** after installing 0.4.2. The isolated regression validates the specific starvation fix, but does not establish that all Safari performance/redirect issues are resolved. The user authorized a controlled one-page retest. On build 10, YouTube home and ordinary search became responsive (roughly 3.5 and 2.7 seconds), but the direct Shorts route remained unverified. Build 11 changes Safari network actions to block requests rather than cross-scheme regex redirects, retaining tab/content notice routing. During the final direct-route retest, Safari stayed in a loading state without a confirmed blocked destination; native input was also interrupted by detected interaction. Reloading the extension did not establish a successful result. ScreenFry was disabled again, its native setup app confirmed it off, and our test tabs were closed. Do not treat limited normal-page improvement as complete Safari recovery.

Remaining acceptance includes final Safari performance/Shorts recovery, real-profile allowance exhaustion/windows, private browsing, all five sites' current signed-in selectors, opaque players, restart/sleep/midnight and time-zone behavior. Older dated notes below are historical, not current installed state.

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

## Paused follow-up — source 0.3.2

Before the user's restart request, `npm run check` passed all 63 unit tests and the build. A subsequent isolated Chrome run against 0.3.2 finished with 43 passed, zero failed. The signed Safari 0.3.2 build also completed successfully in `/tmp/screentime-safari-icons`; it was not installed, and that build's signature/package verification and live acceptance were not completed.

The local change uses `declarativeNetRequestWithHostAccess`, required by Apple for Safari redirects, and adds permission checks to both packaging verifiers. This is a confirmed manifest/documentation mismatch, not a confirmed diagnosis of the blank Safari tab. Further native Safari attempts were interrupted by concurrent input, a lost window connection and the user's pause. Do not infer successful navigation or blocking from those attempts. Resume from `AI_HANDOFF.md` after the restart when requested.

## Post-restart follow-up — November 7, 2026

Node 24.14.0 and `npm ci` succeeded. `npm run check` passed 63 tests, typecheck and build; the isolated Chrome suite finished 43 passed, zero failed. Safari 0.3.2 was rebuilt under `/tmp/screentime-safari-032`, signature/package-verified, installed in place and verified again. Its containing app reported enabled; one persistent 0.3.2 extension copy was registered.

Live Chrome showed the hidden YouTube feed/Notifications. Clicking the still-visible Shorts navigation entry reached a blocked URL labeled YouTube Shorts. The bare `/shorts` navigation selector remains a follow-up. Safari's clock and homepage hiding survived reboot before the update. After the update, direct Shorts and ordinary search attempts stayed in loading states without verified destination/content; these checks remain inconclusive. Test tabs were closed. No automated access to the previously denied installed-extension settings was attempted.
