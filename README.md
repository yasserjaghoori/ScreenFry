# Screentime

A privacy-first Chrome and Safari extension for commitment-based website limits, recurring schedules, 10-minute PIN visits and selective feed blocking.

**Sealproof:** once you seal a restriction, you can make it stricter at any time, but anything looser waits until the commitment ends. Your PIN opens a site for 10 minutes and never changes the rule.

## Run

```bash
npm install
npm test            # unit tests
npm run build       # → dist/chrome
npm run test:e2e    # real headless Chrome smoke test
```

Chrome: open `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `dist/chrome`. Onboarding opens automatically. Safari: see [docs/SAFARI.md](docs/SAFARI.md).

## Phase 1 features

- Mandatory onboarding with a 6-digit PIN (salted PBKDF2 verifier, escalating cooldowns, no recovery shortcut).
- Private-browsing coverage that is reported only once the browser proves it (Chrome API; Safari by observing a Private tab).
- Daily limits with per-weekday allowances. Time counts only for the focused, active tab while you're present. Resets at local midnight. Warnings at 5 and 1 minute.
- Weekly schedules: multiple per site, overnight, overlapping, live updates, correct across DST and time-zone changes.
- Commitments (until end of today, 7 days, 30 days or a custom date) enforced in the core policy layer, with queued changes you can withdraw.
- 10-minute PIN visits shared across tabs and restarts, with override time tracked separately.
- Feed blocking for YouTube, X, Instagram, Reddit, Facebook and LinkedIn, limited to feed pages so search and direct links keep working.
- Dashboard, popup and blocked page, with dark mode.

## Docs

[Architecture](docs/ARCHITECTURE.md) · [Threat model](docs/THREAT_MODEL.md) · [Privacy](docs/PRIVACY.md) · [Testing](docs/TESTING.md) · [Safari](docs/SAFARI.md) · [Phase 1 audit](docs/PHASE1_AUDIT.md)

## Honest limitation

An extension can't make itself impossible to uninstall, stop you from disabling it in browser settings, or protect its local storage from someone who controls the device. "Sealproof" means Screentime itself offers no casual way to permanently loosen a commitment.
