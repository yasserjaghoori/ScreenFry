import * as actions from "@core/actions";
import { parseWebUrl } from "@core/domains";
import {
  creditSessions,
  nextTrackingBoundary,
  pickTrackedTabs,
  type IdleState,
  type TrackingSession,
} from "@core/tracking";
import {
  CONTENT_SCRIPT_REQUESTS,
  type Request,
  type TabMessage,
} from "@browser/messages";
import {
  detectBrowser,
  hasIdleApi,
  queryPrivateAccess,
  sessionArea,
} from "@browser/platform";
import { chromeStateStore } from "@browser/storage";
import { evaluatePolicy, nextPolicyBoundary } from "@policy/index";
import type { AppState, PolicyDecision } from "@shared/index";
const ctx: actions.ActionContext = {
  store: chromeStateStore,
  now: () => Date.now(),
};
const HEARTBEAT = "heartbeat",
  BOUNDARY = "policy-boundary",
  SESSION_KEY = "trackingSessionsV3",
  MEDIA_KEY = "playingMediaV3";
const extensionOrigin = chrome.runtime.getURL("");
const browser = detectBrowser();
function blockedPageUrl(url: string, decision: PolicyDecision): string {
  return chrome.runtime.getURL(
    `blocked.html?${new URLSearchParams({ url, label: decision.ruleLabel ?? "This website" })}`,
  );
}
async function enforceTab(
  id: number,
  url: string | undefined,
  state: AppState,
  now: number,
) {
  if (!url || !parseWebUrl(url)) return;
  const decision = evaluatePolicy(state, url, now);
  if (decision.status === "blocked")
    try {
      await chrome.tabs.update(id, { url: blockedPageUrl(url, decision) });
    } catch {
      /* closed tab */
    }
}
async function enforceAllTabs(state: AppState) {
  const tabs = await chrome.tabs.query({}),
    now = Date.now();
  await Promise.all(
    tabs.map((t) =>
      t.id === undefined ? undefined : enforceTab(t.id, t.url, state, now),
    ),
  );
  if (tabs.some((t) => t.incognito)) await noteObservedPrivateTab();
}
const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let lastNetworkRules = "";
async function syncNetworkRules(state: AppState) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  const addRules: chrome.declarativeNetRequest.Rule[] = [];
  const redirect = (id: number, regexFilter: string, label: string) =>
    addRules.push({
      id,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
        redirect: {
          regexSubstitution: `${chrome.runtime.getURL("blocked.html")}?${new URLSearchParams({ label, source: "network" })}&url=\\1`,
        },
      },
      condition: {
        regexFilter,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
          chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
        ],
      },
    });
  const domains = [
    ...new Set([
      ...state.rules.filter((r) => r.enabled).flatMap((r) => r.domains),
      ...state.windows.filter((w) => w.enabled).flatMap((w) => w.domains),
    ]),
  ].sort();
  domains.slice(0, 4500).forEach((domain, index) => {
    const decision = evaluatePolicy(state, `https://${domain}/`, Date.now());
    if (decision.status === "blocked")
      redirect(
        10_000 + index,
        `^(https?://([^/?#]+\\.)?${escapeRegex(domain)}\\.?(:[0-9]+)?([/?#].*)?)$`,
        decision.ruleLabel ?? domain,
      );
  });
  if (state.feedSettings.globalEnabled) {
    if (state.feedSettings.sites.youtube.shorts)
      redirect(
        50_001,
        "^(https?://([^/?#]+\\.)?(youtube\\.com|youtube-nocookie\\.com)\\.?(:[0-9]+)?/shorts([/?#].*)?)$",
        "YouTube Shorts",
      );
    if (state.feedSettings.sites.instagram.reels)
      redirect(
        50_002,
        "^(https?://([^/?#]+\\.)?(instagram\\.com|instagr\\.am)\\.?(:[0-9]+)?/reels?([/?#].*)?)$",
        "Instagram Reels",
      );
  }
  const signature = JSON.stringify(addRules);
  if (signature === lastNetworkRules) return;
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.filter((r) => r.id >= 10_000).map((r) => r.id),
      addRules,
    });
    lastNetworkRules = signature;
  } catch (error) {
    console.warn("ScreenFry: using tab/content enforcement", String(error));
  }
}
let memorySessions: TrackingSession[] = [];
type MediaFrames = Record<
  string,
  { playing: boolean; at: number; documentId?: string }
>;
let media: MediaFrames = {};
async function loadSessions(): Promise<TrackingSession[]> {
  try {
    return (
      ((await sessionArea()?.get(SESSION_KEY))?.[SESSION_KEY] as
        | TrackingSession[]
        | undefined) ?? memorySessions
    );
  } catch {
    return memorySessions;
  }
}
async function saveSessions(sessions: TrackingSession[]) {
  memorySessions = sessions;
  try {
    await sessionArea()?.set({ [SESSION_KEY]: sessions });
  } catch {
    /* Safari memory fallback */
  }
}
async function currentIdleState(): Promise<IdleState> {
  try {
    return hasIdleApi()
      ? ((await chrome.idle.queryState(60)) as IdleState)
      : "active";
  } catch {
    return "active";
  }
}
async function findTrackableTabs() {
  const [tabs, window, idle] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getLastFocused(),
    currentIdleState(),
  ]);
  const now = Date.now();
  const enriched = tabs.map((t) => ({
    ...t,
    mediaPlaying: Object.entries(media).some(
      ([key, m]) =>
        key.startsWith(`${t.id}:`) && m.playing && now - m.at < 30_000,
    ),
  }));
  return pickTrackedTabs(
    enriched,
    window.focused ? window.id : undefined,
    idle,
  );
}
async function checkpointTracking() {
  const now = Date.now(),
    sessions = await loadSessions();
  if (sessions.length) {
    let warnings: {
      ruleId: string;
      label: string;
      minutesRemaining: number;
    }[] = [];
    await chromeStateStore.update((state) => {
      const r = creditSessions(state, sessions, now);
      warnings = r.warnings;
      r.state.usageAsOf = now;
      return r.state;
    });
    for (const warning of warnings) {
      const ids = new Set(sessions.map((s) => s.tabId));
      for (const id of ids)
        try {
          await chrome.tabs.sendMessage(id, {
            type: "SCREENTIME_WARNING",
            label: warning.label,
            minutesRemaining: warning.minutesRemaining,
          } satisfies TabMessage);
        } catch {
          /* no content script */
        }
    }
  }
  const tabs = await findTrackableTabs();
  await saveSessions(
    tabs.map((t) => ({
      tabId: t.id!,
      windowId: t.windowId,
      url: t.url!,
      startedAt: now,
    })),
  );
}
let timer: ReturnType<typeof setTimeout> | undefined;
async function scheduleNextBoundary(state: AppState) {
  const now = Date.now(),
    sessions = await loadSessions();
  const boundaries = [
    nextPolicyBoundary(state, now),
    ...sessions
      .map((s) => nextTrackingBoundary(state, s.url, now))
      .filter((n): n is number => n !== undefined),
  ];
  const when = Math.max(now + 250, Math.min(...boundaries));
  await chrome.alarms.create(BOUNDARY, { when });
  if (timer) clearTimeout(timer);
  if (when - now < 60_000)
    timer = setTimeout(
      () => {
        void reevaluate();
      },
      when - now + 20,
    );
}
let chain: Promise<unknown> = Promise.resolve();
function reevaluate(): Promise<void> {
  const run = chain.then(async () => {
    await checkpointTracking();
    const state = await actions.maintain(ctx);
    await syncNetworkRules(state);
    await enforceAllTabs(state);
    await scheduleNextBoundary(state);
  });
  chain = run.catch((error) =>
    console.warn("ScreenFry: reevaluation failed", String(error)),
  );
  return chain as Promise<void>;
}
let observedPrivate = false;
async function noteObservedPrivateTab() {
  if (observedPrivate) return;
  observedPrivate = true;
  await actions.recordProtection(ctx, { observedPrivateTab: true });
}
async function refreshProtection() {
  return actions.recordProtection(ctx, {
    privateAccess: await queryPrivateAccess(),
    observedPrivateTab: (await chrome.tabs.query({})).some((t) => t.incognito),
  });
}
async function ensureAlarms() {
  if (!(await chrome.alarms.get(HEARTBEAT)))
    await chrome.alarms.create(HEARTBEAT, { periodInMinutes: 1 });
}
const isExtensionSender = (sender: chrome.runtime.MessageSender) =>
  sender.id === chrome.runtime.id &&
  Boolean(sender.url?.startsWith(extensionOrigin));
async function handle(
  request: Request,
  sender: chrome.runtime.MessageSender,
): Promise<actions.ActionResult<unknown>> {
  if (!request || sender.id !== chrome.runtime.id)
    return { ok: false, error: "Unknown sender." };
  if (!isExtensionSender(sender) && !CONTENT_SCRIPT_REQUESTS.has(request.type))
    return { ok: false, error: "Not allowed from web pages." };
  const auth = { ...ctx, password: request.password };
  switch (request.type) {
    case "GET_STATE":
      await reevaluate();
      return { ok: true, data: await chromeStateStore.get() };
    case "GET_POLICY":
      return {
        ok: true,
        data: evaluatePolicy(
          await chromeStateStore.get(),
          request.url,
          Date.now(),
        ),
      };
    case "MEDIA_STATE": {
      if (
        sender.tab?.id === undefined ||
        !parseWebUrl(sender.url ?? "") ||
        typeof request.playing !== "boolean"
      )
        return { ok: false, error: "Invalid media sender." };
      const key = `${sender.tab.id}:${sender.frameId ?? 0}`;
      const previous = media[key];
      media[key] = {
        playing: request.playing,
        at: Date.now(),
        documentId: sender.documentId,
      };
      try {
        await sessionArea()?.set({ [MEDIA_KEY]: media });
      } catch {
        /* memory fallback */
      }
      // Fresh reports also wake persisted tracking after worker suspension.
      if (previous?.playing !== request.playing || request.playing)
        await reevaluate();
      return { ok: true, data: null };
    }
    case "UNLOCK_SETTINGS":
      return actions.unlockSettings(auth);
    case "SET_SETTINGS_PASSWORD":
      return actions.setSettingsPassword(auth, request.newPassword);
    case "SAVE_RULE": {
      await reevaluate();
      const r = await actions.saveRule(auth, request.rule);
      await reevaluate();
      return r;
    }
    case "DELETE_RULE": {
      const r = await actions.deleteRule(auth, request.ruleId);
      await reevaluate();
      return r;
    }
    case "SAVE_WINDOW": {
      await reevaluate();
      const r = await actions.saveWindow(auth, request.window);
      await reevaluate();
      return r;
    }
    case "DELETE_WINDOW": {
      const r = await actions.deleteWindow(auth, request.windowId);
      await reevaluate();
      return r;
    }
    case "SET_FEEDS": {
      const r = await actions.setFeeds(auth, request.feedSettings);
      await reevaluate();
      return r;
    }
    case "SET_PREFERENCES":
      return actions.setPreferences(auth, request);
    case "COMPLETE_ONBOARDING":
      return actions.completeOnboarding(auth);
    case "REFRESH_PROTECTION":
      return { ok: true, data: await refreshProtection() };
    case "DELETE_HISTORY":
      return actions.deleteHistory(auth);
    case "RESET_ALL": {
      const r = await actions.resetAll(auth);
      await reevaluate();
      return r;
    }
    default:
      return { ok: false, error: "Unsupported request." };
  }
}
chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  handle(request, sender)
    .then(respond)
    .catch((e: unknown) =>
      respond({
        ok: false,
        error: e instanceof Error ? e.message : "Unexpected error",
      }),
    );
  return true;
});
chrome.tabs.onActivated.addListener(() => {
  void reevaluate();
});
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.url) {
    for (const key of Object.keys(media))
      if (key.startsWith(`${id}:`)) delete media[key];
    void chromeStateStore
      .get()
      .then((s) => enforceTab(id, change.url, s, Date.now()));
  }
  if (
    change.url ||
    change.audible !== undefined ||
    change.status === "complete"
  )
    void reevaluate();
  if (tab.incognito) void noteObservedPrivateTab();
});
chrome.tabs.onRemoved.addListener((id) => {
  for (const key of Object.keys(media))
    if (key.startsWith(`${id}:`)) delete media[key];
  void reevaluate();
});
chrome.windows.onFocusChanged.addListener(() => {
  void reevaluate();
});
if (hasIdleApi()) {
  chrome.idle.setDetectionInterval(60);
  chrome.idle.onStateChanged.addListener(() => {
    void reevaluate();
  });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT || alarm.name === BOUNDARY) void reevaluate();
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarms();
  if (reason === "install")
    await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  await refreshProtection();
  await reevaluate();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarms().then(refreshProtection).then(reevaluate);
});
async function start() {
  try {
    media =
      ((await sessionArea()?.get(MEDIA_KEY))?.[MEDIA_KEY] as
        | MediaFrames
        | undefined) ?? {};
  } catch {
    /* memory fallback */
  }
  await ensureAlarms();
  await reevaluate();
}
void start();
console.info(`ScreenFry ready (${browser})`);
