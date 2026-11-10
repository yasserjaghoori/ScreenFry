/** Feed selectors adapted in part from Saner Social Media, MIT, Tobias Dalhof.
 * See apps/extension/public/THIRD_PARTY_NOTICES.txt for attribution and the complete license.
 * Button labels/grouping follow observed SocialFocus behavior; its source/assets are not used.
 */
import type { FeedSettings, FeedSite } from "@shared/index";
import { hostMatchesDomain } from "@core/domains";
export interface FeedElement {
  label: string;
  group: string;
  selectors: string[];
  when?: (url: URL) => boolean;
  pauseMedia?: boolean;
}
/** Blocks a short-form video format (Shorts, Reels…) entirely when its setting is on. */
export interface ShortFormDefinition {
  /** Key in `elements` whose switch turns the block on, e.g. "shorts". */
  setting: string;
  /** Shown on the blocked page, e.g. "YouTube Shorts". */
  label: string;
  /** First path segment(s) of short-form URLs, as a regex fragment, e.g. "shorts" or "reels?". */
  pathSegment: string;
  /** Players that mean short-form is playing even without a short-form URL (modals, SPA). */
  playerSelectors: string[];
  /** A real short-form path, used by tests, e.g. "/shorts/abc". */
  examplePath: string;
}
/**
 * The single registry of supported websites. Adding a website means adding one entry here
 * (plus its id in the FeedSite type); the dashboard, popup, windows picker, default rules,
 * network rules and short-form blocking all read from this list. See docs/ADDING_A_SITE.md.
 */
export interface SiteDefinition {
  site: FeedSite;
  name: string;
  /** Main domain first; the rest are aliases and embed domains. Subdomains always match. */
  domains: string[];
  /** Brand color and a one-character mark for the site's avatar in the UI. */
  color: string;
  symbol: string;
  elements: Record<string, FeedElement>;
  shortForm?: ShortFormDefinition;
}
const path = (url: URL) => url.pathname.replace(/\/+$/, "") || "/";
const at =
  (...paths: string[]) =>
  (url: URL) =>
    paths.includes(path(url));
const element = (
  label: string,
  group: string,
  selectors: string[],
  when?: (url: URL) => boolean,
  pauseMedia = false,
): FeedElement => ({ label, group, selectors, when, pauseMedia });
export const siteDefinitions: SiteDefinition[] = [
  {
    site: "youtube",
    color: "#e34436",
    symbol: "▶",
    name: "YouTube",
    domains: ["youtube.com", "youtube-nocookie.com"],
    shortForm: {
      setting: "shorts",
      label: "YouTube Shorts",
      pathSegment: "shorts",
      examplePath: "/shorts/abc",
      playerSelectors: [
        "ytd-reel-video-renderer[is-active] video",
        "ytd-shorts:not([hidden]) ytd-reel-video-renderer[is-active]",
        '[data-testid="shorts-player"] video',
      ],
    },
    elements: {
      home: element(
        "Hide home feed",
        "Feeds",
        [
          'ytd-browse[page-subtype="home"] #primary',
          "ytm-browse ytm-rich-grid-renderer",
        ],
        at("/"),
        true,
      ),
      subscriptions: element(
        "Hide subscriptions feed",
        "Feeds",
        ['ytd-browse[page-subtype="subscriptions"] #primary'],
        at("/feed/subscriptions"),
        true,
      ),
      // While watching: the "Up next" column beside the player, which YouTube moves below
      // the video in narrow windows. Live chat and playlist panels stay visible.
      recommendations: element(
        "Hide recommended videos beside the player",
        "Video page",
        [
          "ytd-watch-flexy #related",
          "#secondary #related",
          "ytd-watch-next-secondary-results-renderer",
          "ytd-watch-flexy yt-related-chip-cloud-renderer",
          "#secondary yt-lockup-view-model",
          "#secondary ytd-compact-video-renderer",
          "#secondary ytd-compact-radio-renderer",
          "#secondary ytd-compact-playlist-renderer",
          'ytm-item-section-renderer[section-identifier="related-items"]',
        ],
      ),
      comments: element("Hide comments", "Video page", [
        "ytd-comments#comments",
        "ytm-comment-section-renderer",
      ]),
      endscreen: element("Hide endscreen recommendations", "Video page", [
        ".ytp-endscreen-content",
        ".ytp-ce-element",
        ".ytp-fullscreen-grid-main-content",
      ]),
      shorts: element(
        "Block Shorts entirely",
        "Short-form video",
        [
          "ytd-reel-shelf-renderer",
          "ytm-reel-shelf-renderer",
          "ytd-rich-shelf-renderer[is-shorts]",
          "ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])",
          'yt-lockup-view-model:has(a[href*="/shorts/"])',
          'ytd-video-renderer:has(a[href*="/shorts/"])',
          'grid-shelf-view-model:has(a[href*="/shorts/"])',
          'a[href^="/shorts"]',
          // Sidebar and mini-guide entries use a title/label rather than a /shorts/ href.
          'ytd-guide-entry-renderer:has(a[href^="/shorts"])',
          'ytd-guide-entry-renderer:has(a#endpoint[title="Shorts"])',
          'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
          'ytd-pivot-bar-item-renderer:has([title="Shorts"])',
          "ytd-shorts",
          "ytm-shorts-lockup-view-model",
          "ytm-shorts",
        ],
        undefined,
        true,
      ),
      exploreButton: element("Hide Explore button", "Navigation", [
        'ytd-guide-entry-renderer:has(a[href="/feed/explore"])',
        'a[href="/feed/explore"]',
      ]),
      subscriptionsButton: element("Hide Subscriptions button", "Navigation", [
        'ytd-guide-entry-renderer:has(a[href="/feed/subscriptions"])',
        'ytd-mini-guide-entry-renderer:has(a[href="/feed/subscriptions"])',
      ]),
      notificationsButton: element("Hide Notifications button", "Navigation", [
        "ytd-notification-topbar-button-renderer",
      ]),
      thumbnails: element("Hide thumbnails", "Appearance", [
        "ytd-thumbnail img",
        "yt-thumbnail-view-model img",
      ]),
      ads: element("Hide banner ads", "Appearance", [
        "ytd-ad-slot-renderer",
        "ytd-banner-promo-renderer",
        "ytd-display-ad-renderer",
      ]),
    },
  },
  {
    site: "instagram",
    color: "#b84783",
    symbol: "◎",
    name: "Instagram",
    domains: ["instagram.com", "instagr.am"],
    shortForm: {
      setting: "reels",
      label: "Instagram Reels",
      pathSegment: "reels?",
      examplePath: "/reel/abc",
      playerSelectors: ['[data-testid="reels-viewer"] video'],
    },
    elements: {
      home: element(
        "Hide home feed",
        "Home page",
        ['main[role="main"] > *', "main > article"],
        at("/"),
        true,
      ),
      stories: element(
        "Hide Stories",
        "Home page",
        [
          '[role="menu"]:has([role="menuitem"])',
          '[data-testid="stories-tray"]',
          'section:has(button[aria-label="Your story"])',
        ],
        at("/"),
        true,
      ),
      explore: element(
        "Hide Explore feed",
        "Feeds",
        ['main[role="main"] > *', "main > div"],
        at("/explore"),
        true,
      ),
      reels: element(
        "Block Reels entirely",
        "Short-form video",
        [
          'a[href^="/reel/"]',
          'a[href="/reels/"]',
          '[data-testid="reels-viewer"]',
        ],
        undefined,
        true,
      ),
      homeButton: element("Hide Home button", "Navigation", [
        'nav a[href="/"]',
        'a:has(svg[aria-label="Home"])',
      ]),
      searchButton: element("Hide Search button", "Navigation", [
        'a:has(svg[aria-label="Search"])',
      ]),
      exploreButton: element("Hide Explore button", "Navigation", [
        'a[href="/explore/"]',
      ]),
      reelsButton: element("Hide Reels button", "Navigation", [
        'a[href="/reels/"]',
        'a:has(svg[aria-label="Reels"])',
      ]),
      messagesButton: element("Hide Messages button", "Navigation", [
        'a[href^="/direct/"]',
      ]),
      notificationsButton: element("Hide Notifications button", "Navigation", [
        'a:has(svg[aria-label="Notifications"])',
      ]),
      createButton: element("Hide Create button", "Navigation", [
        'a:has(svg[aria-label="New post"])',
      ]),
      suggestions: element(
        "Hide suggested accounts",
        "Sidebar",
        ["aside", '[data-testid="suggested-users"]'],
        at("/"),
      ),
    },
  },
  {
    site: "x",
    color: "#333b46",
    symbol: "𝕏",
    name: "X",
    domains: ["x.com", "twitter.com"],
    // X opens videos in a full-screen viewer you can scroll through endlessly:
    // /<account>/status/<id>/video/<n>. Ordinary posts with a video stay as they are.
    shortForm: {
      setting: "videoFeed",
      label: "X video feed",
      pathSegment: "[^/]+/status/[0-9]+/video",
      examplePath: "/someone/status/123/video/1",
      playerSelectors: ['[aria-modal="true"] [data-testid="videoPlayer"]'],
    },
    elements: {
      forYou: element(
        "Hide For You feed",
        "Home page",
        [
          'html[data-screenfry-x-tab="0"] [data-testid="primaryColumn"] section[role="region"]',
        ],
        at("/home"),
        true,
      ),
      following: element(
        "Hide Following feed",
        "Home page",
        [
          'html[data-screenfry-x-tab="1"] [data-testid="primaryColumn"] section[role="region"]',
        ],
        at("/home"),
        true,
      ),
      compose: element(
        "Hide Create Post box",
        "Home page",
        [
          '[data-testid="primaryColumn"] [data-testid="tweetTextarea_0_label"]',
          '[data-testid="primaryColumn"] [data-testid="toolBar"]',
        ],
        at("/home"),
      ),
      trending: element("Hide trends", "Sidebar", [
        '[data-testid="sidebarColumn"] section',
      ]),
      suggestions: element("Hide Who to follow", "Sidebar", [
        '[data-testid="sidebarColumn"] aside',
      ]),
      premium: element("Hide Premium promotions", "Sidebar", [
        '[data-testid="sidebarColumn"] a[href*="/i/premium_sign_up"]',
      ]),
      homeButton: element("Hide Home button", "Navigation", [
        '[data-testid="AppTabBar_Home_Link"]',
      ]),
      exploreButton: element("Hide Explore button", "Navigation", [
        '[data-testid="AppTabBar_Explore_Link"]',
      ]),
      notificationsButton: element("Hide Notifications button", "Navigation", [
        '[data-testid="AppTabBar_Notifications_Link"]',
      ]),
      messagesButton: element("Hide Messages button", "Navigation", [
        '[data-testid="AppTabBar_DirectMessage_Link"]',
      ]),
      grokButton: element("Hide Grok button", "Navigation", [
        'a[href="/i/grok"]',
      ]),
      videos: element(
        "Block video playback",
        "Video",
        ['[data-testid="videoPlayer"]', "video"],
        undefined,
        true,
      ),
      videoFeed: element(
        "Block the video feed entirely",
        "Short-form video",
        ['[aria-modal="true"] [data-testid="videoPlayer"]'],
        undefined,
        true,
      ),
    },
  },
  {
    site: "reddit",
    color: "#db5827",
    symbol: "r",
    name: "Reddit",
    domains: ["reddit.com"],
    elements: {
      home: element(
        "Hide home feed",
        "Feeds",
        ["shreddit-feed", "#siteTable"],
        at("/", "/best", "/hot", "/new", "/top", "/rising"),
        true,
      ),
      popular: element(
        "Hide Popular and All feeds",
        "Feeds",
        ["shreddit-feed", "#siteTable"],
        at("/r/popular", "/r/all"),
        true,
      ),
      subreddits: element(
        "Hide subreddit feeds",
        "Feeds",
        ["shreddit-feed", "#siteTable"],
        (u) => /^\/r\/[^/]+(?:\/(?:hot|new|top|rising))?\/?$/.test(u.pathname),
        true,
      ),
      recommendations: element("Hide recommended posts", "Sidebar", [
        'faceplate-tracker[source="recommendation"]',
        "shreddit-recent-posts",
        "pdp-right-rail community-recommendation",
      ]),
      sidebar: element("Hide left sidebar", "Navigation", [
        "#left-sidebar-container",
      ]),
      chatButton: element("Hide Chat button", "Navigation", [
        'a[href^="https://chat.reddit.com"]',
        'button[aria-label="Open chat"]',
      ]),
      notificationsButton: element("Hide Notifications button", "Navigation", [
        'a[href="/notifications"]',
        'a[href="/notifications/"]',
        'a[href="/message/inbox/"]',
      ]),
      createButton: element("Hide Create Post button", "Navigation", [
        'a[href="/submit"]',
        'a[href$="/submit/"]',
      ]),
      comments: element("Hide comments", "Posts", [
        "shreddit-comment-tree",
        ".commentarea",
      ]),
      votes: element("Hide voting controls", "Posts", [
        '[slot="vote-button"]',
        ".midcol",
      ]),
      videos: element(
        "Block video playback",
        "Video",
        ["shreddit-player", "video"],
        undefined,
        true,
      ),
    },
  },
  {
    site: "substack",
    color: "#e57c34",
    symbol: "≡",
    name: "Substack",
    domains: ["substack.com"],
    elements: {
      home: element(
        "Hide Home feed",
        "Feeds",
        [
          'main [role="feed"]',
          '[data-testid="home-feed"]',
          '[class*="reader2-home"] [class*="feed"]',
          '[class*="reader2-home"] [class*="timeline"]',
          "main > div",
        ],
        at("/", "/home"),
        true,
      ),
      notes: element(
        "Hide Notes feed",
        "Feeds",
        ['main [role="feed"]', '[data-testid="notes-feed"]', "main > div"],
        at("/notes"),
        true,
      ),
      homeButton: element("Hide Home button", "Navigation", [
        'nav a[href="/home"]',
        'nav a[href="/"]',
      ]),
      notesButton: element("Hide Notes button", "Navigation", [
        'nav a[href="/notes"]',
        'a[aria-label="Notes"]',
      ]),
      exploreButton: element("Hide Explore button", "Navigation", [
        'nav a[href="/discover"]',
        'nav a[href="/explore"]',
      ]),
      notificationsButton: element("Hide Notifications button", "Navigation", [
        'nav a[href="/activity"]',
        'a[aria-label="Notifications"]',
      ]),
      chatButton: element("Hide Chat button", "Navigation", [
        'nav a[href="/chat"]',
        'a[aria-label="Chat"]',
      ]),
      videos: element(
        "Block video playback",
        "Video",
        ["video", '[data-testid="video-player"]'],
        undefined,
        true,
      ),
    },
  },
  {
    // Selectors use TikTok's data-e2e test attributes, which change less often than class
    // names. Not yet verified against live signed-in TikTok.
    site: "tiktok",
    color: "#fe2c55",
    symbol: "♪",
    name: "TikTok",
    domains: ["tiktok.com"],
    elements: {
      forYou: element(
        "Hide For You feed",
        "Feeds",
        [
          "#main-content-homepage_hot",
          '[data-e2e="recommend-list-item-container"]',
        ],
        at("/", "/foryou", "/en"),
        true,
      ),
      following: element(
        "Hide Following feed",
        "Feeds",
        [
          '[data-e2e="recommend-list-item-container"]',
          "#main-content-following",
        ],
        at("/following"),
        true,
      ),
      explore: element(
        "Hide Explore feed",
        "Feeds",
        ['[data-e2e="explore-item-list"]', "#main-content-explore_page"],
        at("/explore"),
        true,
      ),
      singleVideo: element(
        "Only play the linked video",
        "Video page",
        [
          '[data-e2e="arrow-left"]',
          '[data-e2e="arrow-right"]',
          '[data-e2e="browse-video-prev"]',
          '[data-e2e="browse-video-next"]',
        ],
        (url) => /\/@[^/]+\/video\/[^/]+/.test(url.pathname),
      ),
      comments: element("Hide comments", "Video page", [
        '[data-e2e="comment-list"]',
        '[data-e2e="search-comment-container"]',
        '[data-e2e="browse-comment"]',
      ]),
      recommendedVideos: element(
        "Hide “You may like” recommended videos",
        "Sidebar",
        [
          '[data-e2e="browse-video-recommend"]',
          '[data-e2e="recommend-video-list"]',
          '[data-e2e="related-video"]',
        ],
        (url) => /\/@[^/]+\/video\/[^/]+/.test(url.pathname),
      ),
      suggestedAccounts: element("Hide suggested accounts", "Sidebar", [
        '[data-e2e="recommend-user"]',
        '[data-e2e="suggest-accounts"]',
      ]),
      forYouButton: element("Hide For You button", "Navigation", [
        '[data-e2e="nav-foryou"]',
      ]),
      exploreButton: element("Hide Explore button", "Navigation", [
        '[data-e2e="nav-explore"]',
        'a[href="/explore"]',
      ]),
      followingButton: element("Hide Following button", "Navigation", [
        '[data-e2e="nav-following"]',
        'a[href="/following"]',
      ]),
      liveButton: element("Hide LIVE button", "Navigation", [
        '[data-e2e="nav-live"]',
        'a[href="/live"]',
      ]),
      messagesButton: element("Hide Messages button", "Navigation", [
        '[data-e2e="nav-messages"]',
        'a[href^="/messages"]',
      ]),
      activityButton: element("Hide Activity button", "Navigation", [
        '[data-e2e="nav-activity"]',
        '[data-e2e="inbox-icon"]',
      ]),
      uploadButton: element("Hide Upload button", "Navigation", [
        '[data-e2e="nav-upload"]',
        '[data-e2e="upload-icon"]',
        'a[href*="/upload"]',
      ]),
    },
  },
  {
    site: "facebook",
    color: "#1877f2",
    symbol: "f",
    name: "Facebook",
    domains: ["facebook.com", "fb.com", "fb.watch"],
    shortForm: {
      setting: "reels",
      label: "Facebook Reels",
      pathSegment: "reels?",
      examplePath: "/reel/123",
      playerSelectors: ['[aria-label="Reels"] video', 'div[data-pagelet*="Reels"] video'],
    },
    elements: {
      feed: element("Hide News Feed", "Home page", ['[role="main"] [role="feed"]'], at("/", "/home.php"), true),
      stories: element("Hide Stories", "Home page", ['[aria-label="Stories"]', '[data-pagelet="Stories"]'], at("/", "/home.php")),
      rightRail: element("Hide sponsored and contacts sidebar", "Home page", ['[role="complementary"]'], at("/", "/home.php")),
      watch: element("Hide Video feed", "Video", ['[role="main"]'], (url) => /^\/(watch|video)(\/|$)/i.test(url.pathname), true),
      reels: element("Block Reels entirely", "Short-form video", ['[aria-label="Reels"]', 'div[data-pagelet*="Reels"]'], undefined, true),
      videoButton: element("Hide Video button", "Navigation", ['a[href*="/watch"][role="link"]', 'a[aria-label="Video"]']),
      marketplaceButton: element("Hide Marketplace button", "Navigation", ['a[href*="/marketplace"][role="link"]', 'a[aria-label="Marketplace"]']),
      gamingButton: element("Hide Gaming button", "Navigation", ['a[href*="/gaming"][role="link"]', 'a[aria-label="Gaming"]']),
      notificationsButton: element("Hide Notifications button", "Navigation", ['[aria-label="Notifications"]']),
    },
  },
  {
    site: "linkedin",
    color: "#0a66c2",
    symbol: "L",
    name: "LinkedIn",
    domains: ["linkedin.com", "lnkd.in"],
    elements: {
      feed: element(
        "Hide home feed",
        "Home page",
        ['[data-finite-scroll-hotkey-context="FEED"]', "main .scaffold-finite-scroll"],
        at("/feed", "/feed/"),
        true,
      ),
      news: element("Hide LinkedIn News", "Sidebar", ["#feed-news-module", '[aria-label="LinkedIn News"]']),
      suggestions: element("Hide Add to your feed", "Sidebar", ['[aria-label="Add to your feed"]', ".feed-follows-module"]),
      notificationsButton: element("Hide Notifications button", "Navigation", ['.global-nav a[href*="/notifications/"]']),
      messagingButton: element("Hide Messaging button", "Navigation", ['.global-nav a[href*="/messaging/"]']),
      videos: element("Block video playback", "Video", ["video"], undefined, true),
    },
  },
];
export function siteFor(host: string): SiteDefinition | undefined {
  return siteDefinitions.find((site) =>
    site.domains.some((domain) => hostMatchesDomain(host, domain)),
  );
}
export function enabledElements(
  settings: FeedSettings,
  href: string,
): FeedElement[] {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return [];
  }
  if (!settings.globalEnabled) return [];
  const site = siteFor(url.hostname);
  if (!site) return [];
  return Object.entries(site.elements)
    .filter(
      ([key, value]) =>
        settings.sites[site.site]?.[key] && (!value.when || value.when(url)),
    )
    .map(([, value]) => value);
}
export const activeSelectors = (settings: FeedSettings, href: string) =>
  enabledElements(settings, href).flatMap((value) => value.selectors);
export const buildBlockingCss = (settings: FeedSettings, href: string) =>
  activeSelectors(settings, href)
    .map((selector) => `${selector}{display:none!important}`)
    .join("\n");
/** The site's short-form definition, when its "block entirely" setting is on. */
export function activeShortForm(
  settings: FeedSettings,
  host: string,
): ShortFormDefinition | undefined {
  if (!settings.globalEnabled) return;
  const site = siteFor(host);
  const short = site?.shortForm;
  return short && settings.sites[site.site]?.[short.setting]
    ? short
    : undefined;
}
/** Matches a short-form URL path such as /shorts/abc or /reel/abc. */
export const shortFormPath = (short: ShortFormDefinition) =>
  new RegExp(`^/(?:${short.pathSegment})(?:/|$)`, "i");
/** These are content restrictions, not URL rewrites into a different player. */
export function shortFormBlock(
  settings: FeedSettings,
  href: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  const short = activeShortForm(settings, url.hostname);
  return short && shortFormPath(short).test(url.pathname)
    ? short.label
    : undefined;
}
/** Every short-form label, for pages that must recognise one. */
export const shortFormLabels = siteDefinitions.flatMap((s) =>
  s.shortForm ? [s.shortForm.label] : [],
);
export function feedLabels(site: FeedSite): Record<string, string> {
  return Object.fromEntries(
    Object.entries(siteDefinitions.find((s) => s.site === site)!.elements).map(
      ([key, value]) => [key, value.label],
    ),
  );
}
