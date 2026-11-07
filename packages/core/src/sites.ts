import type { FeedSite, WebsiteRule } from "@shared/index";
import { expandDomainAliases } from "./domains";
export const launchSites: {
  id: FeedSite;
  name: string;
  domain: string;
  color: string;
  symbol: string;
}[] = [
  {
    id: "youtube",
    name: "YouTube",
    domain: "youtube.com",
    color: "#e34436",
    symbol: "▶",
  },
  {
    id: "instagram",
    name: "Instagram",
    domain: "instagram.com",
    color: "#b84783",
    symbol: "◎",
  },
  { id: "x", name: "X", domain: "x.com", color: "#333b46", symbol: "𝕏" },
  {
    id: "reddit",
    name: "Reddit",
    domain: "reddit.com",
    color: "#db5827",
    symbol: "r",
  },
  {
    id: "substack",
    name: "Substack",
    domain: "substack.com",
    color: "#e57c34",
    symbol: "≡",
  },
];
export function defaultRules(): WebsiteRule[] {
  return launchSites.map((site) => ({
    id: site.id,
    label: site.name,
    domains: expandDomainAliases([site.domain]),
    enabled: true,
    blocked: false,
    showTimer: false,
    createdAt: 0,
    updatedAt: 0,
  }));
}
