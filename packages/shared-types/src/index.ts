export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type EnforcementMode = 'pin';
export type RestrictionKind = 'daily-limit' | 'schedule';

export interface DailyAllowance {
  defaultMinutes: number;
  byWeekday?: Partial<Record<DayOfWeek, number>>;
}

export interface WeeklySchedule {
  id: string;
  days: DayOfWeek[];
  startMinute: number;
  endMinute: number;
}

export interface PendingRuleChange {
  requestedAt: number;
  applyAt: number;
  patch: Partial<Pick<WebsiteRule, 'enabled' | 'dailyAllowance' | 'schedules'>>;
}

export interface WebsiteRule {
  id: string;
  label: string;
  domains: string[];
  enabled: boolean;
  dailyAllowance?: DailyAllowance;
  schedules: WeeklySchedule[];
  commitmentEndsAt?: number;
  enforcementMode: EnforcementMode;
  pendingChange?: PendingRuleChange;
  createdAt: number;
  updatedAt: number;
}

export interface UsageDay {
  dateKey: string;
  millisecondsByRule: Record<string, number>;
}

export interface TemporaryOverride {
  ruleId: string;
  startedAt: number;
  expiresAt: number;
}

export interface OverrideHistoryEntry extends TemporaryOverride {
  id: string;
}

export interface PinVerifier {
  algorithm: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  verifier: string;
}

export interface PinAttemptState {
  failedAttempts: number;
  cooldownUntil?: number;
}

export type FeedSite = 'youtube' | 'x' | 'instagram' | 'reddit' | 'facebook' | 'linkedin';
export interface FeedSettings {
  globalEnabled: boolean;
  sites: Record<FeedSite, Record<string, boolean>>;
}

export interface ProtectionStatus {
  privateAccess: 'verified' | 'unverified' | 'unavailable';
  browser: 'chrome' | 'safari';
  lastCheckedAt?: number;
}

export interface AppState {
  schemaVersion: 1;
  onboardingComplete: boolean;
  pin?: PinVerifier;
  pinAttempts: PinAttemptState;
  rules: WebsiteRule[];
  usage: Record<string, UsageDay>;
  overrides: Record<string, TemporaryOverride>;
  overrideHistory: OverrideHistoryEntry[];
  feedSettings: FeedSettings;
  protection: ProtectionStatus;
  trackingEnabled: boolean;
  warningsEnabled: boolean;
  lastWallClockAt?: number;
  possibleClockRollbackAt?: number;
}

export type PolicyReason = 'daily-limit' | 'schedule';
export interface PolicyDecision {
  status: 'allowed' | 'blocked' | 'temporarily-unlocked';
  ruleId?: string;
  ruleLabel?: string;
  reasons: PolicyReason[];
  nextAccessAt?: number;
  overrideExpiresAt?: number;
  remainingMilliseconds?: number;
}
