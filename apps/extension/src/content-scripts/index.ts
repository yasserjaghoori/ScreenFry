/**
 * Runs at document_start in every frame. Built as a single classic script (no ES imports),
 * because manifest content scripts cannot be modules.
 *
 * Reads only the page URL and, on X, which home tab is selected. It never reads page text,
 * form fields or messages.
 */
import { migrateState } from '@core/defaults';
import { buildBlockingCss, feedRedirect, siteFor } from '@feeds/index';
import type { TabMessage } from '@browser/messages';
import { STATE_KEY } from '@browser/storage';
import { evaluatePolicy } from '@policy/index';
import type { AppState, PolicyDecision } from '@shared/index';

const STYLE_ID = 'screentime-feed-blocker';
const isTop = window === window.top;
let state: AppState | undefined;
let lastHref = '';
let redirecting = false;

function blockedPageUrl(decision: PolicyDecision): string {
  const params = new URLSearchParams({ ruleId: decision.ruleId ?? '', label: decision.ruleLabel ?? 'This website' });
  params.set('url', location.href);
  return chrome.runtime.getURL(`blocked.html?${params}`);
}

function applyFeedCss(css: string): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) { style?.remove(); return; }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
  }
  if (style.textContent !== css) style.textContent = css;
  // Keep our sheet last so it wins, and re-attach if a SPA replaced <head>.
  const parent = document.head ?? document.documentElement;
  if (style.parentNode !== parent || style !== parent.lastElementChild) parent.append(style);
}

/** X shows For You and Following in one timeline; record the selected tab index for the CSS. */
function markXTab(): void {
  if (siteFor(location.hostname)?.site !== 'x') return;
  const tabs = [...document.querySelectorAll('[data-testid="primaryColumn"] [role="tablist"] [role="tab"]')];
  const index = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  const value = index >= 0 ? String(index) : '';
  if (document.documentElement.dataset.screentimeXTab !== value) document.documentElement.dataset.screentimeXTab = value;
}

function evaluate(): void {
  if (!state || redirecting || !/^https?:/.test(location.href)) return;
  const decision = evaluatePolicy(state, location.href, Date.now());
  if (decision.status === 'blocked') {
    redirecting = true;
    location.replace(blockedPageUrl(decision));
    return;
  }
  if (isTop) {
    const rewrite = feedRedirect(state.feedSettings, location.href);
    if (rewrite) { redirecting = true; location.replace(rewrite); return; }
    overlay.update(decision);
  }
  markXTab();
  applyFeedCss(buildBlockingCss(state.feedSettings, location.href));
}

async function load(): Promise<void> {
  try {
    state = migrateState((await chrome.storage.local.get(STATE_KEY))[STATE_KEY]);
    evaluate();
  } catch { /* extension reloaded; the page keeps working */ }
}

// ───────────────────── Overlay (top frame only) ─────────────────────

const overlay = (() => {
  let host: HTMLElement | undefined;
  let pill: HTMLElement | undefined;
  let toast: HTMLElement | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function ensure(): ShadowRoot | undefined {
    if (!document.body) return undefined;
    if (!host) {
      host = document.createElement('screentime-overlay');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        :host{all:initial}
        .wrap{position:fixed;right:18px;bottom:18px;z-index:2147483647;display:grid;gap:8px;justify-items:end;font:500 13px/1.3 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif}
        .chip{display:none;align-items:center;gap:8px;padding:9px 13px;border-radius:999px;background:rgba(24,34,30,.88);color:#fff;backdrop-filter:blur(12px);box-shadow:0 8px 28px rgba(0,0,0,.22);font-variant-numeric:tabular-nums}
        .chip.show{display:inline-flex}
        .dot{width:7px;height:7px;border-radius:50%;background:#7fd1a8}
        .toast .dot{background:#f3b26b}
      </style><div class="wrap"><div class="chip toast"><span class="dot"></span><span class="text"></span></div><div class="chip pill"><span class="dot"></span><span class="text"></span></div></div>`;
      pill = root.querySelector('.pill') as HTMLElement;
      toast = root.querySelector('.toast') as HTMLElement;
    }
    if (!host.isConnected) document.documentElement.append(host);
    return host.shadowRoot ?? undefined;
  }
  return {
    update(decision: PolicyDecision) {
      if (decision.status !== 'temporarily-unlocked' || !decision.overrideExpiresAt) { pill?.classList.remove('show'); return; }
      ensure();
      if (!pill) return;
      const seconds = Math.max(0, Math.ceil((decision.overrideExpiresAt - Date.now()) / 1000));
      pill.querySelector('.text')!.textContent = `Temporary visit · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left`;
      pill.classList.add('show');
    },
    toast(text: string) {
      ensure();
      if (!toast) return;
      toast.querySelector('.text')!.textContent = text;
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast?.classList.remove('show'), 8_000);
    }
  };
})();

// ─────────────────────────── Wiring ───────────────────────────

void load();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STATE_KEY]) return;
  state = migrateState(changes[STATE_KEY].newValue);
  evaluate();
});
// SPA navigation and override expiry: a cheap check of the URL and clock.
setInterval(() => {
  if (location.href !== lastHref) { lastHref = location.href; evaluate(); return; }
  if (isTop || siteFor(location.hostname)?.site === 'x') evaluate();
}, isTop ? 1_000 : 5_000);
document.addEventListener('DOMContentLoaded', evaluate, { once: true });
if (isTop) {
  chrome.runtime.onMessage.addListener((message: TabMessage) => {
    if (message?.type === 'SCREENTIME_WARNING') {
      overlay.toast(`${message.minutesRemaining} minute${message.minutesRemaining === 1 ? '' : 's'} left on ${message.label} today`);
    }
  });
}
