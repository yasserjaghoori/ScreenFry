import type { AccessWindow, EarnGoal, FeedSettings, WebsiteRule } from "@shared/index";
export type Request = (
  | { type: "GET_STATE" }
  /** The version the running background was built as (0.7.7 on). */
  | { type: "GET_BUILD" }
  /** Earn goals counting right now: goal id → when their unsaved time started. */
  | { type: "EARN_LIVE" }
  | { type: "GET_POLICY"; url: string }
  | { type: "MEDIA_STATE"; playing: boolean }
  | { type: "SHOW_BLOCKED_PAGE"; label: string }
  | { type: "UNLOCK_SETTINGS" }
  | { type: "SET_SETTINGS_PASSWORD"; newPassword: string }
  | { type: "SAVE_RULE"; rule: WebsiteRule }
  | { type: "DELETE_RULE"; ruleId: string }
  | { type: "SAVE_WINDOW"; window: AccessWindow }
  | { type: "DELETE_WINDOW"; windowId: string }
  | { type: "SAVE_EARN_GOAL"; goal: EarnGoal }
  | { type: "DELETE_EARN_GOAL"; goalId: string }
  | { type: "IMPORT_SHARE_CODE"; code: string }
  | { type: "SWITCH_LOADOUT"; index: number }
  | { type: "SET_LOADOUT_FROM_CODE"; index: number; code: string }
  | { type: "COPY_TO_LOADOUT"; index: number }
  | { type: "CLEAR_LOADOUT"; index: number }
  | { type: "RENAME_LOADOUT"; index: number; name: string }
  | { type: "SET_FEEDS"; feedSettings: FeedSettings }
  | {
      type: "SET_PREFERENCES";
      warningsEnabled?: boolean;
    }
  | { type: "COMPLETE_ONBOARDING" }
  | { type: "PASSWORD_PROMPT_SEEN" }
  | { type: "REFRESH_PROTECTION" }
  | { type: "RESET_ALL" }
  | { type: "OPEN_SAFARI_SETTINGS" }
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
export type TabMessage =
  | { type: "SCREENFRY_APPLY_SETTINGS" }
  | { type: "SCREENFRY_TOAST"; text: string }
  | {
      type: "SCREENFRY_WARNING";
      label: string;
      minutesRemaining: number;
    };
