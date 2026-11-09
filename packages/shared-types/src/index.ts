export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
export type BrowserKind = "chrome" | "safari";
export type FeedSite =
  | "youtube"
  | "instagram"
  | "x"
  | "reddit"
  | "substack"
  | "tiktok";
export interface DailyAllowance {
  defaultMinutes: number;
  byWeekday?: Partial<Record<DayOfWeek, number>>;
}
export interface WeeklySchedule {
  id: string;
  days: DayOfWeek[];
  /** Local minutes. Equal endpoints mean all day; start > end crosses midnight. End may be 1440. */
  startMinute: number;
  endMinute: number;
}
export interface AccessWindow extends WeeklySchedule {
  label: string;
  enabled: boolean;
  domains: string[];
  /**
   * "allow" (default): the listed websites are usable only inside this window (or another
   * allow window). "block": the listed websites are blocked while this window is active.
   * When both apply, blocking wins. "free": free time — the listed websites' feed blocking
   * is paused while the window is on, until `freeMinutes` of use (per day) run out; then
   * feed blocking returns. It never blocks or unblocks a website.
   */
  mode?: "allow" | "block" | "free";
  /** Free-time budget in minutes per day; undefined means the whole window. */
  freeMinutes?: number;
}
export interface WebsiteRule {
  id: string;
  label: string;
  domains: string[];
  enabled: boolean;
  blocked: boolean;
  dailyAllowance?: DailyAllowance;
  showTimer: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface UsageDay {
  dateKey: string;
  /** Time counted toward each website rule. ScreenFry records nothing about other websites. */
  millisecondsByRule: Record<string, number>;
  warningsSent: Record<string, number[]>;
  /** Free time used per free-time window. */
  millisecondsByWindow: Record<string, number>;
}
export interface PasswordVerifier {
  algorithm: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  verifier: string;
}
export interface PasswordAttempts {
  failedAttempts: number;
  cooldownUntil?: number;
}
export interface FeedSettings {
  globalEnabled: boolean;
  sites: Record<FeedSite, Record<string, boolean>>;
}
export type PrivateAccessStatus = "verified" | "observed" | "unverified";
export interface ProtectionStatus {
  browser: BrowserKind;
  privateAccess: PrivateAccessStatus;
  lastCheckedAt?: number;
  lastObservedAt?: number;
}
export interface AppState {
  schemaVersion: 3;
  onboardingComplete: boolean;
  settingsPassword?: PasswordVerifier;
  passwordAttempts: PasswordAttempts;
  rules: WebsiteRule[];
  windows: AccessWindow[];
  usage: Record<string, UsageDay>;
  usageAsOf?: number;
  feedSettings: FeedSettings;
  protection: ProtectionStatus;
  warningsEnabled: boolean;
  migrationNotice?: string;
}
export type PolicyReason =
  | "daily-limit"
  | "outside-window"
  | "block-window"
  | "site-blocked"
  | "short-form";
export interface PolicyDecision {
  status: "allowed" | "blocked";
  ruleId?: string;
  ruleLabel?: string;
  reasons: PolicyReason[];
  nextAccessAt?: number;
  remainingMilliseconds?: number;
  allowanceMinutes?: number;
  /** Set while a free-time window has paused this website's feed blocking. */
  freeTime?: { windowId: string; label: string; remainingMilliseconds?: number };
  /**
   * Set when this website has free-time windows but none is pausing its feed blocking now:
   * "used-up" while a window is on but today's minutes are spent, "not-started" outside them.
   */
  freeTimeOff?: { state: "used-up" | "not-started"; label: string; nextAt?: number };
}
