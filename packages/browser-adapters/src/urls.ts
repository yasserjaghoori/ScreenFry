import type { BrowserKind } from "@shared/index";

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
