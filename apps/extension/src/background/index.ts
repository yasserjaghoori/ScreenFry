import * as actions from "@core/actions";
/** Set by Vite: the version this code was built as. */
declare const __CODE_VERSION__: string;
const CODE_VERSION = typeof __CODE_VERSION__ === "string" ? __CODE_VERSION__ : "";
import { withTimeout } from "@browser/scheduling";
import { siteFor } from "@feeds/index";
import { parseWebUrl } from "@core/domains";
import {
  creditSessions,
  nextTrackingBoundary,
  pickTrackedTabs,
  resetBrokenStrictGoals,
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
import { APP_SETUP_KEY, chromeStateStore } from "@browser/storage";
import { REOPEN_KEY } from "../ui/healBackground";
import { activeShortForm, siteDefinitions } from "@feeds/index";
import {
  extensionPageUrl,
  OPEN_SCREENFRY_ADDRESS,
  openScreenFryPage,
  networkBlockAction,
  networkResourceTypes,
} from "@browser/urls";
import { encodeShareCode, websiteNames } from "@core/share";
import {
  earnCompletions,
  earnGoalsFor,
  effectiveFeedSettings,
  fryEarnedMinutes,
  isFryGoal,
  evaluatePolicy,
  freeWindowsFor,
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
/**
 * Safari tabs already told about their block, by address: the page keeps its blocked screen
 * on its own, so asking it again on every reevaluation only made busy pages busier.
 */
const toldBlocked = new Map<number, string>();
/** Playback starting and stopping (hover previews on Explore pages) settles within a second. */
let mediaTimer: ReturnType<typeof setTimeout> | undefined;
function queueMediaReevaluation() {
  if (mediaTimer) return;
  mediaTimer = setTimeout(() => {
    mediaTimer = undefined;
    void reevaluate(true);
  }, 1_000);
}
async function enforceTab(
  id: number,
  url: string | undefined,
  state: AppState,
  now: number,
) {
  if (!url || !parseWebUrl(url)) return;
  const decision = evaluatePolicy(state, url, now);
  if (decision.status !== "blocked") toldBlocked.delete(id);
  if (decision.status === "blocked")
    try {
      // Safari renders a local isolated notice; cross-scheme tab updates can hang.
      if (browser === "safari") {
        if (toldBlocked.get(id) === url) return;
        toldBlocked.set(id, url);
        await withTimeout(
          chrome.tabs.sendMessage(
            id,
            { type: "SCREENFRY_APPLY_SETTINGS" } satisfies TabMessage,
            { frameId: 0 },
          ),
        );
      } else {
        await withTimeout(
          chrome.tabs.update(id, { url: blockedPageUrl(url, decision) }),
        );
      }
    } catch {
      toldBlocked.delete(id); // closed tab, or try again next time
    }
}
async function enforceAllTabs(state: AppState) {
  const tabs = await withTimeout(chrome.tabs.query({})),
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
      ...(state.earnGoals ?? []).filter((g) => g.enabled).flatMap((g) => g.lockedDomains),
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
  // One rule per site whose "block short-form entirely" setting is on (and not paused by
  // free time; the boundary at which free time ends re-runs this sync).
  const now = Date.now();
  siteDefinitions.forEach((site, index) => {
    const short = site.shortForm;
    const feeds = effectiveFeedSettings(state, `https://${site.domains[0]}/`, now);
    if (!short || !activeShortForm(feeds, site.domains[0])) return;
    const hosts = site.domains.map(escapeRegex).join("|");
    redirect(
      50_001 + index,
      `^(https?://([^/?#]+\\.)?(${hosts})\\.?(:[0-9]+)?/(${short.pathSegment})([/?#].*)?)$`,
      short.label,
    );
  });
  // The Mac app's "Open ScreenFry Settings" address, sent to ScreenFry's page before Chrome
  // tries to load it, so it works even while this background is asleep. (Safari can't
  // redirect pages to the extension; there the tab listener below handles it.)
  if (browser !== "safari")
    addRules.push({
      id: 60_000,
      priority: 2,
      action: {
        type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
        redirect: { regexSubstitution: `${chrome.runtime.getURL("blocked.html")}?open=\\1` },
      },
      condition: {
        regexFilter: `^${escapeRegex(OPEN_SCREENFRY_ADDRESS)}([a-z]*).*$`,
        resourceTypes: ["main_frame"] as chrome.declarativeNetRequest.ResourceType[],
      },
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
      ? ((await withTimeout(chrome.idle.queryState(60))) as IdleState)
      : "active";
  } catch {
    return "active";
  }
}
/**
 * Websites with a rule, a free-time window or an earn goal; nothing is recorded about other
 * browsing.
 */
const trackedUrl = (state: AppState, url: string) =>
  matchingRules(state, url).length > 0 ||
  freeWindowsFor(state, url).length > 0 ||
  earnGoalsFor(state, url).length > 0;
/** Only tabs on websites with a rule are tracked; nothing is recorded about other browsing. */
async function findTrackableTabs(state: AppState) {
  const [tabs, window, idle] = await Promise.all([
    withTimeout(chrome.tabs.query({})),
    withTimeout(chrome.windows.getLastFocused()),
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
  const focusedWindow = window.focused ? window.id : undefined;
  return pickTrackedTabs(
    enriched.filter((t) => trackedUrl(state, t.url ?? "")),
    focusedWindow,
    idle,
  ).map((t) => ({
    ...t,
    // In front and in use: what earn goals count. ScreenFry's own popup being open counts as
    // using another app.
    activeUse: t.active && t.windowId === focusedWindow && idle === "active" && openPopups === 0,
  }));
}
const sameTabs = (
  a: TrackingSession[],
  b: { id?: number; url?: string; activeUse?: boolean }[],
) =>
  a.length === b.length &&
  a.every((s) =>
    b.some((t) => t.id === s.tabId && t.url === s.url && (s.active ?? true) === t.activeUse),
  );
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
    let earned: string[] = [];
    await chromeStateStore.update((state) => {
      const before = JSON.stringify(state.usage);
      const doneBefore = new Map(
        (state.earnGoals ?? []).map((g) => [g.id, earnCompletions(state, g, now)]),
      );
      const r = creditSessions(state, sessions, now);
      warnings = r.warnings;
      // Strict goals: leaving the goal website resets the time toward the next completion.
      resetBrokenStrictGoals(
        r.state,
        tabs.filter((t) => t.activeUse).map((t) => t.url ?? ""),
        now,
      );
      earned = (r.state.earnGoals ?? []).flatMap((g) => {
        const done = earnCompletions(r.state, g, now);
        const was = doneBefore.get(g.id) ?? 0;
        if (!g.enabled || done <= was) return [];
        const names = websiteNames(g.lockedDomains).join(", ");
        return [
          isFryGoal(g)
            ? `You earned ${fryEarnedMinutes(g, done) - fryEarnedMinutes(g, was)} min of Fry Time on ${names}.`
            : `Goal met: ${names} ${g.lockedDomains.length > 1 && names.includes(",") ? "are" : "is"} unlocked for today.`,
        ];
      });
      // Time on untracked websites credits nothing; leaving usageAsOf alone then lets the
      // store skip the write instead of broadcasting a change to every open tab.
      // A newly tracked rule site also needs a fresh start for its on-page timer.
      if (
        JSON.stringify(r.state.usage) !== before ||
        tabs.some((t) => trackedUrl(r.state, t.url ?? ""))
      )
        r.state.usageAsOf = now;
      return r.state;
    });
    // Tell whoever just earned it, on the page they're using.
    for (const text of earned)
      for (const id of new Set([...sessions.map((s) => s.tabId), ...tabs.map((t) => t.id!)]))
        try {
          await withTimeout(
            chrome.tabs.sendMessage(id, { type: "SCREENFRY_TOAST", text } satisfies TabMessage),
          );
        } catch {
          /* no content script */
        }
    for (const warning of warnings) {
      const ids = new Set(sessions.map((s) => s.tabId));
      for (const id of ids)
        try {
          await withTimeout(
            chrome.tabs.sendMessage(id, {
              type: "SCREENFRY_WARNING",
              label: warning.label,
              minutesRemaining: warning.minutesRemaining,
            } satisfies TabMessage),
          );
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
      active: t.activeUse,
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
      await scheduleNextBoundary(state);
      // Network rule compilation must not stall usage accounting or settings messages.
      void requestNetworkSync();
      await enforceAllTabs(state);
    })
    .catch((error) =>
      console.warn("ScreenFry: reevaluation failed", String(error)),
    );
  queued = entry;
  chain = entry.promise;
  return entry.promise;
}
let observedPrivate = false;
let networkSyncPromise: Promise<void> | undefined;
let networkSyncPending = false;
function requestNetworkSync(): Promise<void> {
  networkSyncPending = true;
  if (networkSyncPromise) return networkSyncPromise;
  networkSyncPromise = (async () => {
    try {
      while (networkSyncPending) {
        networkSyncPending = false;
        await syncNetworkRules(await chromeStateStore.get());
      }
    } finally {
      networkSyncPromise = undefined;
    }
  })();
  return networkSyncPromise;
}
async function settingsChanged() {
  void reevaluate(true);
  // Normally finish rule removal before an immediate revisit. A stalled Safari compiler
  // must still release the controls; the in-flight sync keeps only the newest pending state.
  await withTimeout(requestNetworkSync()).catch(() => undefined);
}
/** Apply to the active website live; a missing/stale content script gets one reload. */
async function refreshActiveSite(state: AppState, changedSites: string[]) {
  try {
    const [tab] = await withTimeout(
      chrome.tabs.query({ active: true, currentWindow: true }),
    );
    if (tab?.id === undefined || !tab.url) return;
    const host = parseWebUrl(tab.url)?.hostname;
    const site = host && siteFor(host)?.site;
    if (!site || !changedSites.includes(site)) return;
    try {
      const response = await withTimeout(
        chrome.tabs.sendMessage(
          tab.id,
          { type: "SCREENFRY_APPLY_SETTINGS" } satisfies TabMessage,
          { frameId: 0 },
        ),
      );
      if (response?.applied && response.url === tab.url) return;
    } catch {
      /* a reload injects the current script */
    }
    const current = await withTimeout(chrome.tabs.get(tab.id));
    if (
      current.url === tab.url &&
      current.status !== "loading" &&
      (browser === "safari" ||
        evaluatePolicy(state, tab.url, Date.now()).status === "allowed")
    )
      await withTimeout(chrome.tabs.reload(tab.id));
  } catch {
    /* closed/inaccessible tab; saved settings still apply on next visit */
  }
}
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
  const short = activeShortForm(
    effectiveFeedSettings(state, url, Date.now()),
    new URL(url).hostname,
  );
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
      return { ok: true, data: await chromeStateStore.get() };
    case "GET_BUILD":
      return { ok: true, data: { codeVersion: CODE_VERSION, manifestVersion: chrome.runtime.getManifest().version } };
    case "EARN_LIVE": {
      // Goal websites in active use since the last save: their clocks can tick live.
      const state = await chromeStateStore.get();
      const live: Record<string, number> = {};
      for (const s of await loadSessions())
        if (s.active !== false)
          for (const g of earnGoalsFor(state, s.url)) live[g.id] = Math.min(live[g.id] ?? s.startedAt, s.startedAt);
      return { ok: true, data: live };
    }
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
      if (previous?.playing !== request.playing) queueMediaReevaluation();
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
      if (browser === "safari") return { ok: true, data: null };
      await withTimeout(
        chrome.tabs.update(tabId, {
          url: extensionPageUrl("blocked.html", { url, label }),
        }),
      );
      return { ok: true, data: null };
    }
    case "UNLOCK_SETTINGS":
      return actions.unlockSettings(auth);
    case "SET_SETTINGS_PASSWORD":
      return actions.setSettingsPassword(auth, request.newPassword);
    case "SAVE_RULE": {
      const r = await actions.saveRule(auth, request.rule);
      if (r.ok) await settingsChanged();
      if (r.ok)
        void refreshActiveSite(
          r.data,
          siteDefinitions
            .filter((s) =>
              request.rule.domains.some((d) => s.domains.includes(d)),
            )
            .map((s) => s.site),
        );
      return r;
    }
    case "DELETE_RULE": {
      const r = await actions.deleteRule(auth, request.ruleId);
      if (r.ok) await settingsChanged();
      return r;
    }
    case "SAVE_WINDOW": {
      const r = await actions.saveWindow(auth, request.window);
      if (r.ok) await settingsChanged();
      return r;
    }
    case "DELETE_WINDOW": {
      const r = await actions.deleteWindow(auth, request.windowId);
      if (r.ok) await settingsChanged();
      return r;
    }
    case "SAVE_EARN_GOAL": {
      const r = await actions.saveEarnGoal(auth, request.goal);
      if (r.ok) await settingsChanged();
      return r;
    }
    case "DELETE_EARN_GOAL": {
      const r = await actions.deleteEarnGoal(auth, request.goalId);
      if (r.ok) await settingsChanged();
      return r;
    }
    case "SWITCH_LOADOUT":
    case "SET_LOADOUT_FROM_CODE": {
      const r =
        request.type === "SWITCH_LOADOUT"
          ? await actions.switchLoadout(auth, request.index)
          : await actions.setLoadoutFromCode(auth, request.index, request.code);
      if (r.ok) {
        await settingsChanged();
        void refreshActiveSite(
          r.data,
          siteDefinitions.map((s) => s.site),
        );
      }
      return r;
    }
    case "COPY_TO_LOADOUT":
      return actions.copyToLoadout(auth, request.index);
    case "CLEAR_LOADOUT":
      return actions.clearLoadout(auth, request.index);
    case "IMPORT_SHARE_CODE": {
      const r = await actions.importShareCode(auth, request.code);
      if (r.ok) {
        await settingsChanged();
        void refreshActiveSite(
          r.data,
          siteDefinitions.map((s) => s.site),
        );
      }
      return r;
    }
    case "SET_FEEDS": {
      const before = await chromeStateStore.get();
      const r = await actions.setFeeds(auth, request.feedSettings);
      if (r.ok) await settingsChanged();
      if (r.ok)
        void refreshActiveSite(
          r.data,
          siteDefinitions
            .filter(
              (s) =>
                before.feedSettings.globalEnabled !==
                  r.data.feedSettings.globalEnabled ||
                JSON.stringify(before.feedSettings.sites[s.site]) !==
                  JSON.stringify(r.data.feedSettings.sites[s.site]),
            )
            .map((s) => s.site),
        );
      return r;
    }
    case "SET_PREFERENCES":
      return actions.setPreferences(auth, request);
    case "COMPLETE_ONBOARDING":
      return actions.completeOnboarding(auth);
    case "PASSWORD_PROMPT_SEEN":
      return actions.markPasswordPromptSeen(auth);
    case "REFRESH_PROTECTION":
      return { ok: true, data: await refreshProtection() };
    case "RESET_ALL":
      return resetEverything(auth);
    case "OPEN_SAFARI_SETTINGS":
      return openSafariSettings();
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
/** ScreenFry popups open now: while one is, earn goals pause (and strict ones reset). */
let openPopups = 0;
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") return;
  openPopups++;
  void reevaluate();
  port.onDisconnect.addListener(() => {
    openPopups = Math.max(0, openPopups - 1);
    void reevaluate();
  });
});
/** The Mac app's "Open ScreenFry Settings": swap its placeholder tab for the dashboard. */
async function openFromApp(id: number, tab: chrome.tabs.Tab, page: string) {
  const url = extensionPageUrl("dashboard.html", {}, page);
  try {
    // Safari can hang moving a web tab to an extension page, so it gets a new tab instead.
    if (browser === "safari") {
      await withTimeout(chrome.tabs.create({ url, windowId: tab.windowId, active: true }));
      await withTimeout(chrome.tabs.remove(id));
    } else await withTimeout(chrome.tabs.update(id, { url, active: true }));
  } catch {
    /* closed meanwhile */
  }
}
const openingFromApp = new Set<number>();
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  const fromApp = openScreenFryPage(change.url ?? tab.url);
  if (fromApp) {
    if (openingFromApp.has(id)) return;
    openingFromApp.add(id);
    void openFromApp(id, tab, fromApp).finally(() => openingFromApp.delete(id));
    return;
  }
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
  toldBlocked.delete(id);
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
  if (alarm.name === HEARTBEAT) {
    void reloadIfUpdatedOnDisk();
    void syncWithApp();
  }
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarms();
  // Chrome can report reloading ScreenFry (to finish an update) as an install, so only
  // someone who hasn't set it up yet gets the welcome page.
  if (reason === "install" && !(await chromeStateStore.get()).onboardingComplete)
    await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  await refreshProtection();
  await reevaluate();
});
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarms()
    .then(refreshProtection)
    .then(() => reevaluate(true));
});
/**
 * Chrome loads ScreenFry from a folder the Mac app keeps current (an unpacked install).
 * After an app update the files on disk are newer than the code running, so reload to pick
 * them up: when the version changes, or when build.json's fingerprint differs from the one
 * this run started with (a rebuild without a version bump). Session storage clears on
 * reload, so each run records its own starting build. Store installs update themselves.
 */
const BUILD_KEY = "screenfry.startedBuild";
const STALE_RELOAD_KEY = "screenfry.staleReloadAt";
/** A page that reloaded ScreenFry to get a fresh background, opened again once it's up. */
async function reopenAfterReload() {
  try {
    const saved = await chrome.storage.local.get(REOPEN_KEY);
    const url = saved[REOPEN_KEY];
    if (typeof url !== "string" || !url.startsWith(chrome.runtime.getURL(""))) return;
    await chrome.storage.local.remove(REOPEN_KEY);
    await chrome.tabs.create({ url });
  } catch {
    /* nothing to reopen */
  }
}
void reopenAfterReload();
async function reloadIfUpdatedOnDisk() {
  if (browser !== "chrome") return;
  try {
    const self = await chrome.management.getSelf();
    if (self.installType !== "development") return;
    const { version } = (await (
      await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })
    ).json()) as { version?: string };
    const build = await fetch(chrome.runtime.getURL("build.json"), {
      cache: "no-store",
    })
      .then((r) => r.json() as Promise<{ build?: string }>)
      .then((b) => b.build)
      .catch(() => undefined);
    // Chrome can keep running an older service worker after the extension updates on disk:
    // the manifest says the new version but this code is older. Reload, at most every ten
    // minutes, until the code matches.
    if (CODE_VERSION && CODE_VERSION !== chrome.runtime.getManifest().version) {
      const last = (await chrome.storage.local.get(STALE_RELOAD_KEY))[STALE_RELOAD_KEY] as number | undefined;
      if (!last || Date.now() - last > 10 * 60_000) {
        await chrome.storage.local.set({ [STALE_RELOAD_KEY]: Date.now() });
        console.info(`ScreenFry: code ${CODE_VERSION} is older than ${chrome.runtime.getManifest().version}; reloading`);
        chrome.runtime.reload();
        return;
      }
    }
    const started = (await chrome.storage.session.get(BUILD_KEY))[BUILD_KEY] as
      | string
      | undefined;
    if (build && !started) await chrome.storage.session.set({ [BUILD_KEY]: build });
    if (
      (version && version !== chrome.runtime.getManifest().version) ||
      (build && started && build !== started)
    ) {
      console.info(`ScreenFry: reloading to apply ${version} (${build})`);
      chrome.runtime.reload();
    }
  } catch {
    /* management unavailable or manifest mid-update; try again next heartbeat */
  }
}
/**
 * Check-ins with the ScreenFry Mac app: this side reports only its version and whether a
 * settings password is on (never settings or usage), and picks up Reset All Data or Erase
 * Everything chosen in the app. Safari routes this to the extension's own native handler;
 * Chrome to the host the app registers. Without the app it's a no-op.
 */
const APP_HOST = "com.screenfry.host";
interface AppReply {
  /** "Reset all data" chosen in the app. */
  reset?: { id?: unknown };
  /**
   * "Erase Everything" in the app: wipe everything ScreenFry keeps in this browser (Safari
   * keeps an extension's storage after its app is deleted), and Chrome also removes the
   * extension. `uninstall` is the older, Chrome-only form of the same request.
   */
  erase?: boolean;
  /** A loadout sent from the Mac app's own loadouts: apply it as this browser's setup. */
  setup?: { id?: unknown; code?: unknown; name?: unknown };
  uninstall?: boolean;
}
type Outcome = { id: string; ok: boolean; error?: string; waiting?: boolean };

/** Extra keys kept beside the state; Restore defaults removes them too. */
const EXTRA_KEYS = ["safariSiteAccessNoticeDismissed", APP_SETUP_KEY];
async function resetEverything(
  auth: actions.ActionContext,
): Promise<actions.ActionResult<AppState>> {
  const r = await actions.resetAll(auth);
  if (r.ok) {
    await chrome.storage.local.remove(EXTRA_KEYS).catch(() => undefined);
    await settingsChanged();
    void refreshActiveSite(
      r.data,
      siteDefinitions.map((s) => s.site),
    );
  }
  return r;
}
let appSync: Promise<void> | undefined;
/** Set once the app has asked this browser's ScreenFry to erase itself. */
let erased = false;
function syncWithApp(): Promise<void> {
  appSync ??= exchangeWithApp().finally(() => {
    appSync = undefined;
  });
  return appSync;
}
async function sendToApp(
  outcome: { resetResult?: Outcome; setupResult?: Outcome } = {},
): Promise<AppReply | undefined> {
  const state = await chromeStateStore.get();
  // The live setup as a share code, so the app can keep it as one of its loadouts.
  const setupCode = await encodeShareCode(actions.currentLoadout(state, Date.now())).catch(() => "");
  return (await withTimeout(
    chrome.runtime.sendNativeMessage(APP_HOST, {
      type: "screenfry-sync",
      browser,
      version: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id,
      codeVersion: CODE_VERSION,
      passwordProtected: Boolean(state.settingsPassword),
      setupCode,
      ...outcome,
    }),
    5000,
  )) as AppReply | undefined;
}
const passwordMessage = (what: string) =>
  `ScreenFry’s settings password is on in ${browser === "safari" ? "Safari" : "Chrome"}. ${what}`;
async function exchangeWithApp() {
  if (erased || typeof chrome.runtime.sendNativeMessage !== "function") return;
  try {
    const reply = await sendToApp();
    if (reply?.erase === true || (reply?.uninstall === true && browser === "chrome")) {
      erased = true;
      await chrome.storage.local.clear().catch(() => undefined);
      await sessionArea()?.clear().catch(() => undefined);
      await chrome.declarativeNetRequest
        ?.getDynamicRules()
        .then((rules) =>
          chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: rules.map((r) => r.id),
          }),
        )
        .catch(() => undefined);
      // Chrome can also remove the extension itself; Safari drops it with the app.
      if (browser === "chrome")
        await chrome.management.uninstallSelf().catch(() => undefined);
      return;
    }
    const setup = reply?.setup;
    if (setup && typeof setup.id === "string" && typeof setup.code === "string") {
      const name = typeof setup.name === "string" ? setup.name : "a loadout";
      const state = await chromeStateStore.get();
      const r = await actions.setLoadoutFromCode(ctx, state.activeLoadout ?? 0, setup.code);
      if (r.ok) {
        await settingsChanged();
        await chrome.storage.local.remove(APP_SETUP_KEY).catch(() => undefined);
        await sendToApp({ setupResult: { id: setup.id, ok: true } });
      } else if (state.settingsPassword) {
        // The app can't give the password; ScreenFry here asks for it.
        await chrome.storage.local.set({
          [APP_SETUP_KEY]: { id: setup.id, code: setup.code, name, at: Date.now() },
        });
        await sendToApp({
          setupResult: {
            id: setup.id,
            ok: false,
            waiting: true,
            error: passwordMessage("Open ScreenFry there to apply it with the password."),
          },
        });
      } else await sendToApp({ setupResult: { id: setup.id, ok: false, error: r.error } });
      return;
    }
    const reset = reply?.reset;
    if (reset && typeof reset.id === "string") {
      const hadPassword = Boolean((await chromeStateStore.get()).settingsPassword);
      const r = await resetEverything(ctx);
      await sendToApp({
        resetResult: {
          id: reset.id,
          ok: r.ok,
          ...(r.ok
            ? {}
            : {
                error: hadPassword
                  ? passwordMessage(
                      "Reset it from ScreenFry’s Settings there (Restore defaults asks for the password).",
                    )
                  : r.error,
              }),
        },
      });
      return;
    }
  } catch {
    /* The Mac app (or its native host) isn't installed; nothing to sync. */
  }
}
/** Safari: asks the extension's native handler to open Safari Settings → Extensions → ScreenFry. */
async function openSafariSettings(): Promise<actions.ActionResult<null>> {
  if (browser !== "safari" || typeof chrome.runtime.sendNativeMessage !== "function")
    return { ok: false, error: "Only Safari can open its extension settings." };
  try {
    const reply = (await withTimeout(
      chrome.runtime.sendNativeMessage(APP_HOST, { type: "screenfry-open-settings" }),
      5000,
    )) as { ok?: boolean; error?: string } | undefined;
    return reply?.ok
      ? { ok: true, data: null }
      : { ok: false, error: reply?.error ?? "Safari didn’t open its settings." };
  } catch {
    return { ok: false, error: "Safari didn’t open its settings." };
  }
}
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
  await reloadIfUpdatedOnDisk();
  await syncWithApp();
}
void start();
console.info(`ScreenFry ready (${browser})`);
