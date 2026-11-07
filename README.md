# Screentime

Screentime is a privacy-first Chrome and Safari Web Extension for commitment-based website limits, recurring schedules, temporary PIN overrides, and selective feed blocking.

## Status

Phase 1 foundation and browser MVP are implemented. Chrome is the directly buildable target. Safari uses the same compiled WebExtension resources through a minimal containing-app wrapper; signing and private-browsing verification require Xcode and a real Apple Developer team.

## Run

```bash
npm install
npm test
npm run build
```

Load `dist/chrome` from `chrome://extensions` with Developer mode enabled. Complete onboarding, then enable **Allow in Incognito** from the extension details page and verify it in Screentime Settings.

For Safari, see [docs/SAFARI.md](docs/SAFARI.md).

## Design guarantees

- The deterministic policy engine—not disabled buttons—decides whether weakening a live commitment is applied or queued.
- PIN overrides last exactly 10 minutes in persisted state and never modify rules or usage.
- Only the active tab in the focused, non-idle browser is counted.
- Usage, rule, feed, and override data stay in browser-local extension storage.
- Chrome and Safari state is intentionally browser-local in Phase 1.

## Honest limitation

An extension cannot make itself uninstallable, stop a user from disabling permissions, or protect local storage from a device owner. “Sealproof” means normal in-product interactions do not offer a casual permanent bypass. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
