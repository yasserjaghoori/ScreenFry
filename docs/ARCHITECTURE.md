# Architecture

```
apps/extension/            UI pages (React) + MV3 service worker + content script
  src/background/          thin event glue: tracking checkpoints, DNR sync, tab enforcement, alarms
  src/content-scripts/     feed CSS, SPA navigation, override countdown, warnings (classic IIFE build)
  src/blocked|popup|onboarding|dashboard/
  src/ui/                  shared components (PIN pad, private-access guide, formatting)
packages/
  shared-types/            AppState, rules, decisions
  core/                    actions (every state transition), commitments, tracking, PIN, domains, store, migration
  policy-engine/           deterministic evaluatePolicy / nextAccessTime / boundaries
  feed-blockers/           per-site selector table with path scoping
  browser-adapters/        chrome.storage store, message types, Chrome/Safari detection
safari/                    XcodeGen spec + minimal containing app + generated WebExtension resources
tests/                     Vitest unit tests; tests/e2e real-Chrome smoke test
```

## Where the rules live

Every change to state goes through `packages/core/src/actions.ts`, which takes an injected store and clock. The background only routes messages there. Sealproof rules are enforced in three places:

- `commitments.ts`: `weakeningReasons` decides whether an edit is looser. While a rule is committed, `mutateRule` stores looser edits as a `pendingChange`, so the live rule stays the same. Identity fields (`id`, `createdAt`, `pendingChange`) always come from the stored rule.
- `policy-engine`: `evaluatePolicy(state, url, now)` is pure. When several rules cover a URL, the strictest wins. `nextAccessTime` steps minute by minute in local time, and includes local midnight explicitly. Day-specific allowances, overlapping and overnight schedules, DST and time-zone changes are handled by evaluating each instant in the current zone. `canOverride` already refuses PIN visits for committed `strict` rules (future mode). Phase 1 never stores `strict`.
- `actions.requestOverride`: the background resolves the rule from the URL, checks the PIN with cooldowns, and grants one shared 10-minute window per rule. It stores absolute timestamps, so restarts neither reset nor extend the window.

The UI disables buttons only as a convenience. Every rule above is enforced in the actions layer.

## Enforcement layers

1. **declarativeNetRequest** dynamic redirect rules, regenerated from the policy engine, for main frames and sub-frames (embeds). They're removed during an override.
2. **Tab redirect** of already-open tabs whenever a decision changes (`enforceAllTabs`).
3. **Content script**: evaluates the same policy locally from `storage.local` on load, on SPA URL changes, on storage changes, and every second in the top frame, so an override ends on time even while the worker is asleep.

## Tracking

At each event (tab, focus, idle, audible, alarm) the worker checkpoints:

1. Credit the session since the last checkpoint, capped at 90 s per gap so sleep and suspension aren't counted, and split at local midnight.
2. Choose the next session: the active tab of the focused window, while the user is active or the tab is playing audio.
3. Persist the session in `storage.session`.

Time goes to the rules covering the URL: `millisecondsByRule` when allowed, `overrideMillisecondsByRule` during a PIN visit. Per-host history is recorded only if the user keeps general history on. A one-minute heartbeat plus a precise boundary alarm bounds both data loss and enforcement delay, at about one storage write per minute while browsing.

## Future phases

- `EnforcementMode` already includes `strict`. Enabling it is a UI and product decision; the engine supports it.
- `StateStore` is an interface. A Phase 2 macOS companion could provide an authoritative store or clock through `SafariWebExtensionHandler` native messaging, without changing the policy code.
- Chrome and Safari state are deliberately separate in Phase 1.
