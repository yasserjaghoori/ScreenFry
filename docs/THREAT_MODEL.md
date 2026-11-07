# Threat model

Screentime is a **self-control tool**, not a security product. It removes the easy, in-the-moment ways to undo your own commitments. It cannot stop someone who controls the device and is determined to get around it.

## What Screentime reliably enforces (extension installed, enabled, with site access)

- Blocking matching HTTP(S) navigations, existing tabs, redirects, embeds (sub-frames) and single-page-app route changes. This covers subdomains and the product's alias domains (e.g. `youtu.be`, `youtube-nocookie.com`, `twitter.com`).
- Refusing any loosening of a committed rule through its own UI, popup, blocked page, PIN flow or messages: higher allowance, removed site, shorter window, rule turned off, commitment ended early, usage reset, rule deleted. These changes are queued until the commitment ends. Stricter changes apply at once.
- PIN visits that last exactly 10 minutes, are shared by all tabs of a site, survive browser restarts without restarting, and never change rules, usage or commitments.
- Escalating cooldowns after wrong PINs: from the 3rd failure, 30 s doubling up to 1 hour. There is no recovery shortcut, and the PIN can't be overwritten without the current PIN.
- Web pages can't send privileged messages. Only extension pages can edit rules or use the PIN.

## What a user can bypass

- **Disabling or removing the extension**, or revoking its site access, in browser settings. Browsers don't let an extension prevent this. Removal also erases its data.
- **Private browsing.** It is covered only when the user allows it:
  - **Chrome:** "Allow in Incognito". Screentime shows *Sealproof-ready* only when `chrome.extension.isAllowedIncognitoAccess()` returns true, and re-checks at startup.
  - **Safari:** there is no API to query this setting. Screentime shows *Sealproof-ready* only after it has seen one of its own tabs report `incognito: true`, and shows when that happened. Safari doesn't tell extensions when the setting is later turned off.
- **Other browsers, profiles and devices.** Each Screentime install has its own rules and PIN. Phase 1 doesn't sync.
- **The system clock.** Moving the clock forward can end commitments and start a new day early. Moving it backwards is detected (shown on the dashboard): overrides that would appear to start in the future are cancelled and long cooldowns are capped. There is no trusted remote clock, by design (no servers).
- **Local storage.** Anyone with device access can edit `chrome.storage` (devtools on the extension, profile files) or load a modified unpacked build. Timestamps and the PIN verifier on disk can't serve as a trusted authority.

## The PIN's limits

- Only a PBKDF2-SHA-256 verifier is stored (310,000 iterations, 16-byte random salt), compared in constant time. The PIN is never stored, logged or sent anywhere.
- A 6-digit PIN has 10⁶ possibilities. Anyone who can read extension storage can brute-force the verifier offline in minutes to hours. PBKDF2 only slows this down. The cooldown applies only to attempts through the UI.

## Tracking limits

- Time counts only for the active tab of the focused window, while the user is active (`chrome.idle`, 60 s) or the tab is playing audio. A muted video with no input stops counting after 60 s.
- Safari has no `idle` API, so on Safari time counts whenever the window is focused.
- Gaps longer than 90 s (sleep, suspended worker) are credited at most 90 s.

## Privacy

There is no account, server, analytics or third-party code, and the extension makes no network requests (checked by the build). The content script reads only the page URL, plus the `aria-selected` state of X's home tabs. It never reads page text, form fields or messages. General per-site history stores domain names and durations, can be turned off, and is pruned after 120 days.
