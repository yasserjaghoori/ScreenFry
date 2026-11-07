# Privacy

- No account, backend, telemetry, analytics or third-party code. The build checks that the background and content scripts make no network requests.
- Stored only in this browser's extension storage: rules, commitments, the PIN verifier (never the PIN), per-rule durations, optional per-domain durations, override history and preferences.
- The content script reads the page URL only (plus the selected-tab state on X, for feed blocking). It never reads page text, form fields, messages or passwords.
- General history (per-domain time) can be turned off in Settings. Restricted sites are always measured, because limits depend on it. Usage older than 120 days is deleted automatically.
- **Export** downloads a JSON file without the PIN verifier. **Delete history** erases usage and override history, but keeps today's counted time for sealed limits, since erasing it would reset an active limit. **Reset** removes everything, but only once no commitment is active, and it requires the PIN.
- Permissions: `storage`, `tabs` (active tab URL for tracking and enforcement), `idle`, `alarms`, `declarativeNetRequest`, and host access to all sites, so user-chosen sites can be blocked and feed controls work.
