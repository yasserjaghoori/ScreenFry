# Enforcement limits

ScreenFry is a browser productivity tool. It applies selected controls while the extension is enabled and has website access.

## Enforced in the product

- Full-site blocking at exhausted daily limits and outside enabled allowed windows.
- Independent feed/button choices, Shorts/Reels URL blocking and playback suppression in recognized short-form players.
- Optional password checks on all user mutations: site rules, windows, feed settings, preferences, password replacement/removal and reset.
- Web-page content scripts can report media status and request policy decisions; they cannot change settings.
- No temporary visits, PIN bypasses, commitment dates or queued changes.

## Browser and device boundaries

Users can disable/remove the extension, revoke website access, change profiles, use another browser, edit extension storage or change the system clock. The optional password protects in-product editing, not against someone who controls the device or its browser developer tools.

Chrome private browsing applies only with Allow in Incognito enabled. Safari requires Private Browsing and website permissions; its private-access status is an observation, not a continuous guarantee. Browser state is independent; Chrome and Safari do not share usage or passwords.

## Playback and measurement limits

Playback reporting reads HTML audio/video state, including muted video, and combines it with the browser's recent-audio flag. A site using inaccessible closed shadow roots, canvas players or otherwise opaque media can need additional support. A recent-audio flag may linger briefly after playback stops. Reports expire after 30 seconds; the normal heartbeat is one minute.

Recognized Shorts/Reels routes and player markup are blocked rather than rewritten. A video accessed through an ordinary watch/embed URL without any short-form metadata may be indistinguishable from a normal video. This implementation does not claim universal classification of every short video. Website markup changes can also break selectors; real-site regression testing remains necessary.

Long checkpoint gaps are capped at 90 seconds to avoid charging extended sleep/suspension. This can undercount real playback during an unusually long worker or system suspension. Network redirects have tab/content fallbacks when browser APIs differ. Safari runtime behavior needs manual testing beyond unsigned compilation.
