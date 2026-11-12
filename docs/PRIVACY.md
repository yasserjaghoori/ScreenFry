# Privacy

- No backend, account, analytics or extension network requests. The only thing that goes online is the Mac app's update check (below).
- Local storage contains website controls, windows, earn goals, loadouts, daily usage, preferences and (if enabled) a salted settings-password verifier. The plaintext password is not saved.
- The current extension page holds the entered settings password in memory until it closes, reloads or is locked. Protected messages stay inside the extension.
- Content scripts read the page URL, selector attributes, selected X home tab, and audio/video playback state. They do not read page text, messages or form values.
- Playback reports contain a boolean; the browser supplies tab/frame identifiers. Session data is kept in browser session storage where supported, with memory fallback.
- ScreenFry only measures time on websites that have a rule (the nine supported websites and any website you add to a window or goal). It keeps the daily total per website for up to 120 days. It records nothing about other browsing.
- Chrome and Safari store independent data. Removing or resetting extension storage removes it. There is no cloud password recovery.
- **Check-ins with the Mac app:** about once a minute, each browser's extension tells the Mac app, through native messaging on your Mac, its version, whether a settings password is on, and its current setup as a share code (settings only: never the password, usage or history), so the app can show it as connected and save it to a loadout. Reset All Data, Erase Everything and Use in All Browsers requests travel the same way. These stay on your Mac.
- **Share codes** are made on your Mac and only leave it if you copy and send one.
- **Updates:** about once an hour the Mac app downloads ScreenFry's update feed (`appcast.xml`) from GitHub, and, when there's a newer version, the new installer. GitHub sees an ordinary download request (your IP address and the app's version in the user agent). Nothing about your settings or usage is sent.
