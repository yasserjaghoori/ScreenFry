import type { BrowserKind } from "@shared/index";

/**
 * The Mac app opens ScreenFry's settings by sending the browser to this address, which never
 * loads (`.invalid` is reserved); ScreenFry swaps the tab for its own page. The path names
 * the dashboard section, e.g. `/settings`.
 */
export const OPEN_SCREENFRY_ADDRESS = "https://open.screenfry.invalid/";
export function openScreenFryPage(url: string | undefined): string | undefined {
  if (!url?.startsWith(OPEN_SCREENFRY_ADDRESS)) return;
  const page = url.slice(OPEN_SCREENFRY_ADDRESS.length).split(/[/?#]/)[0];
  return ["websites", "windows", "earn", "share", "experimental", "settings"].includes(page) ? page : "websites";
}

/** Keep the packaged resource path separate from query and fragment components. */
export function extensionPageUrl(
  page: string,
  query: Record<string, string> = {},
  fragment = "",
): string {
  const url = new URL(chrome.runtime.getURL(page));
  url.search = new URLSearchParams(query).toString();
  url.hash = fragment;
  return url.href;
}

/**
 * Resource types the network rules apply to. Safari cannot redirect a page to an extension
 * URL from a network rule, and a "block" on a whole page shows Safari's own error page, so
 * on Safari the rules only cover embedded frames. Whole pages are sent to ScreenFry's
 * blocked page by the background (tab updates) and the content script instead.
 */
export function networkResourceTypes(
  browser: BrowserKind,
): chrome.declarativeNetRequest.ResourceType[] {
  return (
    browser === "safari" ? ["sub_frame"] : ["main_frame", "sub_frame"]
  ) as chrome.declarativeNetRequest.ResourceType[];
}

/** Safari blocks embedded frames outright; Chrome redirects to the blocked page. */
export function networkBlockAction(
  browser: BrowserKind,
  label: string,
): chrome.declarativeNetRequest.RuleAction {
  if (browser === "safari")
    return { type: "block" as chrome.declarativeNetRequest.RuleActionType };
  return {
    type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
    redirect: {
      regexSubstitution: `${chrome.runtime.getURL("blocked.html")}?${new URLSearchParams({ label, source: "network" })}&url=\\1`,
    },
  };
}
