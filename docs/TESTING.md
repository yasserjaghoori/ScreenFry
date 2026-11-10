# ScreenFry testing

```bash
npm run check
npm run test:e2e
npm run build:safari
xcodegen generate --spec safari/ScreenFry/project.yml
xcodebuild -project safari/ScreenFry/ScreenFry.xcodeproj -scheme ScreenFry \
  -configuration Debug -derivedDataPath dist/safari CODE_SIGNING_ALLOWED=NO build
node scripts/verify-safari.mjs dist/safari/Build/Products/Debug/ScreenFry.app
```

Unit tests cover allowances, zero/unlimited budgets, aliases, allowed-window union, weekday and overnight windows, DST, combined next access, playback URL decisions, optional-password authorization, migration and deduplicated multi-tab accounting.

The Chrome integration test uses a throwaway profile and protocol-served local fixtures under the launch sites' origins. It checks real controls, network redirects, in-page/notification routes, media playback reporting, optional-password protection and privileged-message rejection. A small generated WebM fixture exercises actual muted video playback. No everyday browser profile or installed extension settings are changed. Local runs write screenshots under `dist/screenshots` for visual review. CI skips supplemental screenshot capture to avoid compositor timing failures; set `CAPTURE_E2E_SCREENSHOTS=1` to request captures there. Browser startup has a separate readiness wait and bounded timeout.

Do not run a build while the integration test is using `dist/chrome`.

## Research mode, live selector check and Explore freeze — November 9, 2026

- Selectors were checked against the live, signed-in sites in Chrome. Facebook's feed has no `role="feed"` any more (now found by its "Feed posts" heading), its top bar has Reels and Groups rather than Video, and Notifications sits in a wrapper with its unread badge. TikTok video pages moved "You may like" into a tab beside Comments, and suggested accounts are on profile pages. Substack's menu items are labelled links, mostly without addresses, and there is no Notes button. X's "Today’s News" and scores sit outside the trends section. Reddit's Recent Posts (`recent-posts`) is from published filters, as Reddit can't be opened from the test browser. LinkedIn needs a signed-in check.
- Explore freeze: a page that restarts a paused video (Explore grids do) and ScreenFry answered each other without end. A video that keeps restarting is now muted and paused at most once a second, media checks are batched, background tabs apply new state when shown, playback changes are settled for a second before usage is saved, and Safari tabs are told about a block once per address. A new integration check fails without the fix.
- Research mode (Shorts, Reels, X video feed, TikTok) and the safer Safari off-switch step (shown even when Safari won't report; finishing while still on asks first).
- `npm run check` passed **156 unit tests**; `npm run test:e2e` passed **68 checks**. The Mac app compiles.

## Loadouts, Fry Time goals, Facebook and LinkedIn — November 9, 2026

- `npm run check` passed **145 unit tests** (new: loadouts switch/fill/copy/empty/reset and password, Fry Time goals with repeats and per-website minutes, the old feed master switch migrating to every control off) and `npm run test:e2e` passed **63 checks** (site counts updated to eight).
- Removed: settings import/export in the Mac app and bridge (check-ins now carry only version and password state, once a minute rather than after every edit), and the feed blocking master switch.
- Erase Everything now ends by waiting for ScreenFry to be switched off in Safari, because Safari keeps its on/off memory in a folder no app can change.
- Popup lag on busy pages: the content script re-ran the full policy check for every video on each media event and up to 20 times a second from page mutations. Decisions and feed settings are now reused within a second, mutation checks are batched to 4 a second, and the popup computes website statuses once per change.
- Facebook, LinkedIn and X's video feed use stable attributes and URL paths but haven't been checked on the live, signed-in sites. The Mac app compiles; the Safari off-switch step needs a release build to try.

## Installer auto-close removed — November 9, 2026

- At Sam's request, the attempt to have ScreenFry close the installer after installing is gone: no automatic eject, no install-from-installer flow, no installed/updated banner, and the installer background is back to the original drag instructions. Opening ScreenFry from the installer shows the original "Move ScreenFry to Applications first" note, and a still-mounted installer gets the original notice with an Eject button.

## Uninstall wipes Safari — November 9, 2026

- Found on Sam's Mac: after Erase Everything and a reinstall, Safari still had every setting, window and the password, and ScreenFry started switched on. Safari keeps a web extension's storage and on/off choice after its app is deleted. Erase Everything now has ScreenFry in each connected browser wipe its storage first (Chrome also removes itself). The on/off choice lives in Safari and can't be changed by an app.
- `npm run check` (120 tests) and `npm run test:e2e` (63 checks) pass; the Mac app compiles. The erase needs a release build to try for real.

## About and scan fixes — November 9, 2026

- The Mac app's orange About button and sheet, the new Developer mode arrow and the footer order (Uninstall, Reset All Data, Export, Import) were checked in a test copy run with a throwaway home folder (`CFFIXED_USER_HOME`), so the installed app's Chrome folder and settings weren't touched.

## Presets, reset, About and paused windows — November 9, 2026

- `npm run check` passed **118 unit tests** (new: contradicting windows save but pause both, block-screen countdown, Safari label kept on re-read, Restore defaults erasing presets/usage/password and refusing without it), typecheck and verified build. `npm run test:e2e` passed **63 checks**.
- The Mac app compiles (unsigned Release build in a scratch folder). Its window wasn't opened: launching a dev build would rewrite the installed Chrome folder and register a second Safari extension. Still to check on the Mac: the Chrome card folding its steps once connected, the clickable Developer mode pictures and arrow, Reset All Data, Erase Everything removing ScreenFry from Chrome, and Safari's orange "Open ScreenFry in Safari Settings" button and popup closing when Safari loses focus.
- Follow-up: Fry Time (renamed from free time) budgets are per website (same for all, or custom per website; usage keyed `windowId:site`), with a glowing sidebar dot and a dripping Fry Time bar. The window editor has a × button, Esc, and a "Close without saving?" check. The confirm pop-up's nope!/boing! bubble and message stay up. Now **120 unit tests** and **63 e2e checks** pass. Walked through deleting a block window (dodge, boing, confirm) and the editor close flow in headless Chrome.
- Visually checked in a throwaway headless Chrome: paused window cards, the editor's All websites button and clash warning, the About page, Restore defaults, the narrow layout, and the block page countdown.

## 0.6.2 responsive blocking and TikTok — November 8, 2026

- Node 24.14.0: `npm ci` reported no vulnerabilities; `npm run check` passed **93 unit tests**, typecheck and verified build. `npm run test:e2e` passed **61 checks** in a disposable Chrome profile.
- Added runtime checks for live TikTok settings without reload, fallback reload when the content responder fails, player scroll prevention with comment scrolling preserved, second-video SPA playback suppression, restoration when disabled, current-site popup selection despite broad-host denial, popup closure on navigation/tab selection, and responsive settings while tab navigation/network compilation are deliberately stalled.
- A separate injected runtime fixture shows the inline time-up notice while background messages never resolve, checks bounded message traffic/responsiveness, and advances local time over midnight to verify recovery without reloading. Existing unit tests cover local midnight, 23/25-hour DST days, and usage splitting across midnight. The fixture is Chromium, not live Safari.
- Visually checked `dist/screenshots/time-up-inline.png` and `tiktok-linked-video.png`: existing logo, glimmer/drips, readable notice, and linked-video return action. Animation includes `prefers-reduced-motion`; the React/listener review also scopes nonpassive scroll guards to active TikTok linked-video mode and avoids unchanged blocked-page rerenders.
- Development-signed **0.6.2/build 24** macOS Release app and `dist/ScreenFry-0.6.2.dmg` built successfully. Safari package and matching-team hardened-signature verification passed. Xcode's unrelated obsolete iOS Simulator warning remains. No installed app, everyday-browser settings, or GitHub branch was changed by these checks.
- Still required: live Safari acceptance of exhaustion, toolbar responsiveness, new-site navigation, permission-limited injection and midnight recovery; real signed-in TikTok recommendation/next-video selectors. Fixtures establish the changed logic, not every website's current markup or a full diagnosis of the reported Safari hang. The hidden Safari document may still fetch resources; this change does not establish that a data leak occurred.

## 0.6.1 setup-window improvements — November 8, 2026

- Node 24.14.0: `npm ci`, `npm run check` passed (89 unit tests, typecheck, verified extension build). Isolated Chrome integration passed 49 checks, including persistent Safari-reminder dismissal and preservation of Chrome's host-access warning. The Safari cases simulate Safari's browser identity/permission response in the isolated Chrome fixture; they do not establish live Safari permission behavior.
- Development-signed Release app and disk image build passed Safari packaging and matching-team hardened-signature verification. Xcode reported an unrelated out-of-date iOS Simulator runtime; the macOS build succeeded.
- Launched the native setup window and visually checked the Safari/Chrome order, inline Chrome button, bold text, before/after switch captures and arrow, drag tile placement, and underlined browser-request footer in the shared gray panel. The panel scrolls on shorter displays.
- Clicking the tile revealed the app-managed Chrome folder in Finder. Checking/unchecking the Chrome confirmation updated the status and reset correctly. Check for Updates opened the repository's Releases page. The browser-request link opened GitHub's sign-in flow targeting the prefilled issue; no request was submitted.
- A live drop into Chrome, the actual Safari website-access prompt, and a signed Sparkle-feed update remain manual acceptance items. Drag success reports only an accepted drop, not a verified Chrome installation. No update signing key or public release was created.

## 0.6.0 identifier rename — November 8, 2026

The repository is now `yasserjaghoori/ScreenFry`. Bundle identifiers are `com.screenfry.ScreenFry` and `com.screenfry.ScreenFry.Extension`, and storage, export, message and page markers use `screenfry`, so earlier installs start with fresh settings. `npm run check` (**89 unit tests**, typecheck, verified build) and `npm run test:e2e` (**46 checks**) pass. `npm run dmg:local` built a signed 0.6.0 disk image that passes strict signature and package verification, and the built app contains no old identifiers. Before the rename, on the user's Mac, the signed 0.5.1 install passed checks 1 and 2 of the handoff list and the Erase Everything uninstall. 0.6.0 hasn't been installed and checked on the Mac yet.

## Project naming verification — November 8, 2026

The checkout and Safari project paths now use ScreenFry, including the Xcode targets/scheme and entitlement file names. The npm package is screenfry. CI, icon generation, packaging scripts and setup instructions use the new paths. At that point the GitHub URL and persisted browser identifiers kept their old values; 0.6.0 (below) renamed those too.

`npm ci`, `npm run check` (**89 unit tests**, typecheck and verified build), and `npm run test:e2e` (**46 checks**) pass. From the renamed checkout, `npm run build:safari`, XcodeGen, the **ScreenFry** scheme's unsigned Debug build and Safari package verification all pass. Existing untracked duplicate project files were renamed and preserved, and duplicate Info plists are excluded from generated target sources. No installed app or browser settings were changed as part of this rename.

## Historical Mac app review — 0.5.0/build 20, November 7, 2026

- Reviewed Claude's installer/updater and launch-fix changes through `b541dd3`. The previous 0.4.x snapshots below remain historical.
- `npm ci` (zero vulnerabilities), `npm run check`: **89 unit tests**, typecheck and verified build pass. `npm run test:e2e`: **46 checks passed, zero failed**, including popup startup, permission-limited site selection, playback, limits/windows and settings authorization.
- The user's local crash export confirms a pre-launch dyld failure loading Sparkle under library validation. The old installed 0.5.0 was ad-hoc signed with hardened runtime and no Team ID. It failed the new `verify-macos-signing.mjs` guard even though recursive signature verification alone could succeed.
- Built current 0.5.0 with an available Apple Development identity, **keeping hardened runtime enabled**. Built and installed apps pass the new matching-team signing check, recursive signature verification and package checks. `/Applications/ScreenFry.app` was replaced; the crashing copy is recoverable in Trash. No quarantine attributes or system security settings were bypassed.
- **Native launch passed:** opened the repaired app from Applications twice. It remained running beyond the launch-check interval, showed the full Safari and Chrome setup cards, reported Safari on and Chrome's folder ready at 0.5.0. Ejecting the installer image removed the duplicate-copy notice. The update button is correctly disabled without an update signing key. This verifies native startup/UI, not that the Chrome extension is installed/enabled or that every Safari policy scenario passes.
- The user confirmed the 0.4.8 Safari popup opens consistently after reload, correcting an earlier response. That is a live popup pass; broader Safari navigation/performance/playback acceptance remains separate.
- Two old 0.3.0 app bundles and two standalone extension bundles under the project's old build folders were unregistered and moved to Trash. Filesystem and Spotlight checks find no remaining app bundles within the ChatGPT project folder. Source and duplicate Xcode projects were preserved.

See [Mac app review and Claude handoff](MAC_APP_REVIEW.md). Raw crash exports are local-only and ignored by Git.

## Historical verification — 0.4.6, November 7, 2026

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
- The signed **ScreenFry.app 0.4.2, build 11** was built and installed at `~/Applications/ScreenFry.app`. Both built and installed bundles pass strict recursive signature and package verification. The original ScreenFry.app was renamed/replaced with a backup; unrelated duplicate Xcode projects were preserved.
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

After the user enabled YouTube controls, Chrome's real signed-in homepage reported `display: none` for both the home feed and Notifications renderer. A direct `/shorts/` navigation redirected to ScreenFry's blocked URL (URL metadata only; extension contents were not inspected).

Safari was updated to a locally signed 0.3.1 with a native app icon and monochrome toolbar clock. The installed app passed strict signature and packaging checks, reported enabled, and the toolbar exposed a visible button named ScreenFry. On the public YouTube homepage, the home feed and Notifications button were absent after the update. A subsequent direct Shorts test reached a blank loading tab without a verifiable destination, so Safari's live short-form redirect remains unverified.

The automation tool rejected access to extension-internal settings pages, so settings were enabled manually by the user. Live time-limit exhaustion, Windows and the remaining site controls still need manual acceptance. The isolated Chrome integration checks above are separate evidence. The toolbar icon does not change the tool's extension-page access restriction.

## Paused follow-up — source 0.3.2

Before the user's restart request, `npm run check` passed all 63 unit tests and the build. A subsequent isolated Chrome run against 0.3.2 finished with 43 passed, zero failed. The signed Safari 0.3.2 build also completed successfully in `/tmp/screenfry-safari-icons`; it was not installed, and that build's signature/package verification and live acceptance were not completed.

The local change uses `declarativeNetRequestWithHostAccess`, required by Apple for Safari redirects, and adds permission checks to both packaging verifiers. This is a confirmed manifest/documentation mismatch, not a confirmed diagnosis of the blank Safari tab. Further native Safari attempts were interrupted by concurrent input, a lost window connection and the user's pause. Do not infer successful navigation or blocking from those attempts. Resume from `AI_HANDOFF.md` after the restart when requested.

## Post-restart follow-up — November 7, 2026

Node 24.14.0 and `npm ci` succeeded. `npm run check` passed 63 tests, typecheck and build; the isolated Chrome suite finished 43 passed, zero failed. Safari 0.3.2 was rebuilt under `/tmp/screenfry-safari-032`, signature/package-verified, installed in place and verified again. Its containing app reported enabled; one persistent 0.3.2 extension copy was registered.

Live Chrome showed the hidden YouTube feed/Notifications. Clicking the still-visible Shorts navigation entry reached a blocked URL labeled YouTube Shorts. The bare `/shorts` navigation selector remains a follow-up. Safari's clock and homepage hiding survived reboot before the update. After the update, direct Shorts and ordinary search attempts stayed in loading states without verified destination/content; these checks remain inconclusive. Test tabs were closed. No automated access to the previously denied installed-extension settings was attempted.
