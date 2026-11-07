# Architecture

The extension has four Vite entry pages (onboarding, dashboard, popup, and blocked), one Manifest V3 service worker, and one early content script. Shared packages contain plain TypeScript with no React or browser-global dependency where possible.

## Runtime flow

1. Browser events identify the one active tab in the focused window.
2. The tracker accrues at most two minutes per heartbeat and writes the local calendar-day bucket.
3. `evaluatePolicy` combines URL matching, daily usage, all active schedules, and the persisted site-wide override.
4. The background worker redirects blocked navigations. The content script supplements enforcement for already-loaded pages and SPA navigation.
5. Feed CSS is injected at `document_start`; a mutation observer handles SPA URL changes while CSS naturally handles later DOM insertion.

All rule mutations pass through `mutateRule`. If a committed rule would become weaker, the patch is persisted as a pending change with an exact apply time. Alarm/startup maintenance applies mature changes and removes expired overrides.

Local calendar constructors are used deliberately so midnight, daylight-saving, and time-zone changes are reevaluated against the current system zone. A backwards wall-clock movement over five minutes is recorded as a diagnostic signal; browser-local time cannot be treated as a trusted authority.
