export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const ALL_DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];
export type BrowserKind = "chrome" | "safari";
export type FeedSite =
  | "youtube"
  | "instagram"
  | "x"
  | "reddit"
  | "substack"
  | "tiktok"
  | "facebook"
  | "linkedin";
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
   * A block window overlapping an allow or Fry Time window on a website pauses both.
   * "free": Fry Time — each listed website's feed blocking is paused while the window is
   * on, until that website's own minutes (per day) run out; then that website is back to
   * its normal settings for the rest of the window. It never blocks or unblocks a website.
   */
  mode?: "allow" | "block" | "free";
  /** Fry Time minutes per day for each website; undefined means the whole window. */
  freeMinutes?: number;
  /**
   * Custom Fry Time minutes per website, keyed by site id (e.g. "youtube") or, for other
   * websites, their domain. A listed website without an entry gets the whole window.
   */
  freeMinutesBySite?: Record<string, number>;
}
/**
 * Earn your website time (experimental): each day, the locked websites stay blocked until
 * the goal minutes have been spent on the goal website. Time on the goal website counts the
 * same way allowances do (focused tab or actual playback, once per website).
 */
export interface EarnGoal {
  id: string;
  label: string;
  enabled: boolean;
  /** The website where time earns access (with its aliases). */
  goalDomains: string[];
  /** Minutes on the goal website needed each day, 1–1440. */
  minutes: number;
  /**
   * The goal's websites. With the "unlock" reward they're blocked each day until the goal is
   * met; with "fry" they get Fry Time each time it's met.
   */
  lockedDomains: string[];
  /** What meeting the goal does: "unlock" (default) or "fry" (earn Fry Time). */
  reward?: "unlock" | "fry";
  /** Fry Time reward: how many times a day the goal pays out; 0 means no limit (default 1). */
  repeats?: number;
  /** Fry Time reward: minutes earned on each website per completion. */
  fryMinutes?: number;
  /** Fry Time reward: minutes per website (site id like "youtube", else domain) instead. */
  fryMinutesBySite?: Record<string, number>;
}
/** One loadout: the same website settings a share code holds. */
export interface LoadoutSettings {
  savedAt: number;
  rules: WebsiteRule[];
  windows: AccessWindow[];
  earnGoals?: EarnGoal[];
  feedSettings: FeedSettings;
  warningsEnabled: boolean;
}
export const LOADOUT_COUNT = 5;
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
  /** Time spent on each earn goal's website, capped at the goal. */
  millisecondsByGoal?: Record<string, number>;
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
  /** Earn your website time goals (experimental). */
  earnGoals?: EarnGoal[];
  /**
   * Loadouts: up to five saved setups. The one in use (`activeLoadout`, 0–4) is always the
   * live settings above, so its slot stays null; the others hold a saved copy, or null when
   * empty. Switching saves the live settings into their slot and applies the other one.
   */
  loadouts?: (LoadoutSettings | null)[];
  activeLoadout?: number;
  usage: Record<string, UsageDay>;
  usageAsOf?: number;
  feedSettings: FeedSettings;
  protection: ProtectionStatus;
  warningsEnabled: boolean;
  /** Set once the first-change prompt suggesting a settings password has been shown. */
  passwordPromptSeen?: boolean;
  migrationNotice?: string;
}
export type PolicyReason =
  | "daily-limit"
  | "outside-window"
  | "block-window"
  | "site-blocked"
  | "short-form"
  | "earn-locked";
export interface PolicyDecision {
  status: "allowed" | "blocked";
  ruleId?: string;
  ruleLabel?: string;
  reasons: PolicyReason[];
  nextAccessAt?: number;
  remainingMilliseconds?: number;
  allowanceMinutes?: number;
  /** Set while a free-time window has paused this website's feed blocking. */
  freeTime?: {
    windowId: string;
    label: string;
    remainingMilliseconds?: number;
    /** Fry Time earned by meeting an earn goal (windowId is "earn:<goal id>"). */
    earned?: boolean;
  };
  /**
   * Set when this website has free-time windows but none is pausing its feed blocking now:
   * "used-up" while a window is on but today's minutes are spent, "not-started" outside them.
   */
  freeTimeOff?: { state: "used-up" | "not-started"; label: string; nextAt?: number };
  /** Set while an earn goal keeps this website locked: time still needed on its goal website. */
  earn?: {
    goalId: string;
    label: string;
    goalDomain: string;
    minutes: number;
    remainingMilliseconds: number;
  };
}
