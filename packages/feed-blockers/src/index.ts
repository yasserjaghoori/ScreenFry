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
export interface SiteDefinition {
  site: FeedSite;
  name: string;
  domains: string[];
  elements: Record<string, FeedElement>;
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
    name: "YouTube",
    domains: ["youtube.com", "youtube-nocookie.com"],
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
      recommendations: element("Hide video recommendations", "Video page", [
        "#secondary #related",
        "ytd-watch-next-secondary-results-renderer",
        'ytm-item-section-renderer[section-identifier="related-items"]',
      ]),
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
          'a[href^="/shorts/"]',
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
    name: "Instagram",
    domains: ["instagram.com", "instagr.am"],
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
    name: "X",
    domains: ["x.com", "twitter.com"],
    elements: {
      forYou: element(
        "Hide For You feed",
        "Home page",
        [
          'html[data-screentime-x-tab="0"] [data-testid="primaryColumn"] section[role="region"]',
        ],
        at("/home"),
        true,
      ),
      following: element(
        "Hide Following feed",
        "Home page",
        [
          'html[data-screentime-x-tab="1"] [data-testid="primaryColumn"] section[role="region"]',
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
    },
  },
  {
    site: "reddit",
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
  if (!settings.globalEnabled) return;
  const site = siteFor(url.hostname)?.site;
  if (
    site === "youtube" &&
    settings.sites.youtube.shorts &&
    /^\/shorts(?:\/|$)/i.test(url.pathname)
  )
    return "YouTube Shorts";
  if (
    site === "instagram" &&
    settings.sites.instagram.reels &&
    /^\/reels?(?:\/|$)/i.test(url.pathname)
  )
    return "Instagram Reels";
}
export function feedLabels(site: FeedSite): Record<string, string> {
  return Object.fromEntries(
    Object.entries(siteDefinitions.find((s) => s.site === site)!.elements).map(
      ([key, value]) => [key, value.label],
    ),
  );
}
