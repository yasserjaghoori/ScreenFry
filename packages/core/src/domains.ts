const stripPrefix = (host: string) => host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

export function normalizeDomain(input: string): string {
  try {
    const value = input.includes('://') ? input : `https://${input}`;
    return stripPrefix(new URL(value).hostname);
  } catch {
    return stripPrefix(input.split('/')[0]);
  }
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  const normalizedHost = stripPrefix(host);
  const normalizedDomain = stripPrefix(domain);
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

export function urlMatchesDomains(url: string, domains: string[]): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return domains.some((domain) => hostMatchesDomain(parsed.hostname, domain));
  } catch {
    return false;
  }
}

export const YOUTUBE_DOMAINS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];
