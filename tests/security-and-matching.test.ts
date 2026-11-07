import { describe, expect, it } from 'vitest';
import { hostMatchesDomain, normalizeDomain, urlMatchesDomains } from '@core/domains';
import { createPinVerifier, pinCooldownMilliseconds, recordFailedPin, verifyPin } from '@core/pin';
import { buildBlockingCss } from '@feeds/index';
import { feedDefaults } from '@core/defaults';

describe('PIN verifier', () => {
  it('uses a salted slow verifier and validates without plaintext', async () => {
    const record = await createPinVerifier('123456');
    expect(record.iterations).toBeGreaterThanOrEqual(300_000);
    expect(JSON.stringify(record)).not.toContain('123456');
    expect(await verifyPin('123456', record)).toBe(true);
    expect(await verifyPin('654321', record)).toBe(false);
  });

  it('escalates cooldowns after repeated failures', () => {
    expect(pinCooldownMilliseconds(2)).toBe(0);
    expect(pinCooldownMilliseconds(3)).toBe(30_000);
    expect(pinCooldownMilliseconds(6)).toBeGreaterThan(pinCooldownMilliseconds(5));
    expect(recordFailedPin({ failedAttempts: 2 }, 1000).cooldownUntil).toBe(31_000);
  });
});

describe('URL and feed matching', () => {
  it('normalizes domains and avoids lookalike hosts', () => {
    expect(normalizeDomain('https://www.YouTube.com/watch?v=x')).toBe('youtube.com');
    expect(hostMatchesDomain('m.youtube.com', 'youtube.com')).toBe(true);
    expect(hostMatchesDomain('notyoutube.com', 'youtube.com')).toBe(false);
    expect(urlMatchesDomains('chrome://extensions', ['youtube.com'])).toBe(false);
  });

  it('builds only enabled site selectors', () => {
    const css = buildBlockingCss(feedDefaults, 'www.youtube.com');
    expect(css).toContain('ytd-rich-grid-renderer');
    expect(css).not.toContain('ytd-comments#comments');
    expect(buildBlockingCss(feedDefaults, 'example.com')).toBe('');
  });
});
