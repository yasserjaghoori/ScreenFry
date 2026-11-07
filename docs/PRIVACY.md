# Privacy

- No backend, account, analytics or extension network requests.
- Local storage contains website controls, allowed windows, daily usage, preferences and (if enabled) a salted settings-password verifier. The plaintext password is not saved.
- The current extension page holds the entered settings password in memory until it closes, reloads or is locked. Protected messages stay inside the extension.
- Content scripts read the page URL, selector attributes, selected X home tab, and audio/video playback state. They do not read page text, messages or form values.
- Playback reports contain a boolean; the browser supplies tab/frame identifiers. Session data is kept in browser session storage where supported, with memory fallback.
- Per-domain usage is retained locally for up to 120 days. Limit accounting stays active even if general history is disabled. Clearing history does not refill today's allowance.
- Chrome and Safari store independent data. Removing/resetting extension storage removes it. There is no cloud password recovery service.
