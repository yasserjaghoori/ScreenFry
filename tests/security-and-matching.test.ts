import { describe, expect, it } from 'vitest';
import { expandDomainAliases, hostMatchesDomain, isValidDomain, normalizeDomain, urlMatchesDomains } from '@core/domains';
import { createPinVerifier, pinCooldownMilliseconds, recordFailedPin, verifyPin } from '@core/pin';
import { activeSelectors, buildBlockingCss, feedRedirect } from '@feeds/index';
import { feedDefaults } from '@core/defaults';
import type { FeedSettings } from '@shared/index';

describe('PIN verifier', () => {
  it('uses a salted slow verifier and never stores the PIN', async () => {
    const record = await createPinVerifier('123456');
    const again = await createPinVerifier('123456');
    expect(record.algorithm).toBe('PBKDF2-SHA-256');
    expect(record.iterations).toBeGreaterThanOrEqual(300_000);
    expect(record.salt).not.toBe(again.salt);
    expect(record.verifier).not.toBe(again.verifier);
    expect(JSON.stringify(record)).not.toContain('123456');
    expect(await verifyPin('123456', record)).toBe(true);
    expect(await verifyPin('654321', record)).toBe(false);
    expect(await verifyPin('12345', record)).toBe(false);
  });

  it('escalates cooldowns after repeated failures, capped at one hour', () => {
    expect(pinCooldownMilliseconds(2)).toBe(0);
    expect(pinCooldownMilliseconds(3)).toBe(30_000);
    expect(pinCooldownMilliseconds(6)).toBeGreaterThan(pinCooldownMilliseconds(5));
    expect(pinCooldownMilliseconds(50)).toBe(60 * 60_000);
    expect(recordFailedPin({ failedAttempts: 2 }, 1000).cooldownUntil).toBe(31_000);
  });
});

describe('URL matching', () => {
  it('normalizes domains and avoids lookalike hosts', () => {
    expect(normalizeDomain('https://www.YouTube.com/watch?v=x')).toBe('youtube.com');
    expect(normalizeDomain(' reddit.com/r/all ')).toBe('reddit.com');
    expect(hostMatchesDomain('m.youtube.com', 'youtube.com')).toBe(true);
    expect(hostMatchesDomain('notyoutube.com', 'youtube.com')).toBe(false);
    expect(urlMatchesDomains('chrome://extensions', ['youtube.com'])).toBe(false);
    expect(urlMatchesDomains('https://user@youtube.com:8443/x', ['youtube.com'])).toBe(true);
    expect(isValidDomain('youtube.com')).toBe(true);
    expect(isValidDomain('youtube')).toBe(false);
  });

  it('expands product aliases without touching shared Google infrastructure', () => {
    const youtube = expandDomainAliases(['youtube.com']);
    expect(youtube).toEqual(expect.arrayContaining(['youtube.com', 'youtu.be', 'youtube-nocookie.com']));
    expect(youtube.some((domain) => /(^|\.)google\.com$|googlevideo/.test(domain))).toBe(false);
    expect(urlMatchesDomains('https://www.google.com/search?q=youtube', youtube)).toBe(false);
    expect(urlMatchesDomains('https://mail.google.com', youtube)).toBe(false);
    expect(expandDomainAliases(['twitter.com'])).toEqual(['x.com', 'twitter.com']);
    expect(expandDomainAliases(['music.youtube.com'])).toEqual(['music.youtube.com']);
  });
});

describe('feed blockers', () => {
  const settings = (): FeedSettings => structuredClone(feedDefaults);

  it('hides only enabled elements', () => {
    const css = buildBlockingCss(settings(), 'https://www.youtube.com/');
    expect(css).toContain('ytd-rich-grid-renderer');
    expect(css).not.toContain('ytd-comments#comments');
    expect(buildBlockingCss(settings(), 'https://example.com/')).toBe('');
  });

  it('respects the global toggle', () => {
    expect(buildBlockingCss({ ...settings(), globalEnabled: false }, 'https://www.youtube.com/')).toBe('');
  });

  it('does not hide channel pages, subreddits, profiles or search', () => {
    expect(activeSelectors(settings(), 'https://www.youtube.com/@channel/videos').join()).not.toContain('rich-grid');
    expect(activeSelectors(settings(), 'https://www.youtube.com/results?search_query=x').join()).not.toContain('rich-grid');
    expect(activeSelectors(settings(), 'https://www.reddit.com/r/typescript/').join()).not.toContain('shreddit-feed');
    expect(activeSelectors(settings(), 'https://www.reddit.com/').join()).toContain('shreddit-feed');
    expect(activeSelectors(settings(), 'https://www.reddit.com/r/popular/').join()).toContain('shreddit-feed');
    expect(activeSelectors(settings(), 'https://www.instagram.com/someone/').join()).not.toContain('main[role="main"]');
    expect(activeSelectors(settings(), 'https://www.instagram.com/').join()).toContain('main[role="main"]');
    expect(activeSelectors(settings(), 'https://www.linkedin.com/in/someone/').join()).not.toContain('scaffold-finite-scroll');
    expect(activeSelectors(settings(), 'https://www.facebook.com/groups/123').join()).not.toContain('[role="main"] [role="feed"]');
  });

  it('distinguishes X For You and Following toggles', () => {
    const css = activeSelectors(settings(), 'https://x.com/home').join();
    expect(css).toContain('data-screentime-x-tab="0"');
    expect(css).not.toContain('data-screentime-x-tab="1"');
  });

  it('opens Shorts direct links in the normal player instead of the Shorts feed', () => {
    expect(feedRedirect(settings(), 'https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    const off = settings(); off.sites.youtube.shorts = false;
    expect(feedRedirect(off, 'https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBeUndefined();
    expect(feedRedirect(settings(), 'https://www.youtube.com/watch?v=abc')).toBeUndefined();
  });
});
