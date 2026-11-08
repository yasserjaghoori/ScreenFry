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
import { activeShortForm, siteDefinitions } from "@feeds/index";
import {
  extensionPageUrl,
  networkBlockAction,
  networkResourceTypes,
} from "@browser/urls";
import {
  evaluatePolicy,
  matchingRules,
  nextPolicyBoundary,
} from "@policy/index";
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
  return extensionPageUrl("blocked.html", {
    url,
    label: decision.ruleLabel ?? "This website",
  });
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
/**
 * Signature of the installed dynamic rules. Safari recompiles its whole content-rule list on
 * every updateDynamicRules call and stalls page loads meanwhile, and its nonpersistent
 * background page reloads often, so the signature is persisted rather than kept in memory.
 */
const NETWORK_RULES_KEY = "screenfry.networkRules";
let lastNetworkRules: string | undefined;
async function syncNetworkRules(state: AppState) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  const addRules: chrome.declarativeNetRequest.Rule[] = [];
  const redirect = (id: number, regexFilter: string, label: string) =>
    addRules.push({
      id,
      priority: 1,
      action: networkBlockAction(browser, label),
      condition: {
        regexFilter,
        resourceTypes: networkResourceTypes(browser),
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
  // One rule per site whose "block short-form entirely" setting is on.
  siteDefinitions.forEach((site, index) => {
    const short = site.shortForm;
    if (!short || !activeShortForm(state.feedSettings, site.domains[0])) return;
    const hosts = site.domains.map(escapeRegex).join("|");
    redirect(
      50_001 + index,
      `^(https?://([^/?#]+\\.)?(${hosts})\\.?(:[0-9]+)?/(${short.pathSegment})([/?#].*)?)$`,
      short.label,
    );
  });
  const signature = JSON.stringify(addRules);
  // Already installed during this background lifetime: skip the browser round trip.
  if (signature === lastNetworkRules) return;
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const ours = existing.filter((r) => r.id >= 10_000);
    const installedIds = ours
      .map((r) => r.id)
      .sort((a, b) => a - b)
      .join();
    const wantedIds = addRules
      .map((r) => r.id)
      .sort((a, b) => a - b)
      .join();
    lastNetworkRules ??= String(
      (await chrome.storage.local.get(NETWORK_RULES_KEY))[NETWORK_RULES_KEY] ??
        "",
    );
    if (signature === lastNetworkRules && installedIds === wantedIds) return;
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ours.map((r) => r.id),
      addRules,
    });
    lastNetworkRules = signature;
    await chrome.storage.local.set({ [NETWORK_RULES_KEY]: signature });
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
        TrackingSession[] | undefined) ?? memorySessions
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
/** Only tabs on websites with a rule are tracked; nothing is recorded about other browsing. */
async function findTrackableTabs(state: AppState) {
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
    enriched.filter((t) => matchingRules(state, t.url ?? "").length),
    window.focused ? window.id : undefined,
    idle,
  );
}
const sameTabs = (a: TrackingSession[], b: { id?: number; url?: string }[]) =>
  a.length === b.length &&
  a.every((s) => b.some((t) => t.id === s.tabId && t.url === s.url));
/**
 * Credits elapsed time and restarts sessions. Event-driven calls (tab activation, page loads,
 * media reports) skip the write when the tracked tabs haven't changed: sessions keep their
 * start time, so the heartbeat and boundary timers (which pass `force`) still credit it.
 */
async function checkpointTracking(force: boolean) {
  const now = Date.now(),
    sessions = await loadSessions();
  const tabs = await findTrackableTabs(await chromeStateStore.get());
  if (!force && sessions.length && sameTabs(sessions, tabs)) return;
  if (sessions.length) {
    let warnings: {
      ruleId: string;
      label: string;
      minutesRemaining: number;
    }[] = [];
    await chromeStateStore.update((state) => {
      const before = JSON.stringify(state.usage);
      const r = creditSessions(state, sessions, now);
      warnings = r.warnings;
      // Time on untracked websites credits nothing; leaving usageAsOf alone then lets the
      // store skip the write instead of broadcasting a change to every open tab.
      // A newly tracked rule site also needs a fresh start for its on-page timer.
      if (
        JSON.stringify(r.state.usage) !== before ||
        tabs.some((t) => matchingRules(r.state, t.url ?? "").length)
      )
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
let lastBoundaryAlarm: number | undefined;
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
  if (when !== lastBoundaryAlarm) {
    await chrome.alarms.create(BOUNDARY, { when });
    lastBoundaryAlarm = when;
  }
  if (timer) clearTimeout(timer);
  if (when - now < 60_000)
    timer = setTimeout(
      () => {
        void reevaluate(true);
      },
      when - now + 20,
    );
}
let chain: Promise<unknown> = Promise.resolve();
let queued: { promise: Promise<void>; force: boolean } | undefined;
/**
 * Runs are serialized, and any requests that arrive while one is waiting merge into that
 * single queued run. Bursts of tab, focus and media events therefore cost one pass, not one
 * pass each. `force` credits tracked time even when the tracked tabs are unchanged.
 */
function reevaluate(force = false): Promise<void> {
  if (queued) {
    queued.force ||= force;
    return queued.promise;
  }
  const entry = { force, promise: Promise.resolve() };
  entry.promise = chain
    .then(async () => {
      queued = undefined;
      await checkpointTracking(entry.force);
      const state = await actions.maintain(ctx);
      await syncNetworkRules(state);
      await enforceAllTabs(state);
      await scheduleNextBoundary(state);
    })
    .catch((error) =>
      console.warn("ScreenFry: reevaluation failed", String(error)),
    );
  queued = entry;
  chain = entry.promise;
  return entry.promise;
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
/** A player detected in the page (not by URL) counts only when that site's own setting is on. */
function shortFormLabelAllowed(
  state: AppState,
  url: string,
  label: string,
): string | undefined {
  const short = activeShortForm(state.feedSettings, new URL(url).hostname);
  return short?.label === label ? label : undefined;
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
      await reevaluate(true);
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
      // Only a change in playback matters. Repeated "still playing" reports refresh the
      // timestamp above; reevaluating on each one made video pages churn every frame.
      if (previous?.playing !== request.playing) await reevaluate(true);
      return { ok: true, data: null };
    }
    case "SHOW_BLOCKED_PAGE": {
      // A content script found a blocked page or a short-form player. The extension's own tab
      // navigation reaches the blocked page reliably in Safari, where a web page navigating
      // itself to an extension URL can fail. Only the sender's own top frame is redirected.
      const tabId = sender.tab?.id;
      const url = parseWebUrl(sender.url ?? "")?.href;
      // Some Safari versions omit frameId; then the top frame is the one showing the tab's URL.
      const topFrame =
        sender.frameId === 0 ||
        (sender.frameId === undefined && sender.url === sender.tab?.url);
      if (tabId === undefined || !topFrame || !url)
        return { ok: false, error: "Invalid sender." };
      const state = await chromeStateStore.get();
      const decision = evaluatePolicy(state, url, Date.now());
      const label =
        decision.status === "blocked"
          ? (decision.ruleLabel ?? "This website")
          : shortFormLabelAllowed(state, url, request.label);
      if (!label) return { ok: false, error: "Not blocked." };
      await chrome.tabs.update(tabId, {
        url: extensionPageUrl("blocked.html", { url, label }),
      });
      return { ok: true, data: null };
    }
    case "UNLOCK_SETTINGS":
      return actions.unlockSettings(auth);
    case "SET_SETTINGS_PASSWORD":
      return actions.setSettingsPassword(auth, request.newPassword);
    case "SAVE_RULE": {
      await reevaluate(true);
      const r = await actions.saveRule(auth, request.rule);
      await reevaluate(true);
      return r;
    }
    case "DELETE_RULE": {
      const r = await actions.deleteRule(auth, request.ruleId);
      await reevaluate(true);
      return r;
    }
    case "SAVE_WINDOW": {
      await reevaluate(true);
      const r = await actions.saveWindow(auth, request.window);
      await reevaluate(true);
      return r;
    }
    case "DELETE_WINDOW": {
      const r = await actions.deleteWindow(auth, request.windowId);
      await reevaluate(true);
      return r;
    }
    case "SET_FEEDS": {
      const r = await actions.setFeeds(auth, request.feedSettings);
      await reevaluate(true);
      return r;
    }
    case "SET_PREFERENCES":
      return actions.setPreferences(auth, request);
    case "COMPLETE_ONBOARDING":
      return actions.completeOnboarding(auth);
    case "REFRESH_PROTECTION":
      return { ok: true, data: await refreshProtection() };
    case "RESET_ALL": {
      const r = await actions.resetAll(auth);
      await reevaluate(true);
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
  if (alarm.name === HEARTBEAT || alarm.name === BOUNDARY)
    void reevaluate(true);
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarms();
  if (reason === "install")
    await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  await refreshProtection();
  await reevaluate();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarms()
    .then(refreshProtection)
    .then(() => reevaluate(true));
});
async function start() {
  try {
    media =
      ((await sessionArea()?.get(MEDIA_KEY))?.[MEDIA_KEY] as
        MediaFrames | undefined) ?? {};
  } catch {
    /* memory fallback */
  }
  await ensureAlarms();
  await reevaluate();
}
void start();
console.info(`ScreenFry ready (${browser})`);
