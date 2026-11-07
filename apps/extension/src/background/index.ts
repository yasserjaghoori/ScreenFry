/**
 * Manifest V3 service worker. It is deliberately thin glue: all decisions live in
 * @core/actions, @core/tracking and @policy. The worker may be suspended at any moment,
 * so nothing important lives only in memory — the tracking session is kept in session storage
 * and every timer has a persistent alarm behind it.
 */
import * as actions from '@core/actions';
import type { ActionResult } from '@core/actions';
import { creditUsage, nextTrackingBoundary, pickTrackedTab, shouldCount, type IdleState, type TrackingSession } from '@core/tracking';
import { parseWebUrl } from '@core/domains';
import { CONTENT_SCRIPT_REQUESTS, type Request, type TabMessage } from '@browser/messages';
import { detectBrowser, hasIdleApi, queryPrivateAccess, sessionArea } from '@browser/platform';
import { chromeStateStore } from '@browser/storage';
import { evaluatePolicy, evaluateRule, nextPolicyBoundary } from '@policy/index';
import type { AppState, PolicyDecision } from '@shared/index';

const ctx: actions.ActionContext = { store: chromeStateStore, now: () => Date.now() };
const HEARTBEAT_ALARM = 'heartbeat';
const BOUNDARY_ALARM = 'policy-boundary';
const SESSION_KEY = 'trackingSession';
const IDLE_SECONDS = 60;
const DNR_ID_BASE = 10_000;
const extensionOrigin = chrome.runtime.getURL('');
const browser = detectBrowser();

// ─────────────────────────── Blocking ───────────────────────────

function blockedPageUrl(original: string, decision: PolicyDecision): string {
  const params = new URLSearchParams({ ruleId: decision.ruleId ?? '', label: decision.ruleLabel ?? 'This website' });
  params.set('url', original);
  return chrome.runtime.getURL(`blocked.html?${params}`);
}

async function enforceTab(tabId: number, url: string | undefined, state: AppState, now: number): Promise<void> {
  if (!url || !parseWebUrl(url)) return;
  const decision = evaluatePolicy(state, url, now);
  if (decision.status !== 'blocked') return;
  try { await chrome.tabs.update(tabId, { url: blockedPageUrl(url, decision) }); } catch { /* tab closed */ }
}

async function enforceAllTabs(state: AppState): Promise<void> {
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : enforceTab(tab.id, tab.url, state, now))));
  if (tabs.some((tab) => tab.incognito)) await noteObservedPrivateTab();
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let lastNetworkRules = '';

/**
 * Network-level blocking for main frames and embeds. Rules are regenerated from the policy
 * engine, so they disappear during an override and return when it ends. The original URL is
 * appended by regex substitution so the blocked page can return to it later.
 */
async function syncNetworkRules(state: AppState): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  const now = Date.now();
  const addRules: chrome.declarativeNetRequest.Rule[] = [];
  state.rules.forEach((rule, index) => {
    if (!rule.enabled || index >= 5_000) return;
    const decision = evaluateRule(state, rule, now);
    if (decision.status !== 'blocked') return;
    const domains = rule.domains.map(escapeRegex).join('|');
    const query = new URLSearchParams({ ruleId: rule.id, label: rule.label });
    addRules.push({
      id: DNR_ID_BASE + index,
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.REDIRECT, redirect: { regexSubstitution: `${chrome.runtime.getURL('blocked.html')}?${query}&url=\\1` } },
      condition: {
        regexFilter: `^(https?://([^/?#]+\\.)?(${domains})\\.?(:[0-9]+)?([/?#].*)?)$`,
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME, chrome.declarativeNetRequest.ResourceType.SUB_FRAME]
      }
    });
  });
  const signature = JSON.stringify(addRules);
  if (signature === lastNetworkRules) return;
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.filter((rule) => rule.id >= DNR_ID_BASE).map((rule) => rule.id);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
    lastNetworkRules = signature;
  } catch (error) {
    // Tab redirection and the content script still enforce if network rules are unavailable.
    console.warn('Screentime: network rules unavailable', error instanceof Error ? error.message : error);
  }
}

// ─────────────────────────── Tracking ───────────────────────────

let memorySession: TrackingSession | undefined;

async function loadSession(): Promise<TrackingSession | undefined> {
  const area = sessionArea();
  if (!area) return memorySession;
  try { return (await area.get(SESSION_KEY))[SESSION_KEY] as TrackingSession | undefined; } catch { return memorySession; }
}

async function saveSession(session: TrackingSession | undefined): Promise<void> {
  memorySession = session;
  const area = sessionArea();
  if (!area) return;
  try { await (session ? area.set({ [SESSION_KEY]: session }) : area.remove(SESSION_KEY)); } catch { /* memory fallback */ }
}

async function currentIdleState(): Promise<IdleState> {
  if (!hasIdleApi()) return 'active'; // Safari: no idle API. Documented in THREAT_MODEL.md.
  try { return await chrome.idle.queryState(IDLE_SECONDS) as IdleState; } catch { return 'active'; }
}

async function findTrackableTab(): Promise<chrome.tabs.Tab | undefined> {
  try {
    const window = await chrome.windows.getLastFocused({ populate: true });
    if (!window.focused || window.id === undefined) return undefined;
    const tab = pickTrackedTab(window.tabs ?? [], window.id);
    if (!tab) return undefined;
    const idleState = await currentIdleState();
    return shouldCount({ windowFocused: true, idleState, audible: tab.audible }) ? tab : undefined;
  } catch {
    return undefined;
  }
}

async function notifyWarnings(tabId: number, warnings: { label: string; minutesRemaining: number }[]): Promise<void> {
  for (const warning of warnings) {
    const message: TabMessage = { type: 'SCREENTIME_WARNING', label: warning.label, minutesRemaining: warning.minutesRemaining };
    try { await chrome.tabs.sendMessage(tabId, message); } catch { /* no content script on this page */ }
  }
}

/** Credits the running session up to now, then starts a new one if the user is still on a site. */
async function checkpointTracking(): Promise<AppState> {
  const now = Date.now();
  const session = await loadSession();
  let state: AppState;
  if (session) {
    let warnings: { label: string; minutesRemaining: number }[] = [];
    state = await chromeStateStore.update((current) => {
      const result = creditUsage(current, session.url, session.startedAt, now);
      warnings = result.warnings;
      return result.state;
    });
    if (warnings.length) await notifyWarnings(session.tabId, warnings);
  } else state = await chromeStateStore.get();

  const tab = await findTrackableTab();
  await saveSession(tab?.id !== undefined && tab.url ? { tabId: tab.id, windowId: tab.windowId, url: tab.url, startedAt: now } : undefined);
  if (tab?.incognito) await noteObservedPrivateTab();
  return state;
}

// ───────────────────────── Orchestration ─────────────────────────

let boundaryTimer: ReturnType<typeof setTimeout> | undefined;

async function scheduleNextBoundary(state: AppState): Promise<void> {
  const now = Date.now();
  const session = await loadSession();
  const candidates = [nextPolicyBoundary(state, now)];
  const trackingBoundary = session ? nextTrackingBoundary(state, session.url, now) : undefined;
  if (trackingBoundary) candidates.push(trackingBoundary);
  const when = Math.max(now + 1_000, Math.min(...candidates));
  await chrome.alarms.create(BOUNDARY_ALARM, { when });
  // Alarms may be rounded up to 30s+; while the worker is awake, a timer makes short waits precise.
  if (boundaryTimer) clearTimeout(boundaryTimer);
  if (when - now < 60_000) boundaryTimer = setTimeout(() => { void reevaluate(); }, when - now + 50);
}

let chain: Promise<unknown> = Promise.resolve();
/** Serializes full re-evaluations so events arriving together cannot interleave. */
function reevaluate(): Promise<void> {
  const run = chain.then(async () => {
    await checkpointTracking();
    const state = await actions.maintain(ctx);
    await syncNetworkRules(state);
    await enforceAllTabs(state);
    await scheduleNextBoundary(state);
  });
  chain = run.catch((error) => console.warn('Screentime: re-evaluation failed', error instanceof Error ? error.message : error));
  return chain as Promise<void>;
}

let observedPrivateThisSession = false;
async function noteObservedPrivateTab(): Promise<void> {
  if (observedPrivateThisSession) return;
  observedPrivateThisSession = true;
  await actions.recordProtection(ctx, { observedPrivateTab: true });
}

async function refreshProtection(): Promise<AppState> {
  const privateAccess = await queryPrivateAccess();
  const tabs = await chrome.tabs.query({});
  const observedPrivateTab = tabs.some((tab) => tab.incognito);
  return actions.recordProtection(ctx, { privateAccess, observedPrivateTab });
}

async function ensureAlarms(): Promise<void> {
  if (!(await chrome.alarms.get(HEARTBEAT_ALARM))) await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
}

// ──────────────────────────── Messages ───────────────────────────

const isExtensionSender = (sender: chrome.runtime.MessageSender) => Boolean(sender.url?.startsWith(extensionOrigin)) && sender.id === chrome.runtime.id;

async function handle(request: Request, sender: chrome.runtime.MessageSender): Promise<ActionResult<unknown>> {
  if (sender.id !== chrome.runtime.id) return { ok: false, error: 'Unknown sender.' };
  if (!isExtensionSender(sender) && !CONTENT_SCRIPT_REQUESTS.has(request.type)) return { ok: false, error: 'Not allowed from web pages.' };
  const now = Date.now();
  switch (request.type) {
    case 'GET_STATE': return { ok: true, data: await chromeStateStore.get() };
    case 'GET_POLICY': return { ok: true, data: evaluatePolicy(await chromeStateStore.get(), request.url, now) };
    case 'PIN_STATUS': return actions.pinStatus(ctx);
    case 'CREATE_PIN': return actions.createPin(ctx, request.pin);
    case 'CHANGE_PIN': return actions.changePin(ctx, request.currentPin, request.newPin);
    case 'VERIFY_AND_OVERRIDE': {
      const result = await actions.requestOverride(ctx, request.url, request.pin);
      // Remove network redirects before the page navigates back to the site.
      if (result.ok) { await syncNetworkRules(await chromeStateStore.get()); void reevaluate(); }
      return result;
    }
    case 'SAVE_RULE': { const result = await actions.saveRule(ctx, request.rule); await reevaluate(); return result; }
    case 'DELETE_RULE': { const result = await actions.deleteRule(ctx, request.ruleId); await reevaluate(); return result; }
    case 'CANCEL_PENDING': { const result = await actions.cancelPendingChange(ctx, request.ruleId); await reevaluate(); return result; }
    case 'SET_FEEDS': return actions.setFeeds(ctx, request.feedSettings);
    case 'SET_PREFERENCES': return actions.setPreferences(ctx, request);
    case 'COMPLETE_ONBOARDING': return actions.completeOnboarding(ctx);
    case 'REFRESH_PROTECTION': return { ok: true, data: await refreshProtection() };
    case 'DELETE_HISTORY': return actions.deleteHistory(ctx);
    case 'RESET_ALL': { const result = await actions.resetAll(ctx, request.pin); await reevaluate(); return result; }
    default: return { ok: false, error: 'Unsupported request.' };
  }
}

chrome.runtime.onMessage.addListener((request: Request, sender, respond) => {
  handle(request, sender)
    .then(respond)
    .catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : 'Unexpected error' }));
  return true;
});

// ───────────────────────────── Events ────────────────────────────

chrome.tabs.onActivated.addListener(() => { void reevaluate(); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url) void chromeStateStore.get().then((state) => enforceTab(tabId, change.url, state, Date.now()));
  if (change.url || change.audible !== undefined || change.status === 'complete') void reevaluate();
  if (tab.incognito) void noteObservedPrivateTab();
});
chrome.tabs.onRemoved.addListener(() => { void reevaluate(); });
chrome.windows.onFocusChanged.addListener(() => { void reevaluate(); });
if (hasIdleApi()) {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  chrome.idle.onStateChanged.addListener(() => { void reevaluate(); });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM || alarm.name === BOUNDARY_ALARM) void reevaluate();
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureAlarms();
  if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  await refreshProtection();
  await reevaluate();
});
chrome.runtime.onStartup.addListener(() => { void ensureAlarms().then(refreshProtection).then(reevaluate); });

// Every wake-up (including after suspension) re-applies restrictions from persisted state.
void ensureAlarms().then(reevaluate);
console.info(`Screentime background ready (${browser})`);
