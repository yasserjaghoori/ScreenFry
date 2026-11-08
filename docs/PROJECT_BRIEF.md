# ScreenFry project brief

The user-facing product is now **ScreenFry**, following Claude's 0.4.0 rename and ember redesign. The local folder and Xcode project/scheme use ScreenFry, and the npm package uses screenfry. The GitHub repository URL and stable browser bundle/storage identifiers retain their legacy values for compatibility. The functional scope below is unchanged.

## Approved scope — November 7, 2026

Combine the feed-blocking approach of Saner Social Media with SocialFocus-style grouped, per-website controls. Launch on Chrome and Safari for **YouTube, Instagram, X, Reddit and Substack**.

Each website has its own settings page with grouped feed/button toggles, full-site blocking, a daily allowance and an optional timer. The installed SocialFocus interface was inspected for its site picker, daily-limit selector, grouped toggles and password setting. Its private implementation is not used.

## Windows

Windows live on their own page. A window has a name, recurring weekdays, start/end times and a website whitelist. Whitelisted sites are available inside any of their enabled windows and completely blocked outside them. Multiple windows are allowed, including overnight windows. Sites not whitelisted in any enabled window keep their ordinary website settings.

Daily budgets remain per website and are shared across every allowed window. A 10-minute YouTube allowance with noon–1 p.m. and 6–8 p.m. windows means 10 minutes total, not 10 minutes in each window. Having unused allowance does not permit access outside those windows.

## Playback and timing

Count the focused active tab and any background tab actually playing audio or video. Do not count an inactive, non-playing tab. Count concurrent tabs on the same website once per second; different websites can accrue time simultaneously.

A website's short-form setting blocks playback itself, including notification links, direct routes and detected in-page players. Hiding the entry button or converting Shorts into regular videos is insufficient. YouTube Shorts and Instagram Reels are dedicated settings. Other launch sites have a broader video-playback switch.

## Optional settings password

Password protection is optional and protects edits. There is no mandatory PIN, extra-time bypass, timed commitment, queued weakening or “Sealproof” product promise. A fresh install starts unrestricted so the user chooses their controls. Changes apply immediately when authorized.

## Implementation and later work

Phase 1 stays local to each browser. The Safari containing app enables the extension; it is not a native Screen Time enforcement app. Native macOS/iOS work remains a later phase requiring its own platform investigation.

Old daily usage is retained. Old mandatory PINs, commitments and visits are removed. Legacy blocked schedules are converted to their complementary allowed windows, with a review notice.

## References

- [ScreenFry](https://github.com/yasserjaghoori/ScreenFry)
- [Saner Social Media](https://github.com/tobiasdalhof/sanersocialmedia) — MIT-licensed selectors adapted with attribution.
- [SocialFocus](https://socialfocus.app) — product reference, also inspected locally in Chrome.

Private conversation exports and unrelated discussions are not repository content or implementation instructions.
