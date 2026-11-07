import type { AppState, FeedSettings, PolicyDecision, WebsiteRule } from '@shared/index';

export type Request =
  | { type: 'GET_STATE' }
  | { type: 'GET_POLICY'; url: string }
  | { type: 'CREATE_PIN'; pin: string }
  | { type: 'VERIFY_AND_OVERRIDE'; pin: string; ruleId: string }
  | { type: 'SAVE_RULE'; rule: WebsiteRule }
  | { type: 'DELETE_RULE'; ruleId: string }
  | { type: 'SET_FEEDS'; feedSettings: FeedSettings }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'REFRESH_PROTECTION' };

export interface Response<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  cooldownUntil?: number;
}

export const send = <T = AppState | PolicyDecision>(request: Request): Promise<Response<T>> =>
  chrome.runtime.sendMessage(request);
