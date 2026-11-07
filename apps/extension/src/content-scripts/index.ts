import { buildBlockingCss } from '@feeds/index';
import type { AppState, PolicyDecision } from '@shared/index';

const STYLE_ID = 'screentime-feed-blocker';
let lastUrl = location.href;
const send = <T,>(request: unknown): Promise<{ ok: boolean; data?: T }> => chrome.runtime.sendMessage(request);

function applyFeedCss(state: AppState): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head ?? document.documentElement).append(style);
  }
  style.textContent = buildBlockingCss(state.feedSettings, location.hostname);
}

async function enforce(): Promise<void> {
  if (!/^https?:/.test(location.href)) return;
  const [stateResponse, policyResponse] = await Promise.all([
    send<AppState>({ type: 'GET_STATE' }),
    send<PolicyDecision>({ type: 'GET_POLICY', url: location.href })
  ]);
  if (stateResponse.ok && stateResponse.data) applyFeedCss(stateResponse.data);
  if (policyResponse.ok && policyResponse.data?.status === 'blocked') {
    const decision = policyResponse.data;
    const query = new URLSearchParams({
      url: location.href, ruleId: decision.ruleId ?? '', label: decision.ruleLabel ?? 'This website',
      reasons: decision.reasons.join(','), next: String(decision.nextAccessAt ?? '')
    });
    location.replace(chrome.runtime.getURL(`blocked.html?${query}`));
  }
}

void enforce();
const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) { lastUrl = location.href; void enforce(); }
});
observer.observe(document.documentElement, { subtree: true, childList: true });
chrome.storage.onChanged.addListener(() => { void enforce(); });
