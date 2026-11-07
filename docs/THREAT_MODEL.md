# Threat model

## Screentime can reliably do

- Block matching HTTP(S) navigation while the extension is installed, enabled, and granted host access.
- Apply limits to supported subdomains and canonical short-link domains.
- Reject permanent weakening through its own UI, popup, messages, and PIN override flow while a commitment is live.
- Rate-limit local PIN attempts and keep only a salted PBKDF2-SHA-256 verifier.
- Preserve rules, usage, pending changes, and absolute override expiry timestamps across ordinary browser restarts.

## Screentime cannot guarantee

- A device owner can disable or uninstall the extension, revoke permissions, edit an unpacked build, alter browser-local storage, change the system clock, use another browser/device, or remove the browser profile.
- Chrome Incognito coverage exists only when the user enables **Allow in Incognito**. Screentime reports it as verified only after Chrome's supported API confirms it.
- Safari does not offer a cross-version, reliable WebExtension API that proves Private Browsing coverage. The UI/package must describe it as manually verified rather than confirmed.
- A six-digit PIN has limited entropy. PBKDF2 raises offline guessing cost but cannot turn a local extension into a security boundary against a device owner.
- System-clock rollback detection is advisory. There is no trusted remote clock by design.

No page contents, form input, messages, or passwords are read. The content script examines only the URL and applies static selectors for opted-in feed elements. No analytics SDK or network backend is included.
