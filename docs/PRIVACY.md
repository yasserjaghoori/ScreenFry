# Privacy

- No backend, account, analytics or extension network requests.
- Local storage contains website controls, allowed windows, daily usage, preferences and (if enabled) a salted settings-password verifier. The plaintext password is not saved.
- The current extension page holds the entered settings password in memory until it closes, reloads or is locked. Protected messages stay inside the extension.
- Content scripts read the page URL, selector attributes, selected X home tab, and audio/video playback state. They do not read page text, messages or form values.
- Playback reports contain a boolean; the browser supplies tab/frame identifiers. Session data is kept in browser session storage where supported, with memory fallback.
- ScreenFry only measures time on websites that have a rule (currently the five launch sites). It keeps the daily total per website rule for up to 120 days. It records nothing about other browsing; history from earlier versions is deleted on upgrade.
- Chrome and Safari store independent data. Removing/resetting extension storage removes it. There is no cloud password recovery service.
