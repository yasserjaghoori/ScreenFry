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
  /** One line under the switch explaining what it does. */
  note?: string;
  /** Another switch that must be on for this one to apply; the UI indents it under that one. */
  requires?: string;
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
 * Research mode: a short-form video opened from a link plays, but nothing past it does. The
 * first video a page reaches becomes "the linked video"; scrolling or clicking to another
 * video, or on to its creator's profile, shows the blocked screen until the page is loaded
 * fresh. Pages visited before the linked video stay reachable (for example, back to search).
 */
export interface ResearchDefinition {
  /** Key in `elements` whose switch turns research mode on. */
  setting: string;
  /** The "block entirely" setting research mode loosens; it only applies while that is on. */
  requires?: string;
  /** The short-form video at this address, if any. Query strings never make a new video. */
  videoId: (url: URL) => string | undefined;
  /** Where the wheel, touch or arrow keys would move on to another video. */
  scrollSelectors: string[];
  /** Panels that keep scrolling inside a guarded player, such as comments. */
  keepScrolling?: string[];
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
  research?: ResearchDefinition;
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
const idFrom = (pattern: RegExp) => (url: URL) => pattern.exec(url.pathname)?.[1];
/** Research mode's switch, indented under the "block entirely" switch it loosens. */
const researchElement = (
  noun: string,
  requires: string | undefined,
  selectors: string[],
  when?: (url: URL) => boolean,
): FeedElement => ({
  label: `Research mode: open ${noun} from links only`,
  group: "Short-form video",
  selectors,
  when,
  requires,
  note: `${requires ? `Unlike blocking ${noun} entirely, a` : "A"} ${noun.replace(/s$/, "")} opened from a link still plays. You can’t scroll on to the next one or open its creator’s page; load the page again to open another link.`,
});
/** A Facebook tab in the top bar and its entry in the left menu, by link address. */
const fbTab = (path: string) => [
  `[role="banner"] [role="navigation"] span:has(> div > a[href^="${path}"])`,
  `[role="navigation"] li:has(a[href^="https://www.facebook.com${path}"])`,
];
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
    research: {
      setting: "shortsFromLinks",
      requires: "shorts",
      videoId: idFrom(/^\/shorts\/([^/?#]+)/),
      scrollSelectors: ["ytd-shorts", "#shorts-container", "ytm-shorts", "video"],
      keepScrolling: ["ytd-engagement-panel-section-list-renderer", "#comments"],
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
      shortsFromLinks: researchElement(
        "Shorts",
        "shorts",
        ["#navigation-button-up", "#navigation-button-down", "ytd-shorts .navigation-container"],
        (url) => url.pathname.startsWith("/shorts/"),
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
    research: {
      setting: "reelsFromLinks",
      requires: "reels",
      videoId: idFrom(/^\/reels?\/([^/?#]+)/),
      scrollSelectors: ["main", "video"],
      keepScrolling: ['[role="dialog"]'],
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
      reelsFromLinks: researchElement("Reels", "reels", []),
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
    research: {
      setting: "videoFeedFromLinks",
      requires: "videoFeed",
      videoId: idFrom(/^\/[^/]+\/status\/([0-9]+)\/video(?:\/|$)/),
      scrollSelectors: ['[aria-modal="true"]'],
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
      trending: element("Hide trends and news", "Sidebar", [
        '[data-testid="sidebarColumn"] section',
        // "Today’s News" and live scores sit outside the trends section.
        '[data-testid="sidebarColumn"] [data-testid$="_sidebar"]',
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
      videoFeedFromLinks: researchElement("videos", "videoFeed", []),
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
      recentPosts: element("Hide Recent Posts", "Sidebar", [
        "recent-posts",
        "shreddit-recent-posts",
        "#right-sidebar-container recent-posts",
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
        '[role="navigation"] a[aria-label="Home"]',
        '[role="navigation"] a[href="/home"]',
      ]),
      subscriptionsButton: element("Hide Subscriptions button", "Navigation", [
        '[role="navigation"] a[aria-label="Subscriptions"]',
        '[role="navigation"] a[href^="/subscriptions"]',
      ]),
      exploreButton: element("Hide Explore button", "Navigation", [
        '[role="navigation"] a[aria-label="Explore"]',
        'a[href="/explore"]',
        'a[href="/discover"]',
      ]),
      notificationsButton: element("Hide Activity button", "Navigation", [
        '[role="navigation"] a[aria-label="Activity"]',
        'a[href="/activity"]',
      ]),
      chatButton: element("Hide Chat button", "Navigation", [
        '[role="navigation"] a[aria-label="Chat"]',
        'a[href="/chat"]',
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
    // TikTok is all short videos, so research mode stands on its own.
    research: {
      setting: "singleVideo",
      videoId: idFrom(/^\/@[^/]+\/(?:video|photo)\/([^/?#]+)/),
      scrollSelectors: [
        "video",
        '[data-e2e="browse-video"]',
        '[data-e2e="feed-video"]',
        '[data-e2e="recommend-list-item-container"]',
        "#column-list-container",
      ],
      keepScrolling: ['[data-e2e*="comment"]', '[class*="RightPanel"]'],
    },
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
      singleVideo: researchElement(
        "videos",
        undefined,
        [
          '[data-e2e="arrow-left"]',
          '[data-e2e="arrow-right"]',
          '[data-e2e="browse-video-prev"]',
          '[data-e2e="browse-video-next"]',
          '[data-e2e="feed-navigation-prev"]',
          '[data-e2e="feed-navigation-next"]',
        ],
        (url) => /\/@[^/]+\/(video|photo)\/[^/]+/.test(url.pathname),
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
          '[data-e2e="video-detail-related-video"]',
          '[class*="--DivRelatedTabContainer"]',
          // The "You may like" tab beside Comments.
          '[class*="RightPanel"] [class*="tux-tabbar__item-container"] > :nth-child(2)',
        ],
        (url) => /\/@[^/]+\/video\/[^/]+/.test(url.pathname),
      ),
      suggestedAccounts: element("Hide suggested accounts", "Sidebar", [
        '[data-e2e="recommend-user"]',
        '[data-e2e="suggest-accounts"]',
        // Profile pages: the "Suggested accounts" button and its cards.
        '[data-e2e="show-suggested-accounts"]',
        '[class*="--DivUserCardListContainer"]',
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
    research: {
      setting: "reelsFromLinks",
      requires: "reels",
      videoId: idFrom(/^\/reels?\/([0-9]+)/),
      scrollSelectors: ['[role="main"]', "video"],
      keepScrolling: ['[role="complementary"]', '[role="dialog"]'],
    },
    // Checked against signed-in Facebook (Nov 2026): class names are generated, so these use
    // roles, labels, headings and link addresses.
    elements: {
      feed: element(
        "Hide home feed",
        "Home page",
        [
          // The column of posts under its "Feed posts" heading; Stories and the post box are
          // regions of their own.
          '[role="main"] div:has(> h3):not([role="region"]):not([role="region"] *)',
          '[role="main"] [role="feed"]',
        ],
        at("/", "/home.php"),
        true,
      ),
      stories: element("Hide Stories", "Home page", ['[role="region"][aria-label="Stories"]', '[aria-label="Stories"]'], at("/", "/home.php")),
      rightRail: element("Hide sponsored and contacts sidebar", "Home page", ['[role="complementary"]'], at("/", "/home.php")),
      watch: element("Hide Video feed", "Video", ['[role="main"]'], (url) => /^\/(watch|video)(\/|$)/i.test(url.pathname), true),
      reels: element("Block Reels entirely", "Short-form video", [...fbTab("/reel"), '[aria-label="Reels"]', 'div[data-pagelet*="Reels"]'], undefined, true),
      reelsFromLinks: researchElement("Reels", "reels", []),
      reelsButton: element("Hide Reels button", "Navigation", fbTab("/reel")),
      groupsButton: element("Hide Groups button", "Navigation", fbTab("/groups/")),
      marketplaceButton: element("Hide Marketplace button", "Navigation", fbTab("/marketplace")),
      gamingButton: element("Hide Gaming button", "Navigation", fbTab("/gaming")),
      notificationsButton: element("Hide Notifications button", "Navigation", [
        '[role="banner"] [role="navigation"] > div:has([role="button"][aria-label^="Notifications"])',
        '[role="banner"] [role="button"][aria-label^="Notifications"]',
      ]),
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
  const on = settings.sites[site.site] ?? {};
  // On a video research mode lets through, the "block entirely" rules would hide its player.
  const research = researchMode(settings, url.hostname);
  const lifted = research?.requires && research.videoId(url) ? research.requires : undefined;
  return Object.entries(site.elements)
    .filter(
      ([key, value]) =>
        on[key] &&
        key !== lifted &&
        (!value.requires || on[value.requires]) &&
        (!value.when || value.when(url)),
    )
    .map(([, value]) => value);
}
/** The site's research mode, when it is switched on (and so is the block it loosens). */
export function researchMode(
  settings: FeedSettings,
  host: string,
): ResearchDefinition | undefined {
  if (!settings.globalEnabled) return;
  const site = siteFor(host);
  const research = site?.research;
  const on = site && settings.sites[site.site];
  return research && on?.[research.setting] && (!research.requires || on[research.requires])
    ? research
    : undefined;
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
  if (researchMode(settings, host)) return;
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
