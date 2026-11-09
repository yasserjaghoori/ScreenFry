/** Reads URL, selector attributes and media playback state only. No page text or form data. */
import { migrateState } from "@core/defaults";
import {
  activeShortForm,
  buildBlockingCss,
  enabledElements,
  shortFormBlock,
  siteFor,
} from "@feeds/index";
import type { TabMessage } from "@browser/messages";
import { STATE_KEY } from "@browser/storage";
import { hostMatchesDomain } from "@core/domains";
import { tiktokVideoId } from "@feeds/tiktok";
import { createBlockedScreen } from "./blocked-screen";
import { createBatchedTask } from "@browser/scheduling";
import {
  effectiveFeedSettings,
  evaluatePolicy,
  matchingRules,
} from "@policy/index";
import type { AppState, FeedSettings, PolicyDecision } from "@shared/index";
const isTop = window === window.top;
let state: AppState | undefined;
let pageBlocked = false;
let linkedVideoUrl = tiktokVideoId(location.href) ? location.href : undefined;
const blockedScreen = createBlockedScreen();
let scrollGuardsInstalled = false;
const STYLE = "screenfry-feed-blocker";
/** The free-time window that was pausing feed blocking at the last evaluation. */
let freeTimeLabel: string | undefined;
let lastReportedPlaying: boolean | undefined,
  lastReportAt = 0;
/** Saved feed settings, minus this website's while its free time is running. */
function feeds(): FeedSettings | undefined {
  return state && effectiveFeedSettings(state, location.href, Date.now());
}
function singleVideoEnabled() {
  const settings = feeds();
  return (
    settings?.globalEnabled &&
    settings.sites.tiktok.singleVideo &&
    siteFor(location.hostname)?.site === "tiktok"
  );
}
function beyondLinkedVideo() {
  return (
    singleVideoEnabled() &&
    linkedVideoUrl &&
    tiktokVideoId(location.href) !== tiktokVideoId(linkedVideoUrl)
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
  const settings = feeds();
  if (!settings) return;
  const short = activeShortForm(settings, location.hostname);
  if (!short) return;
  // SPA navigation can update the canonical link before the address bar.
  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  )?.href;
  if (canonical && shortFormBlock(settings, canonical))
    return short.label;
  if (document.querySelector(short.playerSelectors.join(",")))
    return short.label;
}
function blockedMedia(media: HTMLMediaElement): boolean {
  if (!state) return false;
  if (
    pageBlocked ||
    beyondLinkedVideo() ||
    evaluatePolicy(state, location.href, Date.now()).status === "blocked"
  )
    return true;
  const settings = feeds()!;
  if (shortFormBlock(settings, location.href) || documentShortForm())
    return true;
  return enabledElements(settings, location.href).some(
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
function reportMedia() {
  const playing = [
    ...document.querySelectorAll<HTMLMediaElement>("video,audio"),
  ].some((m) => !m.paused && !m.ended && m.readyState >= 2 && !blockedMedia(m));
  if (playing === lastReportedPlaying && Date.now() - lastReportAt < 10_000)
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
  if (document.documentElement.dataset.screenfryXTab !== value)
    document.documentElement.dataset.screenfryXTab = value;
}
function evaluate() {
  if (!state || !/^https?:/.test(location.href) || !document.documentElement)
    return;
  if (!singleVideoEnabled()) linkedVideoUrl = undefined;
  else if (!linkedVideoUrl && tiktokVideoId(location.href))
    linkedVideoUrl = location.href;
  syncScrollGuards();
  const decision = evaluatePolicy(state, location.href, Date.now());
  const short = documentShortForm();
  const single = beyondLinkedVideo();
  if (decision.status === "blocked" || short || single) {
    pageBlocked = true;
    freeTimeLabel = undefined;
    // Never wait for a background navigation or stop the document while Safari is loading.
    for (const media of document.querySelectorAll<HTMLMediaElement>(
      "video,audio",
    ))
      if (!media.paused) media.pause();
    const label = short ?? decision.ruleLabel ?? "This website";
    if (!isTop) {
      applyCss(
        "html{visibility:hidden!important}video,audio{display:none!important}",
      );
      reportMedia();
      return;
    }
    applyCss(
      "body{visibility:hidden!important}video,audio{display:none!important}",
    );
    blockedScreen.show(
      short
        ? { ...decision, status: "blocked", reasons: ["short-form"] }
        : decision,
      label,
      single ? linkedVideoUrl : undefined,
    );
    overlay.update({ status: "allowed", reasons: [] });
    reportMedia();
    return;
  }
  pageBlocked = false;
  blockedScreen.hide();
  markXTab();
  applyCss(buildBlockingCss(feeds()!, location.href));
  pauseRestrictedMedia();
  reportMedia();
  if (isTop) {
    overlay.update(decision);
    if (freeTimeLabel && !decision.freeTime)
      overlay.toast(
        decision.freeTimeOff?.state === "used-up"
          ? `Today’s Fry Time is used up. Feeds are hidden again.`
          : `${freeTimeLabel} is over. Feeds are hidden again.`,
      );
    freeTimeLabel = decision.freeTime?.label;
  }
}
const queueEvaluation = createBatchedTask(evaluate);
const overlay = (() => {
  let host: HTMLElement | undefined, pill: HTMLElement, toast: HTMLElement;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function ensure() {
    if (!document.body) return;
    if (!host) {
      host = document.createElement("screenfry-overlay");
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>:host{all:initial}.wrap{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:grid;gap:8px;justify-items:end;font:500 13px/1.3 system-ui}.chip{display:none;padding:10px 14px;border-radius:99px;background:#263a32;color:white;box-shadow:0 5px 20px #0003;font-variant-numeric:tabular-nums}.show{display:block}</style><div class="wrap"><div class="chip toast"></div><div class="chip pill"></div></div>`;
      pill = root.querySelector(".pill")!;
      toast = root.querySelector(".toast")!;
    }
    if (!host.isConnected) document.documentElement.append(host);
  }
  return {
    update(decision: PolicyDecision) {
      // Free time with a budget always shows its countdown; daily limits only when asked.
      const free = decision.freeTime?.remainingMilliseconds;
      const remaining =
        free ??
        (state &&
        matchingRules(state, location.href).some((r) => r.showTimer)
          ? decision.remainingMilliseconds
          : undefined);
      const show = remaining !== undefined;
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
        Math.ceil((remaining! - elapsed) / 1000),
      );
      const text = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} ${free !== undefined ? "Fry Time left" : "left today"}`;
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
/** True when ScreenFry has anything to do on this page: a launch site, or a rule/window domain. */
function relevantHost(s: AppState | undefined): boolean {
  const host = location.hostname;
  if (siteFor(host)) return true;
  if (!s) return false;
  const covers = (domains: string[]) =>
    domains.some((d) => hostMatchesDomain(host, d));
  return (
    s.rules.some((r) => r.enabled && covers(r.domains)) ||
    s.windows.some((w) => w.enabled && covers(w.domains))
  );
}
/**
 * The script is injected into every page and frame, so unrelated pages must stay idle: after
 * one state read they register no timer, observer or listener. Blocking on those pages is
 * still enforced by the background's network rules and tab redirects.
 */
let started = false;
function start() {
  if (started) return;
  started = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STATE_KEY]) {
      state = migrateState(changes[STATE_KEY].newValue);
      queueEvaluation();
    }
  });
  startPageWatchers();
}
async function load() {
  try {
    state = migrateState(
      (await chrome.storage.local.get(STATE_KEY))[STATE_KEY],
    );
    if (!relevantHost(state)) return false;
    start();
    evaluate();
    return true;
  } catch {
    /* unavailable context */
    return false;
  }
}
// Launch sites start watching at document_start, before state arrives, so Shorts/Reels
// entry points can't slip through; everything else waits for the state check.
if (siteFor(location.hostname)) start();
void load();
function guardScroll(event: Event) {
  // Block player scrolling, not scrolling through comments or typing in a field.
  if (
    !singleVideoEnabled() ||
    !linkedVideoUrl ||
    !(event.target instanceof Element)
  )
    return;
  if (
    event.target.closest(
      'input,textarea,[contenteditable="true"],[data-e2e*="comment"]',
    )
  )
    return;
  const keyboard = event instanceof KeyboardEvent;
  if (
    keyboard &&
    !["ArrowDown", "ArrowUp", "PageDown", "PageUp"].includes(event.key)
  )
    return;
  if (
    keyboard ||
    event.target.closest(
      'video,[data-e2e="browse-video"],[data-e2e="feed-video"]',
    )
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
function syncScrollGuards() {
  const enabled = Boolean(singleVideoEnabled() && linkedVideoUrl);
  if (enabled === scrollGuardsInstalled) return;
  scrollGuardsInstalled = enabled;
  for (const event of ["wheel", "touchmove", "keydown"]) {
    // These need preventDefault, but only while TikTok's linked-video mode is on.
    if (enabled)
      window.addEventListener(event, guardScroll, {
        capture: true,
        passive: false,
      });
    else window.removeEventListener(event, guardScroll, true);
  }
}
function startPageWatchers() {
  // CSS already applies to new elements. Only supported social sites need DOM checks
  // for player/modal and selected-tab changes; unrelated pages keep timer/media tracking.
  // A website may repeatedly remove our style, so never respond in a microtask loop.
  if (siteFor(location.hostname)) {
    const observer = new MutationObserver((records) => {
      if (
        records.some(
          (record) =>
            !(record.target instanceof Element && record.target.id === STYLE),
        )
      )
        queueEvaluation();
    });
    const observe = () => {
      if (document.documentElement)
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: [
            "href",
            "src",
            "aria-selected",
            "is-active",
            "hidden",
          ],
        });
    };
    if (document.documentElement) observe();
    else document.addEventListener("DOMContentLoaded", observe, { once: true });
  }
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
        if (
          e.target instanceof HTMLMediaElement &&
          !e.target.paused &&
          blockedMedia(e.target)
        )
          e.target.pause();
        queueEvaluation();
        reportMedia();
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
  // Top frames refresh every second for the on-page timer; embedded frames only need
  // occasional checks because media events and the background cover the rest.
  setInterval(evaluate, isTop ? 1000 : 5000);
  document.addEventListener("DOMContentLoaded", evaluate, { once: true });
  window.addEventListener("pagehide", () => {
    if (!lastReportedPlaying) return;
    try {
      void chrome.runtime
        .sendMessage({ type: "MEDIA_STATE", playing: false })
        .catch(() => undefined);
    } catch {
      /* unloaded */
    }
  });
}
if (isTop)
  chrome.runtime.onMessage.addListener(
    (message: TabMessage, _sender, respond) => {
      if (message?.type === "SCREENFRY_APPLY_SETTINGS") {
        void load().then((applied) => respond({ applied, url: location.href }));
        return true;
      }
      if (message?.type === "SCREENFRY_WARNING")
        overlay.toast(
          `${message.minutesRemaining} minute${message.minutesRemaining === 1 ? "" : "s"} left on ${message.label} today`,
        );
    },
  );
