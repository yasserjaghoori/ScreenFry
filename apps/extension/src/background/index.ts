import { applyMaturePendingChange, mutateRule } from '@core/commitments';
import { localDateKey } from '@core/date';
import { createPinVerifier, clearPinAttempts, recordFailedPin, verifyPin } from '@core/pin';
import { chromeStateStore } from '@browser/storage';
import type { Request, Response } from '@browser/messages';
import { evaluatePolicy } from '@policy/index';
import type { AppState, WebsiteRule } from '@shared/index';

const OVERRIDE_MS = 10 * 60_000;
const TRACKING_ALARM = 'tracking-heartbeat';
let active: { tabId: number; ruleId: string; startedAt: number } | undefined;
let idle = false;
let focused = true;

const blockedUrl = (original: string, decision: ReturnType<typeof evaluatePolicy>): string => {
  const params = new URLSearchParams({
    url: original,
    ruleId: decision.ruleId ?? '',
    label: decision.ruleLabel ?? 'This website',
    reasons: decision.reasons.join(','),
    next: String(decision.nextAccessAt ?? '')
  });
  return chrome.runtime.getURL(`blocked.html?${params}`);
};

function isExtensionPage(url?: string): boolean {
  return !url || url.startsWith(chrome.runtime.getURL('')) || !/^https?:/.test(url);
}

async function flushActive(now = Date.now()): Promise<void> {
  if (!active) return;
  const session = active;
  active = undefined;
  const elapsed = Math.max(0, Math.min(now - session.startedAt, 2 * 60_000));
  if (!elapsed) return;
  await chromeStateStore.update((state) => {
    const key = localDateKey(new Date(now));
    const day = state.usage[key] ?? { dateKey: key, millisecondsByRule: {} };
    day.millisecondsByRule[session.ruleId] = (day.millisecondsByRule[session.ruleId] ?? 0) + elapsed;
    state.usage[key] = day;
    return state;
  });
}

async function refreshTracking(): Promise<void> {
  await flushActive();
  if (idle || !focused) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || isExtensionPage(tab.url)) return;
  const state = await chromeStateStore.get();
  if (!state.trackingEnabled) return;
  const rule = state.rules.find((candidate) => candidate.enabled && candidate.domains.some((domain) => {
    try { const host = new URL(tab.url!).hostname; return host === domain || host.endsWith(`.${domain}`); } catch { return false; }
  }));
  if (rule) {
    const decision = evaluatePolicy(state, tab.url!, Date.now());
    // Override minutes are intentionally represented by override history, not daily usage.
    if (decision.status === 'allowed') active = { tabId: tab.id, ruleId: rule.id, startedAt: Date.now() };
  }
}

async function enforceTab(tabId: number, url?: string): Promise<void> {
  if (isExtensionPage(url)) return;
  const decision = evaluatePolicy(await chromeStateStore.get(), url!, Date.now());
  if (decision.status === 'blocked') await chrome.tabs.update(tabId, { url: blockedUrl(url!, decision) });
}

async function enforceAllTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((tab) => tab.id).map((tab) => enforceTab(tab.id!, tab.url)));
}

async function syncNetworkRules(state?: AppState): Promise<void> {
  const current = state ?? await chromeStateStore.get();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.filter((rule) => rule.id >= 10_000 && rule.id < 20_000).map((rule) => rule.id);
  const addRules: chrome.declarativeNetRequest.Rule[] = [];
  current.rules.forEach((rule, index) => {
    if (!rule.enabled || index >= 10_000) return;
    const decision = evaluatePolicy(current, `https://${rule.domains[0]}/`, Date.now());
    if (decision.status !== 'blocked') return;
    const escaped = rule.domains.map((domain) => domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const query = new URLSearchParams({
      ruleId: rule.id, label: rule.label, reasons: decision.reasons.join(','), next: String(decision.nextAccessAt ?? '')
    });
    const redirectPrefix = `${chrome.runtime.getURL('blocked.html')}?${query}&url=`;
    addRules.push({
      id: 10_000 + index,
      priority: 1,
      action: { type: chrome.declarativeNetRequest.RuleActionType.REDIRECT, redirect: { regexSubstitution: `${redirectPrefix}\\1` } },
      condition: {
        regexFilter: `^(https?://([^/]+\\.)?(${escaped})(:[0-9]+)?(/.*)?)$`,
        resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME, chrome.declarativeNetRequest.ResourceType.SUB_FRAME]
      }
    });
  });
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function maintainState(): Promise<void> {
  const now = Date.now();
  await chromeStateStore.update((state) => {
    state.rules = state.rules.map((rule) => applyMaturePendingChange(rule, now));
    for (const [ruleId, override] of Object.entries(state.overrides)) if (override.expiresAt <= now) delete state.overrides[ruleId];
    if (state.lastWallClockAt && now < state.lastWallClockAt - 5 * 60_000) state.possibleClockRollbackAt = now;
    state.lastWallClockAt = now;
    return state;
  });
}

async function handle(request: Request): Promise<Response> {
  const now = Date.now();
  if (request.type === 'GET_STATE') return { ok: true, data: await chromeStateStore.get() };
  if (request.type === 'GET_POLICY') return { ok: true, data: evaluatePolicy(await chromeStateStore.get(), request.url, now) };
  if (request.type === 'CREATE_PIN') {
    const verifier = await createPinVerifier(request.pin);
    const state = await chromeStateStore.update((current) => ({ ...current, pin: verifier, pinAttempts: clearPinAttempts() }));
    return { ok: true, data: state };
  }
  if (request.type === 'VERIFY_AND_OVERRIDE') {
    const state = await chromeStateStore.get();
    if (!state.pin) return { ok: false, error: 'PIN setup is incomplete.' };
    if (state.pinAttempts.cooldownUntil && state.pinAttempts.cooldownUntil > now) {
      return { ok: false, error: 'Too many attempts. Try again after the cooldown.', cooldownUntil: state.pinAttempts.cooldownUntil };
    }
    if (!await verifyPin(request.pin, state.pin)) {
      const attempts = recordFailedPin(state.pinAttempts, now);
      await chromeStateStore.update((current) => ({ ...current, pinAttempts: attempts }));
      return { ok: false, error: 'Incorrect PIN.', cooldownUntil: attempts.cooldownUntil };
    }
    const override = { ruleId: request.ruleId, startedAt: now, expiresAt: now + OVERRIDE_MS };
    await chromeStateStore.update((current) => {
      current.pinAttempts = clearPinAttempts();
      current.overrides[request.ruleId] = override;
      current.overrideHistory.unshift({ ...override, id: crypto.randomUUID() });
      current.overrideHistory = current.overrideHistory.slice(0, 200);
      return current;
    });
    await syncNetworkRules();
    return { ok: true, data: override };
  }
  if (request.type === 'SAVE_RULE') {
    let outcome = 'applied';
    const state = await chromeStateStore.update((current) => {
      const index = current.rules.findIndex((rule) => rule.id === request.rule.id);
      if (index < 0) current.rules.push(request.rule);
      else {
        const result = mutateRule(current.rules[index], request.rule, now);
        outcome = result.outcome;
        current.rules[index] = result.rule;
      }
      return current;
    });
    await syncNetworkRules(state);
    await enforceAllTabs();
    return { ok: true, data: { state, outcome } };
  }
  if (request.type === 'DELETE_RULE') {
    const state = await chromeStateStore.update((current) => {
      const rule = current.rules.find((candidate) => candidate.id === request.ruleId);
      if (!rule) return current;
      if (rule.commitmentEndsAt && rule.commitmentEndsAt > now) {
        const proposed: WebsiteRule = { ...rule, enabled: false };
        const result = mutateRule(rule, proposed, now);
        current.rules = current.rules.map((candidate) => candidate.id === rule.id ? result.rule : candidate);
      } else current.rules = current.rules.filter((candidate) => candidate.id !== request.ruleId);
      return current;
    });
    await syncNetworkRules(state);
    return { ok: true, data: state };
  }
  if (request.type === 'SET_FEEDS') {
    const state = await chromeStateStore.update((current) => ({ ...current, feedSettings: request.feedSettings }));
    return { ok: true, data: state };
  }
  if (request.type === 'COMPLETE_ONBOARDING') {
    const state = await chromeStateStore.update((current) => ({ ...current, onboardingComplete: Boolean(current.pin) }));
    return state.pin ? { ok: true, data: state } : { ok: false, error: 'Create a PIN first.' };
  }
  if (request.type === 'REFRESH_PROTECTION') {
    const allowed = await chrome.extension.isAllowedIncognitoAccess();
    const state = await chromeStateStore.update((current) => ({
      ...current, protection: { browser: 'chrome', privateAccess: allowed ? 'verified' : 'unverified', lastCheckedAt: now }
    }));
    return { ok: true, data: state };
  }
  return { ok: false, error: 'Unsupported request.' };
}

chrome.runtime.onMessage.addListener((request: Request, _sender, respond) => {
  handle(request).then(respond).catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : 'Unexpected error' }));
  return true;
});

chrome.tabs.onActivated.addListener(() => { void refreshTracking(); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === 'complete') void enforceTab(tabId, change.url ?? tab.url);
  if (change.url || change.status === 'complete') void refreshTracking();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  focused = windowId !== chrome.windows.WINDOW_ID_NONE;
  void refreshTracking();
});
chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener((state) => { idle = state !== 'active'; void refreshTracking(); });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TRACKING_ALARM) void (async () => { await flushActive(); await maintainState(); await syncNetworkRules(); await enforceAllTabs(); await refreshTracking(); })();
});
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: 1 });
  if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  await maintainState();
  await syncNetworkRules();
});
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create(TRACKING_ALARM, { periodInMinutes: 1 }); void maintainState().then(() => syncNetworkRules()).then(enforceAllTabs).then(refreshTracking); });
void maintainState().then(() => syncNetworkRules()).then(refreshTracking);
