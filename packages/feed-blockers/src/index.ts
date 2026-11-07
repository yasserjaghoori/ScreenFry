import type { FeedSettings, FeedSite } from '@shared/index';

/**
 * Site-specific feed blocking. Each element lists CSS selectors and, where the same component
 * appears on useful pages (channel pages, subreddits, profiles), a path predicate so only the
 * feed surface is hidden. Direct links and search stay usable.
 *
 * Selectors target third-party markup that changes without notice. Keep them here, in one
 * table, so a broken site is a one-line fix.
 */
export interface FeedElement {
  label: string;
  selectors: string[];
  /** When present, selectors apply only on matching URLs. */
  when?: (url: URL) => boolean;
  /** Optional rewrite to a non-feed equivalent of the same content (e.g. Shorts → normal player). */
  redirect?: (url: URL) => string | undefined;
}

export interface SiteDefinition {
  site: FeedSite;
  name: string;
  domains: string[];
  elements: Record<string, FeedElement>;
}

const path = (url: URL) => url.pathname.replace(/\/+$/, '') || '/';
const pathIs = (...paths: string[]) => (url: URL) => paths.includes(path(url));

export const siteDefinitions: SiteDefinition[] = [
  {
    site: 'youtube', name: 'YouTube', domains: ['youtube.com'], elements: {
      home: { label: 'Homepage feed', selectors: ['ytd-browse[page-subtype="home"] ytd-rich-grid-renderer', 'ytm-browse ytm-rich-grid-renderer'], when: pathIs('/') },
      shorts: {
        label: 'Shorts',
        selectors: [
          'ytd-reel-shelf-renderer', 'ytm-reel-shelf-renderer', 'ytd-rich-shelf-renderer[is-shorts]',
          'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
          'ytd-guide-entry-renderer:has(a[title="Shorts"])', 'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
          'yt-chip-cloud-chip-renderer:has([title="Shorts"])'
        ],
        redirect: (url) => {
          const match = /^\/shorts\/([\w-]{6,})/.exec(url.pathname);
          return match ? `${url.origin}/watch?v=${match[1]}` : undefined;
        }
      },
      recommendations: { label: 'Recommended videos', selectors: ['ytd-watch-flexy #related', 'ytd-watch-next-secondary-results-renderer', '.ytp-endscreen-content', '.ytp-ce-element', 'ytm-item-section-renderer[section-identifier="related-items"]'] },
      comments: { label: 'Comments', selectors: ['ytd-comments#comments', 'ytm-comment-section-renderer', 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]'] }
    }
  },
  {
    site: 'x', name: 'X / Twitter', domains: ['x.com', 'twitter.com'], elements: {
      // X renders both home tabs into the same timeline; the content script marks which tab is selected.
      forYou: { label: 'For You feed', selectors: ['html[data-screentime-x-tab="0"] [data-testid="primaryColumn"] section[role="region"]'], when: pathIs('/home') },
      following: { label: 'Following feed', selectors: ['html[data-screentime-x-tab="1"] [data-testid="primaryColumn"] section[role="region"]'], when: pathIs('/home') },
      trending: { label: 'Trending', selectors: ['[aria-label="Timeline: Trending now"]', '[data-testid="sidebarColumn"] section:has([aria-label="Timeline: Trending now"])', '[data-testid="sidebarColumn"] div:has(> div > [data-testid="trend"])'] }
    }
  },
  {
    site: 'instagram', name: 'Instagram', domains: ['instagram.com'], elements: {
      home: { label: 'Home feed', selectors: ['main[role="main"]'], when: pathIs('/') },
      // The Reels feed lives at /reels/; individual reels at /reel/<id> stay viewable from direct links.
      reels: { label: 'Reels', selectors: ['a[href="/reels/"]'] },
      reelsFeed: { label: 'Reels', selectors: ['main[role="main"]'], when: pathIs('/reels') },
      explore: { label: 'Explore', selectors: ['main[role="main"]'], when: pathIs('/explore') }
    }
  },
  {
    site: 'reddit', name: 'Reddit', domains: ['reddit.com'], elements: {
      home: { label: 'Homepage feed', selectors: ['shreddit-feed', '#siteTable'], when: pathIs('/', '/best', '/hot', '/new', '/top', '/rising') },
      popular: { label: 'Popular feed', selectors: ['shreddit-feed', '#siteTable'], when: pathIs('/r/popular', '/r/all') },
      recommendations: { label: 'Recommendations', selectors: ['faceplate-tracker[source="recommendation"]', 'shreddit-recent-posts', 'pdp-right-rail community-recommendation'] }
    }
  },
  {
    site: 'facebook', name: 'Facebook', domains: ['facebook.com'], elements: {
      main: { label: 'Main feed', selectors: ['[role="main"] [role="feed"]'], when: pathIs('/', '/home.php') },
      suggested: { label: 'Suggested posts', selectors: ['[role="feed"] [role="article"]:has(a[href*="/ads/"])', '[role="feed"] > div:has([aria-label="Suggested for you"])'] }
    }
  },
  {
    site: 'linkedin', name: 'LinkedIn', domains: ['linkedin.com'], elements: {
      main: { label: 'Main feed', selectors: ['.scaffold-finite-scroll__content', 'main [data-finite-scroll-hotkey-context="FEED"]'], when: pathIs('/feed') },
      recommended: { label: 'Recommended posts', selectors: ['.feed-shared-update-v2:has([data-test-icon="lightbulb-medium"])', 'aside .feed-follows-module'] }
    }
  }
];

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function siteFor(host: string): SiteDefinition | undefined {
  const normalized = host.toLowerCase().replace(/^www\./, '');
  return siteDefinitions.find((candidate) => candidate.domains.some((domain) => hostMatches(normalized, domain)));
}

/** Setting keys shown to the user (aliases like `reelsFeed` follow their parent toggle). */
const settingKey = (element: string) => (element === 'reelsFeed' ? 'reels' : element);

function enabledElements(settings: FeedSettings, url: URL): FeedElement[] {
  if (!settings.globalEnabled) return [];
  const definition = siteFor(url.hostname);
  if (!definition) return [];
  const selected = settings.sites[definition.site] ?? {};
  return Object.entries(definition.elements)
    .filter(([key]) => selected[settingKey(key)])
    .map(([, element]) => element);
}

export function activeSelectors(settings: FeedSettings, href: string): string[] {
  let url: URL;
  try { url = new URL(href); } catch { return []; }
  return enabledElements(settings, url)
    .filter((element) => !element.when || element.when(url))
    .flatMap((element) => element.selectors);
}

export function buildBlockingCss(settings: FeedSettings, href: string): string {
  // One rule per selector: an unsupported selector (e.g. :has in an old engine) must not void the others.
  return activeSelectors(settings, href).map((selector) => `${selector}{display:none!important}`).join('\n');
}

export function feedRedirect(settings: FeedSettings, href: string): string | undefined {
  let url: URL;
  try { url = new URL(href); } catch { return undefined; }
  for (const element of enabledElements(settings, url)) {
    const target = element.redirect?.(url);
    if (target && target !== href) return target;
  }
  return undefined;
}

export function feedLabels(site: FeedSite): Record<string, string> {
  const definition = siteDefinitions.find((candidate) => candidate.site === site)!;
  return Object.fromEntries(Object.entries(definition.elements).filter(([key]) => key === settingKey(key)).map(([key, element]) => [key, element.label]));
}
