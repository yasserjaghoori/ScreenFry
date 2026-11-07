import type { FeedSettings, FeedSite } from '@shared/index';

interface SiteDefinition {
  site: FeedSite;
  domains: string[];
  selectors: Record<string, string[]>;
}

export const siteDefinitions: SiteDefinition[] = [
  {
    site: 'youtube', domains: ['youtube.com'], selectors: {
      home: ['ytd-browse[page-subtype="home"] #contents', 'ytd-rich-grid-renderer'],
      shorts: ['ytd-reel-shelf-renderer', 'ytd-guide-entry-renderer a[href^="/shorts"]'],
      recommendations: ['#related ytd-watch-next-secondary-results-renderer', 'ytd-item-section-renderer[section-identifier="related-items"]'],
      comments: ['ytd-comments#comments']
    }
  },
  {
    site: 'x', domains: ['x.com', 'twitter.com'], selectors: {
      forYou: ['main [aria-label="Timeline: Your Home Timeline"]'],
      following: ['main [aria-label="Timeline: Your Home Timeline"]'],
      trending: ['[aria-label="Timeline: Trending now"]']
    }
  },
  { site: 'instagram', domains: ['instagram.com'], selectors: {
    home: ['main[role="main"] > div'], reels: ['a[href^="/reels"]'], explore: ['a[href="/explore/"]']
  } },
  { site: 'reddit', domains: ['reddit.com'], selectors: {
    home: ['shreddit-feed'], popular: ['shreddit-feed'], recommendations: ['faceplate-tracker[source="recommendation"]']
  } },
  { site: 'facebook', domains: ['facebook.com'], selectors: {
    main: ['[role="feed"]'], suggested: ['[role="article"]:has(a[href*="/ads/"])']
  } },
  { site: 'linkedin', domains: ['linkedin.com'], selectors: {
    main: ['.scaffold-finite-scroll__content'], recommended: ['.feed-shared-update-v2:has([data-test-icon="lightbulb-medium"])']
  } }
];

const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export function activeSelectors(settings: FeedSettings, host: string): string[] {
  if (!settings.globalEnabled) return [];
  const definition = siteDefinitions.find((candidate) => candidate.domains.some((domain) => hostMatches(host, domain)));
  if (!definition) return [];
  const selected = settings.sites[definition.site];
  return Object.entries(definition.selectors)
    .filter(([key]) => selected[key])
    .flatMap(([, selectors]) => selectors);
}

export function buildBlockingCss(settings: FeedSettings, host: string): string {
  return activeSelectors(settings, host).map((selector) => `${selector}{display:none!important}`).join('\n');
}
