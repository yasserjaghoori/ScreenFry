import type { FeedSettings, WebsiteRule } from '@shared/index';

export type Request =
  | { type: 'GET_STATE' }
  | { type: 'GET_POLICY'; url: string }
  | { type: 'PIN_STATUS' }
  | { type: 'CREATE_PIN'; pin: string }
  | { type: 'CHANGE_PIN'; currentPin: string; newPin: string }
  | { type: 'VERIFY_AND_OVERRIDE'; pin: string; url: string }
  | { type: 'SAVE_RULE'; rule: WebsiteRule }
  | { type: 'DELETE_RULE'; ruleId: string }
  | { type: 'CANCEL_PENDING'; ruleId: string }
  | { type: 'SET_FEEDS'; feedSettings: FeedSettings }
  | { type: 'SET_PREFERENCES'; trackingEnabled?: boolean; warningsEnabled?: boolean }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'REFRESH_PROTECTION' }
  | { type: 'DELETE_HISTORY' }
  | { type: 'RESET_ALL'; pin: string };

/** Requests a web page's content script may make. Everything else requires an extension page. */
export const CONTENT_SCRIPT_REQUESTS: ReadonlySet<Request['type']> = new Set(['GET_POLICY']);

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: string; cooldownUntil?: number; data?: undefined };

export async function send<T>(request: Request): Promise<Response<T>> {
  try {
    const response = await chrome.runtime.sendMessage(request) as Response<T> | undefined;
    return response ?? { ok: false, error: 'Screentime is starting. Try again in a moment.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Screentime is unavailable.' };
  }
}

/** Messages from the background to a tab's content script. */
export type TabMessage =
  | { type: 'SCREENTIME_WARNING'; label: string; minutesRemaining: number };
