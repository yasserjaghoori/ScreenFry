# Phase 1 audit (2026-11-07)

The original commit implemented the outline of Phase 1, but several Sealproof guarantees could be bypassed through ordinary extension interactions, the Safari package could not load, and many spec items were missing. This document lists what was found and what changed. Each fix has an automated test unless noted.

## Sealproof bypasses (fixed)

| # | Problem in the original code | Fix |
|---|---|---|
| 1 | `CREATE_PIN` could be sent at any time, replacing the PIN without knowing the old one, which also cleared the wrong-PIN cooldown. | A PIN can only be created during onboarding. Changing it needs the current PIN and shares the cooldown (`actions.createPin`, `actions.changePin`). |
| 2 | Saving a committed rule with `commitmentEndsAt` removed was treated as non-weakening, so the commitment disappeared and the next edit could loosen anything. | Ending or shortening a commitment counts as weakening and is queued (`weakeningReasons`). |
| 3 | Changing a committed rule's domains (e.g. `youtube.com` → `example.com`) was applied immediately. | Removing any covered domain is weakening. |
| 4 | Turning off "tracking" stopped counting time on limited sites, so limits never ran out. | Limit tracking is always on. The setting now only controls general per-site history. |
| 5 | Any web page's content script could send `SAVE_RULE`, `DELETE_RULE`, `CREATE_PIN`, etc. | The background accepts privileged messages only from extension pages. Content scripts may only ask for a policy decision. |
| 6 | The blocked page sent a `ruleId` taken from its own URL, so a crafted link could unlock an arbitrary rule. A second PIN entry during an active override started a fresh 10 minutes. | The background works out the rule from the URL. If a visit is already running, its existing expiry is returned and no new time is granted. |
| 7 | A failed storage update left the update queue permanently rejected, so every later change failed silently. | The queue recovers after an error (tested with the memory store). |
| 8 | Moving the clock backwards could stretch an override, or leave a PIN cooldown lasting days. | Overrides count only inside their original window (`startedAt ≤ now < expiresAt`, at most 10 minutes). Rollback is detected and over-long cooldowns are capped. |

## Broken behaviour (fixed)

- **Safari could not load the extension.** The handler subclassed the legacy `SFSafariExtensionHandler` instead of implementing `NSExtensionRequestHandling`. The manifest was packaged at `Contents/Resources/Resources/manifest.json`, one level too deep. The containing app's `@main` delegate was never attached (there is no nib), so its window never appeared. The project also had no sandbox entitlements.
- **Safari background crashed at startup.** It called `chrome.idle` unconditionally, and Safari has no idle API. Browser detection was missing, so Safari wrote `browser: 'chrome'`.
- **Usage was lost whenever the MV3 service worker was suspended.** The tracking session lived only in memory, and focus/idle were assumed rather than queried. The session now lives in `storage.session`, and state is queried on every checkpoint.
- **Watching a video didn't count.** After 60 seconds without input, Chrome reports "idle", so a 30-minute video counted as 1 minute. Audible tabs now keep counting; a locked screen never counts.
- **The content script would break as soon as it imported shared code.** Manifest content scripts can't be ES modules. It is now built separately as a self-contained IIFE, and `scripts/verify-build.mjs` checks this.
- **Feed blockers hid useful pages.** For example, `shreddit-feed` on every subreddit, `main` on every Instagram profile, the grid on YouTube channel pages, and `[role=feed]` in Facebook groups. Selectors are now limited to feed URLs. X's For You and Following toggles now work independently.
- **Overrides re-blocked up to a minute late**, and limits blocked up to a minute after running out. The background now sets a precise alarm (plus a timer while awake) for the next boundary: override expiry, limit exhaustion, the 5/1-minute warnings, schedule edges, midnight and commitment end.
- **The popup ignored weekday allowances.** Other fixes: a full-week schedule showed `Infinity` as the next access time, the onboarding copy was Chrome-only, and the dashboard could be used before a PIN existed.

## Missing features (added)

- 5- and 1-minute warnings, shown as in-page notices (no notification permission needed).
- Override time tracked separately from allowed usage. Override history includes labels.
- Multiple schedules per site, per-weekday allowances in the UI, and custom commitment end dates.
- A live "this edit will be queued because…" preview. Pending changes can be withdrawn, and queued removal deletes the rule when the commitment ends.
- Private-browsing verification for Safari: coverage is confirmed only after the extension actually sees a private tab. Never assumed.
- Dashboard: remaining limits, usage by website, active restrictions, upcoming schedules, recent PIN visits, usage history table, JSON export, history deletion that keeps today's counted time for sealed limits, and full reset (refused while committed, requires the PIN).
- Popup: next access time, override countdown, sealed-until date, and a "finish setup" state.
- Blocked page: live re-check, a "continue" button once access returns, a 6-digit PIN pad with a cooldown countdown, and no disable button.
- An onboarding acknowledgement that there's no PIN recovery, plus quick-start limits with a commitment choice.
- Domain alias groups (`x.com`/`twitter.com`, `youtube.googleapis.com`, `fb.watch`, …) that leave shared Google/Meta infrastructure alone.
- Schema migration from the original stored format, and dark mode.
- 77 unit tests (previously 13) and a 26-check headless Chrome end-to-end test.

## Still not verified here

- **Safari at runtime.** The Xcode project builds unsigned (`xcodebuild … CODE_SIGNING_ALLOWED=NO`) and the bundle layout is correct, but loading in Safari needs a signing team or Safari's "Allow unsigned extensions". Safari's MV3 support for `storage.session`, `declarativeNetRequest` regex substitution and promise-returning `chrome.*` calls is assumed from Apple's documentation, not observed. There are fallbacks: memory session, tab redirects, and content-script enforcement.
- **Feed selectors** are checked structurally only. They target third-party markup that changes often.
- **Incognito** verification was tested through the API path. The toggle in `chrome://extensions` itself has to be tested by hand (see TESTING.md).
