import { send } from "@browser/messages";
import { isUnpackedChrome } from "@browser/platform";

/** Set by Vite: the version this page was built as. */
declare const __CODE_VERSION__: string;
const PAGE_VERSION = typeof __CODE_VERSION__ === "string" ? __CODE_VERSION__ : "";
const LAST_KEY = "screenfry.staleReloadAt";
/** A page to open again once the fresh background is up. */
export const REOPEN_KEY = "screenfry.reopenAfterReload";

/**
 * Chrome can keep running an older ScreenFry background after the Mac app updates the files
 * (it re-reads the manifest when it starts, but not the background). ScreenFry's pages always
 * load fresh, so they ask the background which version it is and, when it's older, reload
 * ScreenFry (at most every ten minutes), reopening this page afterwards. Only for the unpacked
 * copy: Chrome Web Store installs are updated, background included, by Chrome itself.
 */
export async function healStaleBackground(reopen?: string): Promise<void> {
  if (!PAGE_VERSION || !(await isUnpackedChrome())) return;
  const r = await send<{ codeVersion?: string }>({ type: "GET_BUILD" }).catch(() => undefined);
  // Only a background that answers can be judged: an older version, or one from before 0.7.7
  // that doesn't know GET_BUILD. No answer (still starting up) is never a reason to reload.
  const stale = r?.ok
    ? Boolean(r.data.codeVersion) && r.data.codeVersion !== PAGE_VERSION
    : r?.error === "Unsupported request.";
  if (!stale) return;
  const saved = await chrome.storage.local.get(LAST_KEY).catch(() => ({}) as Record<string, unknown>);
  const last = saved[LAST_KEY] as number | undefined;
  if (last && Date.now() - last < 10 * 60_000) return;
  await chrome.storage.local.set({ [LAST_KEY]: Date.now(), ...(reopen ? { [REOPEN_KEY]: reopen } : {}) });
  chrome.runtime.reload();
}
