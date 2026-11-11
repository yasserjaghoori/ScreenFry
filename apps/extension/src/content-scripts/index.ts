/** Reads URL, selector attributes and media playback state only. No page text or form data. */
import { migrateState } from "@core/defaults";
import {
  activeShortForm,
  buildBlockingCss,
  enabledElements,
  researchMode,
  shortFormBlock,
  siteFor,
} from "@feeds/index";
import type { TabMessage } from "@browser/messages";
import { STATE_KEY } from "@browser/storage";
import { hostMatchesDomain } from "@core/domains";
import { createBlockedScreen } from "./blocked-screen";
import { createBatchedTask } from "@browser/scheduling";
import {
  earnGoalUsed,
  earnGoalsFor,
  earnRemaining,
  effectiveFeedSettings,
  evaluatePolicy,
  matchingRules,
} from "@policy/index";
import type { AppState, FeedSettings, PolicyDecision } from "@shared/index";
const isTop = window === window.top;
let state: AppState | undefined;
let pageBlocked = false;
/** Research mode: the first short-form video this page reached, and the pages before it. */
let linked: { url: string; id: string } | undefined;
const visitedBefore = new Set<string>();
const blockedScreen = createBlockedScreen();
const STYLE = "screenfry-feed-blocker";
/** The free-time window that was pausing feed blocking at the last evaluation. */
let freeTimeLabel: string | undefined;
let lastReportedPlaying: boolean | undefined,
  lastReportAt = 0;
/** Saved feed settings, minus this website's while its free time is running. */
let feedsCache: { state: AppState; href: string; second: number; feeds: FeedSettings } | undefined;
function feeds(): FeedSettings | undefined {
  if (!state) return undefined;
  // Called for every video on media events; reuse within the same second (see currentDecision).
  const second = Math.floor(Date.now() / 1000);
  if (!feedsCache || feedsCache.state !== state || feedsCache.href !== location.href || feedsCache.second !== second)
    feedsCache = { state, href: location.href, second, feeds: effectiveFeedSettings(state, location.href, Date.now()) };
  return feedsCache.feeds;
}
function research() {
  const settings = feeds();
  return settings && researchMode(settings, location.hostname);
}
const pageKey = (href: string) => {
  const url = new URL(href);
  return url.origin + url.pathname.replace(/\/+$/, "");
};
/** Notes the linked video (or a page before it) for research mode. */
function trackResearch() {
  const mode = research();
  if (!mode) {
    linked = undefined;
    visitedBefore.clear();
    return;
  }
  if (linked) return;
  const id = mode.videoId(new URL(location.href));
  if (id) linked = { url: location.href, id };
  else visitedBefore.add(pageKey(location.href));
}
/** Research mode: anything past the linked video in this page, such as the next video or
 * its creator’s profile. Pages visited before it stay open. */
function beyondLinkedVideo() {
  const mode = research();
  if (!mode || !linked) return false;
  const id = mode.videoId(new URL(location.href));
  if (id) return id !== linked.id;
  return !visitedBefore.has(pageKey(location.href));
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
/**
 * What may not play here, worked out once per address, settings and second rather than for
 * every video on every media event: busy pages (TikTok and X Explore) hold dozens of videos.
 */
let mediaRulesCache:
  | { state: AppState; href: string; second: number; blocked: boolean; all: boolean; selector: string }
  | undefined;
function mediaRules() {
  const second = Math.floor(Date.now() / 1000);
  const c = mediaRulesCache;
  if (c && c.state === state && c.href === location.href && c.second === second && c.blocked === pageBlocked)
    return c;
  const settings = feeds()!;
  const all =
    pageBlocked ||
    beyondLinkedVideo() ||
    currentDecision().status === "blocked" ||
    Boolean(shortFormBlock(settings, location.href) || documentShortForm());
  const selectors = enabledElements(settings, location.href)
    .filter((element) => element.pauseMedia)
    .flatMap((element) => element.selectors)
    .filter((selector) => {
      try {
        document.createDocumentFragment().querySelector(selector);
        return true;
      } catch {
        return false;
      }
    });
  return (mediaRulesCache = {
    state: state!,
    href: location.href,
    second,
    blocked: pageBlocked,
    all,
    selector: selectors.join(","),
  });
}
function blockedMedia(media: HTMLMediaElement): boolean {
  if (!state) return false;
  const rules = mediaRules();
  return rules.all || Boolean(rules.selector && media.closest(rules.selector));
}
/**
 * Some sites start a video again the moment it is paused. Answering every restart in turn
 * kept Safari busy without end, so a video that keeps restarting is also muted and after
 * that paused at most once a second.
 */
const pauses = new WeakMap<HTMLMediaElement, { count: number; since: number; last: number }>();
function pauseBlocked(media: HTMLMediaElement) {
  const now = Date.now();
  let record = pauses.get(media);
  if (!record || now - record.since > 5_000) record = { count: 0, since: now, last: 0 };
  pauses.set(media, record);
  record.count += 1;
  if (record.count > 3) {
    media.muted = true;
    media.autoplay = false;
    if (now - record.last < 1_000) {
      queueMediaCheck();
      return;
    }
  }
  record.last = now;
  media.pause();
}
function pauseRestrictedMedia() {
  for (const media of document.querySelectorAll<HTMLMediaElement>(
    "video,audio",
  ))
    if (!media.paused && blockedMedia(media)) pauseBlocked(media);
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
/**
 * The policy decision for this page, reused within the same second for the same settings and
 * address: it only changes with settings, navigation or the clock.
 */
let decisionCache: { state: AppState; href: string; second: number; decision: PolicyDecision } | undefined;
function currentDecision(): PolicyDecision {
  const now = Date.now();
  const second = Math.floor(now / 1000);
  if (
    !decisionCache ||
    decisionCache.state !== state ||
    decisionCache.href !== location.href ||
    decisionCache.second !== second
  )
    decisionCache = { state: state!, href: location.href, second, decision: evaluatePolicy(state!, location.href, now) };
  return decisionCache.decision;
}
function evaluate() {
  if (!state || !/^https?:/.test(location.href) || !document.documentElement)
    return;
  trackResearch();
  syncScrollGuards();
  const decision = currentDecision();
  const short = documentShortForm();
  const single = beyondLinkedVideo();
  if (decision.status === "blocked" || short || single) {
    pageBlocked = true;
    freeTimeLabel = undefined;
    // Never wait for a background navigation or stop the document while Safari is loading.
    for (const media of document.querySelectorAll<HTMLMediaElement>(
      "video,audio",
    ))
      if (!media.paused) pauseBlocked(media);
    const label = short ?? decision.ruleLabel ?? siteFor(location.hostname)?.name ?? "This website";
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
    if (single && !short && decision.status !== "blocked" && linked)
      // Research mode: past the linked video, start over at the website's home page.
      blockedScreen.redirect(linked.url, `${location.origin}/`, siteFor(location.hostname)?.name ?? location.hostname);
    else
      blockedScreen.show(
        short
          ? { ...decision, status: "blocked", reasons: ["short-form"] }
          : decision,
        label,
        single ? linked?.url : undefined,
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
    overlay.earning();
    if (freeTimeLabel && !decision.freeTime)
      overlay.toast(
        decision.freeTimeOff?.state === "used-up"
          ? `Today’s Fry Time is used up. Feeds are hidden again.`
          : `${freeTimeLabel} is over. Feeds are hidden again.`,
      );
    freeTimeLabel = decision.freeTime?.label;
  }
}
// Busy pages (TikTok, X) change their layout many times a second; checking at most four
// times a second is plenty, and the one-second timer covers the clock.
const queueEvaluation = createBatchedTask(evaluate, 250);
/** Media events come in bursts; pausing and reporting playback once per burst is enough. */
const queueMediaCheck = createBatchedTask(() => {
  if (!state) return;
  pauseRestrictedMedia();
  reportMedia();
}, 250);
const overlay = (() => {
  let host: HTMLElement | undefined, pill: HTMLElement, toast: HTMLElement, earn: HTMLElement;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function ensure() {
    if (!document.body) return;
    if (!host) {
      host = document.createElement("screenfry-overlay");
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `<style>:host{all:initial}.wrap{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:grid;gap:8px;justify-items:end;font:500 13px/1.3 system-ui}.chip{display:none;padding:10px 14px;border-radius:99px;background:#263a32;color:white;box-shadow:0 5px 20px #0003;font-variant-numeric:tabular-nums}.earn{background:#f4621f}.show{display:block}</style><div class="wrap"><div class="chip toast"></div><div class="chip earn"></div><div class="chip pill"></div></div>`;
      pill = root.querySelector(".pill")!;
      toast = root.querySelector(".toast")!;
      earn = root.querySelector(".earn")!;
    }
    if (!host.isConnected) document.documentElement.append(host);
  }
  return {
    /**
     * On an earn goal's website: the time toward it, counting up by the second while this
     * tab is in front (the background saves it about once a minute and when you leave).
     */
    earning() {
      const goals = state ? earnGoalsFor(state, location.href) : [];
      const now = Date.now();
      const goal = goals.find((g) => earnRemaining(state!, g, now) > 0);
      if (!goal) {
        earn?.classList.remove("show");
        return;
      }
      ensure();
      if (!earn) return;
      const inUse = document.visibilityState === "visible" && document.hasFocus();
      const elapsed =
        inUse && state?.usageAsOf ? Math.max(0, Math.min(90_000, now - state.usageAsOf)) : 0;
      const step = goal.minutes * 60_000;
      const toward = Math.min(step, (earnGoalUsed(state!, goal, now) % step) + elapsed);
      const clock = (ms: number) => {
        const sec = Math.floor(ms / 1000);
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
      };
      const text = `${inUse ? "Earning" : "Paused"} · ${goal.label} · ${clock(toward)} of ${clock(step)}${goal.strict ? " · strict" : ""}`;
      if (earn.textContent !== text) earn.textContent = text;
      earn.classList.add("show");
    },
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
/** True when ScreenFry has anything to do on this page: a launch site, a rule/window domain or an earn goal website. */
function relevantHost(s: AppState | undefined): boolean {
  const host = location.hostname;
  if (siteFor(host)) return true;
  if (!s) return false;
  const covers = (domains: string[]) =>
    domains.some((d) => hostMatchesDomain(host, d));
  return (
    s.rules.some((r) => r.enabled && covers(r.domains)) ||
    s.windows.some((w) => w.enabled && covers(w.domains)) ||
    // Earn goal websites show their live timer.
    (s.earnGoals ?? []).some((g) => g.enabled && covers(g.goalDomains))
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
  // Usage is saved often while something plays. A tab in the background only needs the
  // newest state when it is shown again (its media is still checked on media events).
  let pendingState: unknown;
  const applyPending = () => {
    if (pendingState === undefined) return;
    state = migrateState(pendingState);
    pendingState = undefined;
    queueEvaluation();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STATE_KEY]) {
      pendingState = changes[STATE_KEY].newValue;
      if (document.visibilityState === "visible") applyPending();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") applyPending();
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
let guardedResearch: ReturnType<typeof research> | undefined;
function guardScroll(event: Event) {
  // Block moving on to the next video, not scrolling comments or typing in a field.
  const mode = guardedResearch;
  if (!mode || !linked || !(event.target instanceof Element)) return;
  const keep = ['input', 'textarea', '[contenteditable="true"]', ...(mode.keepScrolling ?? [])].join(",");
  if (event.target.closest(keep)) return;
  const keyboard = event instanceof KeyboardEvent;
  if (
    keyboard &&
    !["ArrowDown", "ArrowUp", "PageDown", "PageUp", " "].includes(event.key)
  )
    return;
  if (keyboard || event.target.closest(mode.scrollSelectors.join(","))) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
let scrollGuardsInstalled = false;
function syncScrollGuards() {
  const mode = research();
  guardedResearch = mode && linked && !beyondLinkedVideo() ? mode : undefined;
  const enabled = Boolean(guardedResearch);
  if (enabled === scrollGuardsInstalled) return;
  scrollGuardsInstalled = enabled;
  for (const event of ["wheel", "touchmove", "keydown"]) {
    // These need preventDefault, but only while a linked video is open in research mode.
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
          pauseBlocked(e.target);
        queueMediaCheck();
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
      if (message?.type === "SCREENFRY_TOAST") overlay.toast(message.text);
      if (message?.type === "SCREENFRY_WARNING")
        overlay.toast(
          `${message.minutesRemaining} minute${message.minutesRemaining === 1 ? "" : "s"} left on ${message.label} today`,
        );
    },
  );
