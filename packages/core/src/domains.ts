const stripPrefix = (host: string) => host.trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  try {
    const value = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    return stripPrefix(new URL(value).hostname);
  } catch {
    return stripPrefix(trimmed.split(/[/?#]/)[0]);
  }
}

export function isValidDomain(domain: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(domain);
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  const normalizedHost = stripPrefix(host);
  const normalizedDomain = stripPrefix(domain);
  if (!normalizedDomain) return false;
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

export function parseWebUrl(url: string): URL | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function urlMatchesDomains(url: string, domains: string[]): boolean {
  const parsed = parseWebUrl(url);
  return Boolean(parsed && domains.some((domain) => hostMatchesDomain(parsed.hostname, domain)));
}

export function displayHost(url: string): string | undefined {
  const parsed = parseWebUrl(url);
  return parsed ? stripPrefix(parsed.hostname) : undefined;
}

export const YOUTUBE_DOMAINS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'youtube.googleapis.com'];

/**
 * Domains that are the same product. Restricting any member restricts the whole group.
 * Only product-owned hosts are listed: general shorteners (t.co, lnkd.in) and shared
 * infrastructure (google.com, googlevideo.com, fbcdn.net) are deliberately excluded so
 * unrelated services keep working. Redirects through shorteners still land on a blocked host.
 */
export const DOMAIN_ALIAS_GROUPS: string[][] = [
  YOUTUBE_DOMAINS,
  ['x.com', 'twitter.com'],
  ['reddit.com', 'redd.it'],
  ['instagram.com', 'instagr.am'],
  // Messenger stays separate from Facebook, so blocking Facebook leaves messages usable.
  ['facebook.com', 'fb.com', 'fb.watch'],
  ['linkedin.com', 'lnkd.in'],
  ['tiktok.com'],
  ['twitch.tv']
];

export function expandDomainAliases(domains: string[]): string[] {
  const result = new Set<string>();
  for (const raw of domains) {
    const domain = normalizeDomain(raw);
    if (!domain) continue;
    const group = DOMAIN_ALIAS_GROUPS.find((members) => members.some((member) => hostMatchesDomain(domain, member)));
    // A subdomain such as music.youtube.com stays as typed; a canonical domain pulls in its aliases.
    if (group && group.includes(domain)) group.forEach((member) => result.add(member));
    else result.add(domain);
  }
  return [...result];
}

/** True when every host matched by `domain` is also matched by one of `covering`. */
export function domainCoveredBy(domain: string, covering: string[]): boolean {
  return covering.some((candidate) => hostMatchesDomain(domain, candidate));
}
