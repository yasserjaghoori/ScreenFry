# Architecture

- `apps/extension`: ScreenFry React dashboard, popup, welcome and blocked pages; shared background implementation and classic content script. Chrome runs a module service worker; Safari packaging selects a nonpersistent module background page.
- `packages/core`: authorized state transitions, optional password hashing, usage accounting, storage migration and domain matching.
- `packages/policy-engine`: pure allowance/window/short-form decisions and upcoming boundaries.
- `packages/feed-blockers`: grouped per-site selector definitions and short-form URL matching.
- `packages/browser-adapters`: messages, serialized storage and Chrome/Safari capability differences.
- `safari`: macOS containing app and Safari Web Extension target.

## State and authorization

Schema 3 separates `rules` (per-site allowance/manual blocking) from `windows` (allowed times and website whitelists). `feedSettings` contains the individual controls for the five launch sites. All user mutations go through the actions layer and its optional-password check, inside the serialized storage update. Merely hiding a UI control does not authorize a write.

A settings password is a salted PBKDF2-SHA-256 verifier (310,000 iterations). The entered password is held only in the current extension page's memory and supplied on protected edits; it is not persisted or logged. Closing/reloading the page locks it again. Password protection is for changing settings and provides no temporary website access.

Legacy mandatory PINs, overrides, commitments and queued changes are discarded. Usage and applicable feed choices are kept. Legacy blocked schedules become complementary allowed windows; an all-week block becomes explicit site blocking.

## Policy

A website is blocked if manually blocked, its daily allowance is exhausted, it is outside every matching enabled allowed window, or its URL identifies disabled short-form content. A matching window is not required for unlisted sites. Overlapping allowed windows combine with OR; all independent restrictions must permit access. Forecasting checks local midnights and window boundaries against the complete policy, so midnight alone does not claim access before the next window and blocked pages avoid repeated minute-by-minute scans.

Network rules cover blocked domains and direct Shorts/Reels routes. Chrome redirects matched requests to its blocked page; Safari blocks embedded frames only. Safari top-level pages now use an isolated, modal in-page notice with paused media, never `window.stop()` or a cross-scheme redirect. Content-detected short-form players also use this local notice. Chrome retains network/tab redirects. The legacy authorized `SHOW_BLOCKED_PAGE` handler no longer navigates Safari. A regular extension is not a network firewall: the hidden underlying Safari document can still load resources. Live Safari runtime acceptance remains separate from fixture tests.

The notice and extension blocked page evaluate persisted policy locally, including local-midnight rollover, without polling background messages. They share reduced-motion-aware logo animation. Content scripts enforce storage changes, recognized players and SPA routes. DOM mutation checks are limited to supported social sites and coalesced into 50 ms macrotasks; media reports deduplicate playback events. TikTok linked-video mode preserves the initial direct video identity, prevents player scrolling/keyboard progression (not comments), and pauses/shows a notice if an SPA route moves to another video. Its nonpassive listeners exist only while that mode is active.

Settings reads do not await enforcement. Authorized edits persist first and allow at most 1.5 seconds for network-rule synchronization; the single in-flight compilation retains only a pending latest-state sync. Usage accounting and boundary alarms do not wait on compilation. Tab-navigation/message calls are bounded. An active matching site's content script acknowledges live application; a missing/failed responder causes one reload, only if the tab still has the same URL and is not already loading. Other pages update through storage events. Popup URL selection is independent of broad host permission queries and its tab listeners close it on navigation/activation. Unrelated documents stay idle until relevant state is explicitly requested; relevant embedded frames poll every five seconds. State writes skip unchanged data, reevaluations coalesce, and network-rule signatures persist across background reloads.

## Usage

Track only websites matching enabled rules. Within those websites, track the active tab of the focused window plus tabs playing media. General per-host browsing history is removed during migration and is no longer collected. Content scripts report playback booleans (including muted video and frames), backed by the browser's audible flag. Reports and sessions use `storage.session` when available, with memory fallback. Tabs that are only open in the background do not qualify.

Checkpoint intervals are unioned per rule to prevent double-counting two tabs of the same site. Intervals split at midnight, session boundaries and policy boundaries. Credit is capped at the remaining allowance and at 90 seconds per checkpoint gap. A heartbeat and policy-boundary alarms/timers handle sleep, midnight, window changes and limit exhaustion.

## Feed source

Selected CSS selectors are adapted from Saner Social Media revision `f795e09d9408733bf543836c319915be7a5cfd99`. The complete MIT notice ships in `apps/extension/public/THIRD_PARTY_NOTICES.txt`, copied to both browser builds. SocialFocus supplied the interaction reference, not source code or assets.

## Site registry and branding

`siteDefinitions` in `packages/feed-blockers` supplies site names, domains, controls and short-form detection. Default rules, site pickers and network rules derive from it; see [Adding a website](ADDING_A_SITE.md).

The supplied melting-monitor PNG in `assets/branding` is the color-logo source. `npm run icons` generates extension/UI/favicon assets, the native AppIcon and Dock fallback, plus a monochrome toolbar counterpart. See [Branding](../assets/branding/README.md).

## Settings export and import

The Mac app can't read browser storage, so export/import goes through native messaging. The background sends `{type: "screenfry-sync", version, passwordProtected, settings}` (from `exportSettings` in `packages/core`) on start, after settings edits and on each heartbeat. Safari delivers it to `SafariWebExtensionHandler`; Chrome launches the app binary as the `com.screenfry.host` native messaging host, which the app registers for the unpacked extension ID derived from its fixed folder path. Both use `Shared/SettingsBridge.swift`: the reply carries any pending import, which the background applies with `importSettings` (validated like individual edits and refused while a settings password is set) and acknowledges with `importResult`. The same handoff carries **Reset All Data** (`pending-reset.json` → `resetAll`, refused while a settings password is set, acknowledged with `resetResult`) and Erase Everything's request for each browser to wipe itself (`pending-erase.json` → `chrome.storage.local.clear()` plus session storage and dynamic rules, then `chrome.management.uninstallSelf()` in Chrome; the reply also sets `uninstall` for 0.6.4–0.6.5 Chrome extensions). Safari keeps a web extension's storage after its app is deleted, so only this wipe clears it. Every sync also writes `check-in.json` (time, version, password on or off), which is how the app shows a browser as connected: an app update reaches Chrome without redoing setup, because the extension reloads itself when it sees the new build. The app's browser cards and footer read and write those bridge files; adding a browser to `SettingsBrowser` gives it all of this. Fry Time budgets are per website: usage is counted under `windowId:site` (site id such as `youtube`, or the domain for other websites), and a window has either `freeMinutes` (the same for every website) or `freeMinutesBySite`. Safari's popup can also send `screenfry-open-settings`, which opens Safari Settings → Extensions → ScreenFry.
