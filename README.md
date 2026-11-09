# ScreenFry

<img src="apps/extension/public/icons/icon-128.png" width="96" height="96" alt="ScreenFry logo: a melting monitor with a clock face" />

**Less feed. More day.** ScreenFry is a Chrome and Safari extension that strips the distracting parts out of social websites and limits how long you spend on them, without taking away the useful parts.

> **Status:** development build, version 0.6.3. Releases are signed with a Developer ID (Bhron, LLC) and notarized by Apple. Chrome is covered by automated browser tests. The Mac app and Safari extension build and pass packaging checks, but live behavior on each website is still being verified. See [Testing](docs/TESTING.md).

## What it does

| | |
| --- | --- |
| **Hide distractions** | Turn off feeds, recommendations, comments and navigation buttons, site by site. Search, direct links, profiles and messages keep working. |
| **Block Shorts and Reels** | Blocks playback, not just the button: recognized direct links, notifications and in-page players are caught. TikTok has whole-site blocking and a linked-video-only option. |
| **Daily limits** | Give each website its own daily allowance, or none. When it runs out, the whole site is blocked, including tabs already open. Resets at midnight. |
| **Windows** | Schedule when websites are allowed, or when they're blocked (see below). |
| **Optional password** | Protect your settings from impulsive changes. It never grants extra time. The first time you change anything without one, ScreenFry explains it once and offers to set it up ("Not now" goes ahead with your change). |
| **Private** | Everything stays on your device. No account, server or analytics, and no record of the sites you visit. |

### Supported websites

| Website | Controls |
| --- | --- |
| **YouTube** | Home and subscriptions feeds · recommended videos beside the player, comments and end screens · **block Shorts entirely** · Explore, Subscriptions and Notifications buttons · thumbnails and banner ads |
| **Instagram** | Home feed and Stories · Explore feed · **block Reels entirely** · Home, Search, Explore, Reels, Messages, Notifications and Create buttons · suggested accounts |
| **X** | For You and Following feeds (separately) · Create Post box · trends, Who to follow and Premium promotions · Home, Explore, Notifications, Messages and Grok buttons · video playback |
| **Reddit** | Home, Popular/All and subreddit feeds (separately) · recommended posts · left sidebar, Chat, Notifications and Create Post buttons · comments and voting · video playback |
| **Substack** | Home and Notes feeds · Home, Notes, Explore, Notifications and Chat buttons · video playback |
| **TikTok** | For You, Following and Explore feeds · **only play the linked video** · comments · “You may like” recommendations and suggested accounts · For You, Explore, Following, LIVE, Messages, Activity and Upload buttons |

Every control starts **off**: a fresh install changes nothing until you choose. More websites can be added with one entry each; see [Adding a website](docs/ADDING_A_SITE.md).

The toolbar popup selects the current supported website and closes when that tab navigates or you switch tabs. Settings apply live where the content script responds; otherwise the active matching site refreshes once. Daily exhaustion shows an animated “Time is up!” screen (motion respects your system preference). Safari displays it in place without navigating to an extension URL. Timers reset at local midnight; other active blocks/windows still apply.

TikTok's old “Block videos entirely” switch has been removed. An enabled old switch migrates to **Block TikTok** in Essentials, preserving your choice; turn it off there to allow TikTok. The linked-video option stops next-video scrolling on a direct video URL while keeping comments scrollable. Live TikTok markup still needs manual acceptance checks.

## How time is counted

- A website's time counts while it's the **active tab** in the focused window, and while its **audio or video is playing** in the background, even muted.
- A background tab that isn't playing doesn't count.
- Several tabs of the same website count once, not once each.
- Chrome and Safari keep separate settings and separate time.

## Windows

The **Windows** page has two kinds of schedule. Each has a name, days, a start and end time (overnight works), and a list of websites, chosen from the supported sites or typed in.

- **Allow window:** the listed websites work *only* during the window. Outside every allow window they're blocked, even with time left.
- **Block window:** the listed websites are blocked *during* the window and work normally otherwise.
- **Free time:** the listed websites' feed blocking is paused *during* the window, for as many minutes a day as you give it (or the whole window). When the minutes run out or the window ends, feeds are hidden again; the website itself stays usable. Time inside counts down in an on-page timer.

Windows can't contradict each other: ScreenFry won't save (or switch on, or import) a block window that overlaps an allow or free-time window on the same website, and the editor explains which window clashes and when. Windows saved before this rule keep working, with **blocking winning** in the overlap, and their cards show a warning until you fix them. Daily limits always still apply.

*Example:* YouTube has a 10-minute limit and allow windows at 12–1 pm and 6–8 pm. That's 10 minutes total for the day, usable in either window, and YouTube is blocked at 3 pm even if none of it was used. A block window from 9 am to 5 pm on weekdays would instead keep YouTube off during work hours.

*Example (one browser for research and fun):* hide YouTube's home feed and Shorts with no daily limit, then add a free-time window from 7–9 pm with 30 minutes. All day, search and links work with the feed hidden; in the evening the feed and Shorts open up for 30 minutes, then hide again.

## Install

### Download (Mac)

1. Download the latest `ScreenFry-<version>.dmg` from [Releases](https://github.com/yasserjaghoori/ScreenFry/releases).
2. Open it and drag **ScreenFry** onto **Applications**, then open ScreenFry from Applications.
3. The app walks you through turning on **Safari** (one switch in Safari's settings, then allow it on websites) and **Chrome** (turn on Developer mode, then drag the ScreenFry tile onto Chrome's Extensions page).

Releases are signed with a Developer ID and notarized by Apple, so they open normally and Safari lists the extension without any developer settings.

### Build the installer yourself

You'll need [Node.js](https://nodejs.org) (the version in `.nvmrc`), Xcode signed in to your Apple ID (Xcode → Settings → Accounts), and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
npm ci
npm run dmg:local
```

This builds `dist/ScreenFry-<version>.dmg`, signed with your Mac's Apple Development identity, so Safari shows the extension without any developer settings.

Install it the same way as a download.

### Updating and uninstalling

**Updating:** drag a newer build over the old app. Both browsers update together and keep their settings. **Check for Updates…** opens the Releases page until release signing is set up, then uses the automatic updater. Version 0.6.0 changed the app's identifiers, so settings from earlier builds don't carry over: uninstall the old version first and set ScreenFry up again.

**Uninstalling:** **ScreenFry → Uninstall…** (also at the bottom of the window). **Keep Settings** removes the app and both extensions, but Chrome keeps your settings for a reinstall. **Erase Everything** also deletes ScreenFry's files on your Mac and opens Chrome's Extensions page so you can click **Remove**. Details are in [Distribution](docs/DISTRIBUTION.md).

### Build from source

To load the extensions without the Mac app (for development):

```bash
npm ci
npm run build
```

#### Chrome

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/chrome` folder.
3. Pin ScreenFry from the puzzle-piece menu.
4. *Optional:* under **Details**, turn on **Allow in Incognito**.

After rebuilding, click **Reload** on the ScreenFry card.

#### Safari (macOS)

You'll also need Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

1. Build and generate the project:
   ```bash
   npm run build:safari
   xcodegen generate --spec safari/ScreenFry/project.yml
   ```
2. Open `safari/ScreenFry/ScreenFry.xcodeproj`, pick a signing team for both targets, and run the **ScreenFry** scheme. This builds **ScreenFry.app**.
3. In Safari → **Settings → Extensions**, turn on **ScreenFry**.
4. Still there, click **Edit Websites** and set **Other Websites** to **Allow**. Safari can otherwise request access separately on individual websites. Website permissions and ScreenFry's controls are separate: granting access does not enable any blocking choices.
5. *Optional:* turn on **Allow in Private Browsing**.

Keep a single copy of ScreenFry.app installed; two copies register two extensions. More detail is in [Safari setup](docs/SAFARI.md).

## Development

```bash
npm run check       # unit tests, type check and a verified Chrome build
npm run test:e2e    # Chrome integration tests in a throwaway profile
npm run icons       # regenerate every icon from the source artwork
```

Run builds and integration tests one at a time, since both use `dist/chrome`.

| Folder | What's in it |
| --- | --- |
| `apps/extension` | Dashboard, popup, blocked page, background and content scripts |
| `packages/feed-blockers` | **The site registry:** every website's domains, controls and Shorts-style blocking |
| `packages/policy-engine` | Decides whether a page is allowed right now |
| `packages/core` | Settings, password checks, time tracking and data migration |
| `packages/browser-adapters` | Messaging, storage and Chrome/Safari differences |
| `safari/ScreenFry` | The Mac app that packages the Safari extension |

> Everything uses the ScreenFry name: the repository, Xcode project and scheme, npm package (`screenfry`) and the app's bundle identifiers (`com.screenfry.ScreenFry` and `com.screenfry.ScreenFry.Extension`).

## Limitations

- Websites change their layouts, which can break individual controls until they're updated.
- A regular video link with nothing marking it as a Short can't always be recognized as one.
- The password protects settings inside ScreenFry. It can't stop someone from turning the extension off or removing it.
- Chrome and Safari don't share settings, time or passwords.

More in [Enforcement limits](docs/THREAT_MODEL.md) and [Privacy](docs/PRIVACY.md).

## Credits

The interface is inspired by [SocialFocus](https://socialfocus.app); none of its code or artwork is used. Some feed selectors are adapted from [Saner Social Media](https://github.com/tobiasdalhof/sanersocialmedia) under the MIT license, whose full notice ships with both builds.

**Docs:** [Project brief](docs/PROJECT_BRIEF.md) · [Architecture](docs/ARCHITECTURE.md) · [Development setup](docs/SETUP.md) · [Testing](docs/TESTING.md) · [Safari](docs/SAFARI.md) · [Distribution](docs/DISTRIBUTION.md) · [Adding a website](docs/ADDING_A_SITE.md) · [Branding](assets/branding/README.md) · [AI handoff](docs/AI_HANDOFF.md)
