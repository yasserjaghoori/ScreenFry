/** Reads URL, selector attributes and media playback state only. No page text or form data. */
import { migrateState } from "@core/defaults";
import {
  buildBlockingCss,
  enabledElements,
  shortFormBlock,
  siteFor,
} from "@feeds/index";
import type { TabMessage } from "@browser/messages";
import { STATE_KEY } from "@browser/storage";
import { evaluatePolicy, matchingRules } from "@policy/index";
import type { AppState, PolicyDecision } from "@shared/index";
const isTop = window === window.top;
let state: AppState | undefined,
  redirecting = false,
  evaluationQueued = false;
const STYLE = "screentime-feed-blocker";
let lastReportedPlaying: boolean | undefined,
  lastReportAt = 0;
function blockedUrl(label: string) {
  return chrome.runtime.getURL(
    `blocked.html?${new URLSearchParams({ label, url: location.href })}`,
  );
}
function applyCss(css: string) {
  let sheet = document.getElementById(STYLE) as HTMLStyleElement | null;
  if (!css) {
    sheet?.remove();
    return;
  }
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = STYLE;
  }
  if (sheet.textContent !== css) sheet.textContent = css;
  const parent = document.head ?? document.documentElement;
  if (sheet.parentNode !== parent) parent.append(sheet);
}
function documentShortForm(): string | undefined {
  if (!state?.feedSettings.globalEnabled) return;
  const site = siteFor(location.hostname)?.site;
  if (site === "youtube" && state.feedSettings.sites.youtube.shorts) {
    const canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    )?.href;
    if (canonical && shortFormBlock(state.feedSettings, canonical))
      return "YouTube Shorts";
    if (
      document.querySelector(
        'ytd-reel-video-renderer[is-active] video, ytd-shorts:not([hidden]) ytd-reel-video-renderer[is-active], [data-testid="shorts-player"] video',
      )
    )
      return "YouTube Shorts";
  }
  if (
    site === "instagram" &&
    state.feedSettings.sites.instagram.reels &&
    document.querySelector('[data-testid="reels-viewer"] video')
  )
    return "Instagram Reels";
}
function blockedMedia(media: HTMLMediaElement): boolean {
  if (!state) return false;
  if (shortFormBlock(state.feedSettings, location.href) || documentShortForm())
    return true;
  return enabledElements(state.feedSettings, location.href).some(
    (element) =>
      element.pauseMedia &&
      element.selectors.some((selector) => {
        try {
          return Boolean(media.matches(selector) || media.closest(selector));
        } catch {
          return false;
        }
      }),
  );
}
function pauseRestrictedMedia() {
  for (const media of document.querySelectorAll<HTMLMediaElement>(
    "video,audio",
  ))
    if (blockedMedia(media) && !media.paused) media.pause();
}
function reportMedia(force = false) {
  const playing = [
    ...document.querySelectorAll<HTMLMediaElement>("video,audio"),
  ].some((m) => !m.paused && !m.ended && m.readyState >= 2 && !blockedMedia(m));
  if (
    !force &&
    playing === lastReportedPlaying &&
    Date.now() - lastReportAt < 10_000
  )
    return;
  lastReportedPlaying = playing;
  lastReportAt = Date.now();
  try {
    void chrome.runtime
      .sendMessage({ type: "MEDIA_STATE", playing })
      .catch(() => undefined);
  } catch {
    /* extension reloaded */
  }
}
function markXTab() {
  if (siteFor(location.hostname)?.site !== "x") return;
  const tabs = [
    ...document.querySelectorAll(
      '[data-testid="primaryColumn"] [role="tablist"] [role="tab"]',
    ),
  ];
  const index = tabs.findIndex(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  const value = index < 0 ? "" : String(index);
  if (document.documentElement.dataset.screentimeXTab !== value)
    document.documentElement.dataset.screentimeXTab = value;
}
function evaluate() {
  evaluationQueued = false;
  if (!state || redirecting || !/^https?:/.test(location.href)) return;
  const decision = evaluatePolicy(state, location.href, Date.now());
  const short = documentShortForm();
  if (decision.status === "blocked" || short) {
    // Pause first, including embedded media, then replace the page. Never open another player.
    for (const media of document.querySelectorAll<HTMLMediaElement>(
      "video,audio",
    ))
      media.pause();
    applyCss("video,audio{display:none!important}");
    redirecting = true;
    location.replace(blockedUrl(short ?? decision.ruleLabel ?? "This website"));
    return;
  }
  markXTab();
  applyCss(buildBlockingCss(state.feedSettings, location.href));
  pauseRestrictedMedia();
  reportMedia();
  if (isTop) overlay.update(decision);
}
function queueEvaluation() {
  if (evaluationQueued) return;
  evaluationQueued = true;
  queueMicrotask(evaluate);
}
const overlay = (() => {
  let host: HTMLElement | undefined, pill: HTMLElement, toast: HTMLElement;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function ensure() {
    if (!document.body) return;
    if (!host) {
      host = document.createElement("screentime-overlay");
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>:host{all:initial}.wrap{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:grid;gap:8px;justify-items:end;font:500 13px/1.3 system-ui}.chip{display:none;padding:10px 14px;border-radius:99px;background:#263a32;color:white;box-shadow:0 5px 20px #0003;font-variant-numeric:tabular-nums}.show{display:block}</style><div class="wrap"><div class="chip toast"></div><div class="chip pill"></div></div>`;
      pill = root.querySelector(".pill")!;
      toast = root.querySelector(".toast")!;
    }
    if (!host.isConnected) document.documentElement.append(host);
  }
  return {
    update(decision: PolicyDecision) {
      const show =
        state &&
        matchingRules(state, location.href).some((r) => r.showTimer) &&
        decision.remainingMilliseconds !== undefined;
      if (!show) {
        pill?.classList.remove("show");
        return;
      }
      ensure();
      if (!pill) return;
      const counting =
        (document.visibilityState === "visible" && document.hasFocus()) ||
        [...document.querySelectorAll<HTMLMediaElement>("video,audio")].some(
          (m) => !m.paused && !m.ended && m.readyState >= 2,
        );
      const elapsed =
        counting && state?.usageAsOf
          ? Math.max(0, Math.min(90_000, Date.now() - state.usageAsOf))
          : 0;
      const seconds = Math.max(
        0,
        Math.ceil((decision.remainingMilliseconds! - elapsed) / 1000),
      );
      const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left today`;
      if (pill.textContent !== text) pill.textContent = text;
      pill.classList.add("show");
    },
    toast(text: string) {
      ensure();
      if (!toast) return;
      toast.textContent = text;
      toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 8_000);
    },
  };
})();
async function load() {
  try {
    state = migrateState(
      (await chrome.storage.local.get(STATE_KEY))[STATE_KEY],
    );
    evaluate();
  } catch {
    /* unavailable context */
  }
}
void load();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STATE_KEY]) {
    state = migrateState(changes[STATE_KEY].newValue);
    evaluate();
  }
});
// Mutation observation catches SPA/notification modal entry points before the next heartbeat.
new MutationObserver(queueEvaluation).observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ["href", "src", "aria-selected", "is-active", "hidden"],
});
for (const event of [
  "play",
  "playing",
  "pause",
  "ended",
  "emptied",
  "loadeddata",
])
  document.addEventListener(
    event,
    (e) => {
      if (e.target instanceof HTMLMediaElement && blockedMedia(e.target))
        e.target.pause();
      queueEvaluation();
      reportMedia(true);
    },
    true,
  );
for (const event of [
  "popstate",
  "hashchange",
  "yt-navigate-start",
  "yt-navigate-finish",
])
  window.addEventListener(event, queueEvaluation, true);
setInterval(evaluate, 1000);
document.addEventListener("DOMContentLoaded", evaluate, { once: true });
window.addEventListener("pagehide", () => {
  try {
    void chrome.runtime
      .sendMessage({ type: "MEDIA_STATE", playing: false })
      .catch(() => undefined);
  } catch {
    /* unloaded */
  }
});
if (isTop)
  chrome.runtime.onMessage.addListener((message: TabMessage) => {
    if (message?.type === "SCREENTIME_WARNING")
      overlay.toast(
        `${message.minutesRemaining} minute${message.minutesRemaining === 1 ? "" : "s"} left on ${message.label} today`,
      );
  });
