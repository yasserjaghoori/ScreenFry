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

/** Safari blocks the request first; tab/content enforcement supplies its notice URL. */
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
