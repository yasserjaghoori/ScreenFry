# ScreenFry

<img src="apps/extension/public/icons/icon-128.png" width="96" height="96" alt="ScreenFry logo: a melting monitor with a clock face" />

**Less feed. More day.** ScreenFry is a Chrome and Safari extension that strips the distracting parts out of social websites and limits how long you spend on them, without taking away the useful parts.

> **Status:** development build, version 0.5.1. Chrome is covered by automated browser tests. Safari builds, installs and passes packaging checks, but its live behavior is still being verified. See [Testing](docs/TESTING.md).

## What it does

| | |
| --- | --- |
| **Hide distractions** | Turn off feeds, recommendations, comments and navigation buttons, site by site. Search, direct links, profiles and messages keep working. |
| **Block Shorts, Reels and TikToks** | Blocks them completely, not just the button: direct links, notifications and in-page players are all caught. |
| **Daily limits** | Give each website its own daily allowance, or none. When it runs out, the whole site is blocked, including tabs already open. Resets at midnight. |
| **Windows** | Schedule when websites are allowed, or when they're blocked (see below). |
| **Optional password** | Protect your settings from impulsive changes. It never grants extra time. |
| **Private** | Everything stays on your device. No account, server or analytics, and no record of the sites you visit. |

### Supported websites

| Website | Controls |
| --- | --- |
| **YouTube** | Home and subscriptions feeds · recommended videos beside the player, comments and end screens · **block Shorts entirely** · Explore, Subscriptions and Notifications buttons · thumbnails and banner ads |
| **Instagram** | Home feed and Stories · Explore feed · **block Reels entirely** · Home, Search, Explore, Reels, Messages, Notifications and Create buttons · suggested accounts |
| **X** | For You and Following feeds (separately) · Create Post box · trends, Who to follow and Premium promotions · Home, Explore, Notifications, Messages and Grok buttons · video playback |
| **Reddit** | Home, Popular/All and subreddit feeds (separately) · recommended posts · left sidebar, Chat, Notifications and Create Post buttons · comments and voting · video playback |
| **Substack** | Home and Notes feeds · Home, Notes, Explore, Notifications and Chat buttons · video playback |
| **TikTok** | For You, Following and Explore feeds · **block videos entirely** · comments · For You, Explore, Following, LIVE, Messages, Activity and Upload buttons · suggested accounts |

Every control starts **off**: a fresh install changes nothing until you choose. More websites can be added with one entry each; see [Adding a website](docs/ADDING_A_SITE.md).

## How time is counted

- A website's time counts while it's the **active tab** in the focused window, and while its **audio or video is playing** in the background, even muted.
- A background tab that isn't playing doesn't count.
- Several tabs of the same website count once, not once each.
- Chrome and Safari keep separate settings and separate time.

## Windows

The **Windows** page has two kinds of schedule. Each has a name, days, a start and end time (overnight works), and a list of websites, chosen from the supported sites or typed in.

- **Allow window:** the listed websites work *only* during the window. Outside every allow window they're blocked, even with time left.
- **Block window:** the listed websites are blocked *during* the window and work normally otherwise.

If an allow window and a block window overlap, **blocking wins**. Daily limits always still apply.

*Example:* YouTube has a 10-minute limit and allow windows at 12–1 pm and 6–8 pm. That's 10 minutes total for the day, usable in either window, and YouTube is blocked at 3 pm even if none of it was used. A block window from 9 am to 5 pm on weekdays would instead keep YouTube off during work hours.

## Install

### Download (Mac)

1. Download the latest `ScreenFry-<version>.dmg` from [Releases](https://github.com/yasserjaghoori/Screentime/releases).
2. Open it and drag **ScreenFry** onto **Applications**, then open ScreenFry from Applications.
3. The app walks you through turning on **Safari** (one switch in Safari's settings) and **Chrome** (turn on Developer mode, then drag the ScreenFry tile onto Chrome's Extensions page).

To update, drag a newer download over the old app, or use **Check for Updates…** once updates are turned on. Both browsers update together and keep your settings. Current downloads are test builds that aren't yet signed by Apple, so the first open needs **Open Anyway** in System Settings. Details are in [Distribution](docs/DISTRIBUTION.md).

### Build from source

You'll need [Node.js](https://nodejs.org) (the version in `.nvmrc`).

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

> The local project folder and Xcode project/scheme are **ScreenFry**; the npm package is **screenfry**. The GitHub URL and existing browser bundle/storage identifiers keep their legacy values for compatibility.

## Limitations

- Websites change their layouts, which can break individual controls until they're updated.
- A regular video link with nothing marking it as a Short can't always be recognized as one.
- The password protects settings inside ScreenFry. It can't stop someone from turning the extension off or removing it.
- Chrome and Safari don't share settings, time or passwords.

More in [Enforcement limits](docs/THREAT_MODEL.md) and [Privacy](docs/PRIVACY.md).

## Credits

The interface is inspired by [SocialFocus](https://socialfocus.app); none of its code or artwork is used. Some feed selectors are adapted from [Saner Social Media](https://github.com/tobiasdalhof/sanersocialmedia) under the MIT license, whose full notice ships with both builds.

**Docs:** [Project brief](docs/PROJECT_BRIEF.md) · [Architecture](docs/ARCHITECTURE.md) · [Development setup](docs/SETUP.md) · [Testing](docs/TESTING.md) · [Safari](docs/SAFARI.md) · [Distribution](docs/DISTRIBUTION.md) · [Adding a website](docs/ADDING_A_SITE.md) · [Branding](assets/branding/README.md) · [AI handoff](docs/AI_HANDOFF.md)
