import * as actions from "@core/actions";
import { withTimeout } from "@browser/scheduling";
import { siteFor } from "@feeds/index";
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
  effectiveFeedSettings,
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
      // Safari renders a local isolated notice; cross-scheme tab updates can hang.
      if (browser === "safari") {
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
      /* closed tab */
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
/** Websites with a rule or a free-time window; nothing is recorded about other browsing. */
const trackedUrl = (state: AppState, url: string) =>
  matchingRules(state, url).length > 0 || freeWindowsFor(state, url).length > 0;
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
  return pickTrackedTabs(
    enriched.filter((t) => trackedUrl(state, t.url ?? "")),
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
        tabs.some((t) => trackedUrl(r.state, t.url ?? ""))
      )
        r.state.usageAsOf = now;
      return r.state;
    });
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
  void syncWithApp();
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
      if (previous?.playing !== request.playing) void reevaluate(true);
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
  if (alarm.name === HEARTBEAT) {
    void reloadIfUpdatedOnDisk();
    void syncWithApp();
  }
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
/**
 * Chrome loads ScreenFry from a folder the Mac app keeps current (an unpacked install).
 * After an app update the files on disk are newer than the code running, so reload to pick
 * them up: when the version changes, or when build.json's fingerprint differs from the one
 * this run started with (a rebuild without a version bump). Session storage clears on
 * reload, so each run records its own starting build. Store installs update themselves.
 */
const BUILD_KEY = "screenfry.startedBuild";
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
 * Settings export/import from the ScreenFry Mac app. The app can't read browser storage, so
 * this side sends its website settings (never usage or the password) to the app's native
 * host and picks up an import the user chose there. Safari routes this to the extension's
 * own native handler; Chrome to the host the app registers. Without the app it's a no-op.
 */
const APP_HOST = "com.screenfry.host";
interface AppReply {
  import?: { id?: unknown; settings?: unknown };
  /** "Reset all data" chosen in the app. */
  reset?: { id?: unknown };
  /**
   * "Erase Everything" in the app: wipe everything ScreenFry keeps in this browser (Safari
   * keeps an extension's storage after its app is deleted), and Chrome also removes the
   * extension. `uninstall` is the older, Chrome-only form of the same request.
   */
  erase?: boolean;
  uninstall?: boolean;
}
type Outcome = { id: string; ok: boolean; error?: string };
/** Extra keys kept beside the state; Restore defaults removes them too. */
const EXTRA_KEYS = ["safariSiteAccessNoticeDismissed"];
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
  outcome: { importResult?: Outcome; resetResult?: Outcome } = {},
): Promise<AppReply | undefined> {
  const state = await chromeStateStore.get();
  return (await withTimeout(
    chrome.runtime.sendNativeMessage(APP_HOST, {
      type: "screenfry-sync",
      browser,
      version: chrome.runtime.getManifest().version,
      passwordProtected: Boolean(state.settingsPassword),
      settings: actions.exportSettings(state, Date.now()),
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
    const pending = reply?.import;
    if (!pending || typeof pending.id !== "string") return;
    const hadPassword = Boolean((await chromeStateStore.get()).settingsPassword);
    const r = await actions.importSettings(ctx, pending.settings);
    if (r.ok) {
      void reevaluate(true);
      await withTimeout(requestNetworkSync()).catch(() => undefined);
      void refreshActiveSite(
        r.data,
        siteDefinitions.map((s) => s.site),
      );
    }
    await sendToApp({
      importResult: {
        id: pending.id,
        ok: r.ok,
        ...(r.ok
          ? {}
          : {
              error: hadPassword
                ? passwordMessage(
                    "Turn it off in ScreenFry’s Settings, import again, then turn it back on.",
                  )
                : r.error,
            }),
      },
    });
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
