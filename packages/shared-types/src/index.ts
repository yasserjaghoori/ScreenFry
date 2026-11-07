export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
export type BrowserKind = "chrome" | "safari";
export type FeedSite = "youtube" | "instagram" | "x" | "reddit" | "substack";
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
  millisecondsByRule: Record<string, number>;
  millisecondsByHost: Record<string, number>;
  warningsSent: Record<string, number[]>;
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
  trackingEnabled: boolean;
  warningsEnabled: boolean;
  migrationNotice?: string;
}
export type PolicyReason =
  | "daily-limit"
  | "outside-window"
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
}
