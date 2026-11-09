# Privacy

- No backend, account, analytics or extension network requests.
- Local storage contains website controls, allowed windows, daily usage, preferences and (if enabled) a salted settings-password verifier. The plaintext password is not saved.
- The current extension page holds the entered settings password in memory until it closes, reloads or is locked. Protected messages stay inside the extension.
- Content scripts read the page URL, selector attributes, selected X home tab, and audio/video playback state. They do not read page text, messages or form values.
- Playback reports contain a boolean; the browser supplies tab/frame identifiers. Session data is kept in browser session storage where supported, with memory fallback.
- ScreenFry only measures time on websites that have a rule (currently the five launch sites). It keeps the daily total per website rule for up to 120 days. It records nothing about other browsing; history from earlier versions is deleted on upgrade.
- Chrome and Safari store independent data. Removing/resetting extension storage removes it. There is no cloud password recovery service.
- Settings export/import (Mac app): each browser's extension sends its website settings — rules, windows, feed blocking and the warnings preference, never usage history or the settings password — to the Mac app through native messaging about once a minute and after edits. The app keeps the latest copy in a local file (`~/Library/Application Support/ScreenFry/Bridge/Chrome`, and the Safari extension's own container for Safari) so Export can save it. An import chosen in the app waits there until the extension applies it; a set settings password makes the extension refuse it. The extension also reports its version and whether a settings password is on (never the password), so the app can show it as connected and know when a reset will be refused. Reset All Data and Erase Everything requests travel the same way. Nothing leaves the Mac.
