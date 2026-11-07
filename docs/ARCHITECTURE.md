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

A website is blocked if manually blocked, its daily allowance is exhausted, it is outside every matching enabled allowed window, or its URL identifies disabled short-form content. A matching window is not required for unlisted sites. Overlapping allowed windows combine with OR; all independent restrictions must permit access. Forecasting searches the complete policy so midnight alone does not claim access before the next window.

Network rules cover blocked domains and direct Shorts/Reels routes. Chrome redirects matched requests to its blocked page; Safari uses block actions, with tab/content enforcement responsible for notice routing. Safari live notice routing remains unverified. Tab enforcement replaces already-open blocked sites. Content scripts enforce storage changes, recognized in-page players and SPA routes, and pause restricted media before redirecting. Button hiding, feed removal and playback blocking have separate controls. DOM mutation checks are limited to supported social sites and coalesced into 50 ms macrotasks so stylesheet removal cannot create an input-starving microtask loop. Media play events still pause restricted playback synchronously. Other pages retain periodic, storage-change and media-event enforcement without a document-wide mutation observer.

## Usage

Track the active tab of the focused window plus tabs playing media. Content scripts report playback booleans (including muted video and frames), backed by the browser's audible flag. Reports and sessions use `storage.session` when available, with memory fallback. Tabs that are only open in the background do not qualify.

Checkpoint intervals are unioned per rule to prevent double-counting two tabs of the same site. Intervals split at midnight, session boundaries and policy boundaries. Credit is capped at the remaining allowance and at 90 seconds per checkpoint gap. A heartbeat and policy-boundary alarms/timers handle sleep, midnight, window changes and limit exhaustion.

## Feed source

Selected CSS selectors are adapted from Saner Social Media revision `f795e09d9408733bf543836c319915be7a5cfd99`. The complete MIT notice ships in `apps/extension/public/THIRD_PARTY_NOTICES.txt`, copied to both browser builds. SocialFocus supplied the interaction reference, not source code or assets.
