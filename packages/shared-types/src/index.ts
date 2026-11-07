export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * `pin`: a correct PIN grants a 10-minute temporary visit (Phase 1).
 * `strict`: reserved for a future phase — the policy engine already refuses overrides
 * for committed strict rules, but no UI offers it and the background normalizes it to `pin`.
 */
export type EnforcementMode = 'pin' | 'strict';
export type BrowserKind = 'chrome' | 'safari';

export interface DailyAllowance {
  defaultMinutes: number;
  byWeekday?: Partial<Record<DayOfWeek, number>>;
}

export interface WeeklySchedule {
  id: string;
  days: DayOfWeek[];
  /** Minutes after local midnight. start === end means the whole day. start > end crosses midnight. */
  startMinute: number;
  endMinute: number;
}

export type RulePatch = Partial<Pick<WebsiteRule, 'label' | 'domains' | 'enabled' | 'dailyAllowance' | 'schedules'>> & {
  /** Queued removal of the whole rule. */
  remove?: true;
};

export interface PendingRuleChange {
  requestedAt: number;
  applyAt: number;
  patch: RulePatch;
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
  /** Ordinary (non-override) time on sites covered by each rule. Drives daily limits. */
  millisecondsByRule: Record<string, number>;
  /** Time spent inside PIN override sessions, tracked separately and never counted against limits. */
  overrideMillisecondsByRule: Record<string, number>;
  /** Registrable-ish host → focused time. Only recorded when general history tracking is on. */
  millisecondsByHost: Record<string, number>;
  /** Warning thresholds (minutes remaining) already shown per rule today. */
  warningsSent: Record<string, number[]>;
}

export interface TemporaryOverride {
  ruleId: string;
  startedAt: number;
  expiresAt: number;
}

export interface OverrideHistoryEntry extends TemporaryOverride {
  id: string;
  label: string;
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

/**
 * - `verified`: Chrome's `extension.isAllowedIncognitoAccess()` returned true at `lastCheckedAt`.
 * - `observed`: the extension saw a private tab with its own APIs at `lastObservedAt` (positive
 *   proof of coverage at that moment; used for Safari, which has no permission-query API).
 * - `unverified`: coverage has not been confirmed. Never presented as active.
 */
export type PrivateAccessStatus = 'verified' | 'observed' | 'unverified';

export interface ProtectionStatus {
  browser: BrowserKind;
  privateAccess: PrivateAccessStatus;
  lastCheckedAt?: number;
  lastObservedAt?: number;
}

export interface AppState {
  schemaVersion: 2;
  onboardingComplete: boolean;
  pin?: PinVerifier;
  pinAttempts: PinAttemptState;
  rules: WebsiteRule[];
  usage: Record<string, UsageDay>;
  overrides: Record<string, TemporaryOverride>;
  overrideHistory: OverrideHistoryEntry[];
  feedSettings: FeedSettings;
  protection: ProtectionStatus;
  /** General per-site history for unrestricted sites. Limit tracking is always on. */
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
  /** Earliest instant at which every applicable restriction has ended. Undefined if none within 8 days. */
  nextAccessAt?: number;
  overrideExpiresAt?: number;
  remainingMilliseconds?: number;
  allowanceMinutes?: number;
  canOverride?: boolean;
}
