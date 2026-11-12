# Mac App Store listing (draft)

Fill these into [App Store Connect](https://appstoreconnect.apple.com/apps/6834149513/distribution/info) → Apps → ScreenFry (macOS, Apple ID `6834149513`; created November 12, 2026, with the App Information and version page filled in from this file). Upload builds with `npm run appstore -- upload` (docs/MAC_APP_STORE.md, which lists what's still to do).

## New app

- **Platform:** macOS. **Name:** ScreenFry (if taken: "ScreenFry: Less Feed"). **Primary language:** English (U.S.).
- **Bundle ID:** `com.screenfry.ScreenFry`. **SKU:** `screenfry-mac`. **User access:** Full access.

## App information

- **Subtitle (30 characters):** Less feed. More day.
- **Category:** Productivity. **Secondary:** Utilities.
- **Content rights:** no third-party content.
- **Age rating:** none of the questionnaire's content; 4+.
- **Copyright:** 2026 Bhron, LLC

## Version

**Promotional text (170 characters):** Hide endless feeds and Shorts, set daily limits, and earn your time on YouTube, Instagram, X, Reddit, TikTok and more, in Safari and Chrome.

**Description:**

> ScreenFry strips the endless feeds, Shorts and recommendations out of social websites and limits how long you spend on them, while search, links, profiles and messages keep working.
>
> • Hide feeds, recommendations, comments and buttons, website by website: YouTube, Instagram, X, Reddit, Substack, TikTok, Facebook, LinkedIn and Quora.
> • Block Shorts and Reels, or use research mode: the one you were sent plays, nothing after it.
> • Daily limits per website, with a live countdown when time is up.
> • Windows: allow websites only at certain times, block them at others, or open their feeds up for a while with Fry Time.
> • Earn your time: spend minutes on a website you want to use more to unlock others or earn Fry Time.
> • Five loadouts for every browser at once, and share codes to swap setups with friends.
> • An optional password protects your settings from impulsive changes. It never grants extra time.
>
> ScreenFry works in Safari, and in Chrome with ScreenFry from the Chrome Web Store. The app sets both up, shows that each is connected, and keeps your loadouts for all of them.
>
> Everything stays on your Mac: no account, no server, no analytics, and no record of the websites you visit. Every control starts off, so nothing changes until you choose.

**Keywords (100 characters):** focus,screen time,youtube,shorts,feed,blocker,limit,distraction,productivity,reels,social media

**Support URL:** https://github.com/yasserjaghoori/ScreenFry/issues
**Marketing URL:** https://github.com/yasserjaghoori/ScreenFry
**Privacy policy URL:** https://github.com/yasserjaghoori/ScreenFry/blob/main/docs/PRIVACY.md

**Screenshots (16:10: 1280×800, 1440×900, 2560×1600 or 2880×1800; up to 10):** the Mac app's window with both browsers connected, then the extension pages from `npm run store:images` (`dist/store`, 1280×800): Websites, Windows, Earn, Share, "Time is up!".

## App Privacy

**Data Not Collected.** ScreenFry stores its settings on the Mac and in each browser's extension storage, and sends nothing anywhere.

## Pricing and availability

Free, all countries and regions.

## Review notes

> ScreenFry is a Safari web extension (inside the app) plus an optional Chrome extension from the Chrome Web Store (https://chromewebstore.google.com/detail/epoooaclakcopjgkplhmbffbgcjhmdfe). The app turns them on, shows whether each browser is connected, and keeps setups ("loadouts") for both.
>
> The temporary exception entitlement (home-relative read-write: /Library/Application Support/Google/Chrome/NativeMessagingHosts/) is only used to write one file, com.screenfry.host.json. Chrome discovers native messaging hosts only through a manifest in that folder; it lets ScreenFry's Chrome extension (and no other) start this app's binary to check in, receive a loadout, or erase its data. The app reads and writes nothing else outside its container and App Group.
>
> To try it: open ScreenFry, follow the Safari card (Safari Settings → Extensions → ScreenFry), then open YouTube in Safari and turn on Hide home feed in ScreenFry's toolbar popup. No account or sign-in is needed.
