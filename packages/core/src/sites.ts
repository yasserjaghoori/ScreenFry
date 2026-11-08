import type { FeedSite, WebsiteRule } from "@shared/index";
import { siteDefinitions } from "@feeds/index";
import { expandDomainAliases } from "./domains";

/**
 * Websites shown on the Websites page, popup and Windows picker, in registry order.
 * Derived from the site registry in packages/feed-blockers, so a new site needs no edits here.
 */
export const launchSites: {
  id: FeedSite;
  name: string;
  domain: string;
  color: string;
  symbol: string;
}[] = siteDefinitions.map((site) => ({
  id: site.site,
  name: site.name,
  domain: site.domains[0],
  color: site.color,
  symbol: site.symbol,
}));
export function defaultRules(): WebsiteRule[] {
  return siteDefinitions.map((site) => ({
    id: site.site,
    label: site.name,
    domains: expandDomainAliases(site.domains),
    enabled: true,
    blocked: false,
    showTimer: false,
    createdAt: 0,
    updatedAt: 0,
  }));
}
