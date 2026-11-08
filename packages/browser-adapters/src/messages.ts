import type { AccessWindow, FeedSettings, WebsiteRule } from "@shared/index";
export type Request = (
  | { type: "GET_STATE" }
  | { type: "GET_POLICY"; url: string }
  | { type: "MEDIA_STATE"; playing: boolean }
  | { type: "SHOW_BLOCKED_PAGE"; label: string }
  | { type: "UNLOCK_SETTINGS" }
  | { type: "SET_SETTINGS_PASSWORD"; newPassword: string }
  | { type: "SAVE_RULE"; rule: WebsiteRule }
  | { type: "DELETE_RULE"; ruleId: string }
  | { type: "SAVE_WINDOW"; window: AccessWindow }
  | { type: "DELETE_WINDOW"; windowId: string }
  | { type: "SET_FEEDS"; feedSettings: FeedSettings }
  | {
      type: "SET_PREFERENCES";
      warningsEnabled?: boolean;
    }
  | { type: "COMPLETE_ONBOARDING" }
  | { type: "REFRESH_PROTECTION" }
  | { type: "RESET_ALL" }
) & { password?: string };
export const CONTENT_SCRIPT_REQUESTS: ReadonlySet<Request["type"]> = new Set([
  "GET_POLICY",
  "MEDIA_STATE",
  "SHOW_BLOCKED_PAGE",
]);
export type Response<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; cooldownUntil?: number; data?: undefined };
// Kept in this extension page's memory only; closing/reloading it locks settings again.
let settingsCredential: string | undefined;
export const setSettingsCredential = (password?: string) => {
  settingsCredential = password;
};
export async function send<T>(request: Request): Promise<Response<T>> {
  try {
    return (
      ((await chrome.runtime.sendMessage({
        ...request,
        password: request.password ?? settingsCredential,
      })) as Response<T>) ?? {
        ok: false,
        error: "ScreenFry is starting. Try again.",
      }
    );
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "ScreenFry is unavailable.",
    };
  }
}
export type TabMessage = {
  type: "SCREENTIME_WARNING";
  label: string;
  minutesRemaining: number;
};
