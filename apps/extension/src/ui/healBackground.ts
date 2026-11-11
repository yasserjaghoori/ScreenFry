import { send } from "@browser/messages";
import { detectBrowser } from "@browser/platform";

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
 * ScreenFry (at most every ten minutes), reopening this page afterwards.
 */
export async function healStaleBackground(reopen?: string): Promise<void> {
  if (!PAGE_VERSION || detectBrowser() !== "chrome") return;
  const r = await send<{ codeVersion?: string }>({ type: "GET_BUILD" }).catch(() => undefined);
  // Backgrounds from before 0.7.7 don't know GET_BUILD; theirs are older by definition.
  if (r?.ok && r.data.codeVersion === PAGE_VERSION) return;
  if (r?.ok && !r.data.codeVersion) return; // a development build without a stamp
  const saved = await chrome.storage.local.get(LAST_KEY).catch(() => ({}) as Record<string, unknown>);
  const last = saved[LAST_KEY] as number | undefined;
  if (last && Date.now() - last < 10 * 60_000) return;
  await chrome.storage.local.set({ [LAST_KEY]: Date.now(), ...(reopen ? { [REOPEN_KEY]: reopen } : {}) });
  chrome.runtime.reload();
}
