import type { BrowserKind, PrivateAccessStatus } from '@shared/index';

/** Safari serves extension pages from safari-web-extension://; Chrome from chrome-extension://. */
export function detectBrowser(): BrowserKind {
  try {
    return chrome.runtime.getURL('').startsWith('safari-web-extension:') ? 'safari' : 'chrome';
  } catch {
    return 'chrome';
  }
}

/**
 * Chrome exposes a supported permission query. Safari has no equivalent, so it always reports
 * `unverified` here; coverage can only be observed by seeing a private tab (see background).
 */
export async function queryPrivateAccess(): Promise<PrivateAccessStatus> {
  if (detectBrowser() !== 'chrome') return 'unverified';
  try {
    return (await chrome.extension.isAllowedIncognitoAccess()) ? 'verified' : 'unverified';
  } catch {
    return 'unverified';
  }
}

export const hasIdleApi = (): boolean => typeof chrome.idle?.queryState === 'function';

/** Session storage survives service-worker suspension but is cleared when the browser quits. */
export const sessionArea = (): chrome.storage.StorageArea | undefined => chrome.storage.session;

export const privateBrowsingName = (browser: BrowserKind) => (browser === 'safari' ? 'Private Browsing' : 'Incognito');
