import { beforeEach, describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { creditSessions, creditUsage, nextTrackingBoundary } from "@core/tracking";
import { evaluatePolicy } from "@policy/index";
import { blockedCopy } from "../apps/extension/src/ui/blocked-copy";
import { Clock, MIN, at, rule, stateWith } from "./helpers";
import type { AppState, EarnGoal } from "@shared/index";

const goal = (patch: Partial<EarnGoal> = {}): EarnGoal => ({
  id: "duo",
  label: "Spanish first",
  enabled: true,
  goalDomains: ["duolingo.com"],
  minutes: 20,
  lockedDomains: ["youtube.com", "youtu.be", "youtube-nocookie.com", "news.example.org"],
  ...patch,
});
const NOW = at(2026, 10, 9, 10);
const YT = "https://www.youtube.com/watch?v=abc";
const DUO = "https://www.duolingo.com/learn";
/** Credits a stretch of time a minute at a time, as the background heartbeat does. */
function spend(state: AppState, url: string, from: number, to: number) {
  for (let t = from; t < to; t += MIN) creditUsage(state, url, t, Math.min(to, t + MIN));
}
const withGoal = (patch: Partial<EarnGoal> = {}, rules = [rule({ dailyAllowance: undefined })]) =>
  stateWith(rules, { earnGoals: [goal(patch)] });

describe("earn your website time", () => {
  it("locks websites until the goal minutes are spent, then opens them", () => {
    const state = withGoal();
    const locked = evaluatePolicy(state, YT, NOW);
    expect(locked.status).toBe("blocked");
    expect(locked.reasons).toEqual(["earn-locked"]);
    expect(locked.earn).toMatchObject({ goalDomain: "duolingo.com", minutes: 20, remainingMilliseconds: 20 * MIN });
    expect(locked.nextAccessAt).toBeUndefined();
    // A locked website without its own rule is named by its domain.
    expect(evaluatePolicy(state, "https://news.example.org/today", NOW)).toMatchObject({
      status: "blocked",
      ruleLabel: "news.example.org",
    });
    // The goal website itself and unrelated websites stay open.
    expect(evaluatePolicy(state, DUO, NOW).status).toBe("allowed");
    expect(evaluatePolicy(state, "https://example.com/", NOW).status).toBe("allowed");

    spend(state, DUO, NOW, NOW + 12 * MIN);
    expect(evaluatePolicy(state, YT, NOW + 12 * MIN).earn?.remainingMilliseconds).toBe(8 * MIN);
    spend(state, DUO, NOW + 12 * MIN, NOW + 25 * MIN);
    // Counting stops at the goal.
    expect(state.usage["2026-11-09"].millisecondsByGoal?.duo).toBe(20 * MIN);
    expect(evaluatePolicy(state, YT, NOW + 25 * MIN).status).toBe("allowed");
    // A new day starts locked again.
    expect(evaluatePolicy(state, YT, at(2026, 10, 10, 9)).reasons).toEqual(["earn-locked"]);
  });

  it("counts goal time once across tabs and never on other websites", () => {
    const state = withGoal();
    spend(state, "https://example.com/", NOW, NOW + 30 * MIN);
    // Two tabs on the goal website at once still earn one minute per minute.
    for (let t = NOW; t < NOW + 5 * MIN; t += MIN)
      creditSessions(
        state,
        [
          { tabId: 1, windowId: 1, url: DUO, startedAt: t },
          { tabId: 2, windowId: 1, url: "https://duolingo.com/practice", startedAt: t },
        ],
        t + MIN,
      );
    expect(state.usage["2026-11-09"].millisecondsByGoal?.duo).toBe(5 * MIN);
  });

  it("re-evaluates the moment the goal is met", () => {
    const state = withGoal();
    expect(nextTrackingBoundary(state, DUO, NOW)).toBe(NOW + 20 * MIN);
  });

  it("disabled goals don't lock anything", () => {
    expect(evaluatePolicy(withGoal({ enabled: false }), YT, NOW).status).toBe("allowed");
  });

  it("keeps other reasons and explains the goal on the block screen", () => {
    const state = withGoal({}, [rule({ dailyAllowance: { defaultMinutes: 30 } })]);
    const d = evaluatePolicy(state, YT, NOW);
    const copy = blockedCopy(d, "YouTube", NOW);
    expect(copy.title).toBe("Earn your YouTube time first.");
    expect(copy.details.join(" ")).toContain("Spend 20 more minutes on duolingo.com today");
    expect(copy.earnAt).toBe("duolingo.com");
  });
});

describe("earn goal actions", () => {
  let store: MemoryStateStore, ctx: actions.ActionContext;
  beforeEach(() => {
    store = new MemoryStateStore();
    ctx = { store, now: new Clock(NOW).now };
  });
  it("saves a clean goal with domain aliases", async () => {
    const r = await actions.saveEarnGoal(ctx, goal({ goalDomains: ["https://www.Duolingo.com/learn"], lockedDomains: ["youtube.com"] }));
    expect(r.ok).toBe(true);
    const saved = (r as { data: AppState }).data.earnGoals![0];
    expect(saved.goalDomains).toEqual(["duolingo.com"]);
    expect(saved.lockedDomains).toContain("youtu.be");
    expect((await actions.deleteEarnGoal(ctx, "duo")).ok).toBe(true);
    expect((await store.get()).earnGoals ?? []).toEqual([]);
  });
  it("rejects invalid goals", async () => {
    expect((await actions.saveEarnGoal(ctx, goal({ minutes: 0 }))).ok).toBe(false);
    expect((await actions.saveEarnGoal(ctx, goal({ minutes: 2000 }))).ok).toBe(false);
    expect((await actions.saveEarnGoal(ctx, goal({ goalDomains: [] }))).ok).toBe(false);
    expect((await actions.saveEarnGoal(ctx, goal({ lockedDomains: [] }))).ok).toBe(false);
    expect((await actions.saveEarnGoal(ctx, goal({ goalDomains: ["youtube.com"] }))).ok).toBe(false);
  });
  it("refuses goals that lock another goal's website (it could never be earned)", async () => {
    await actions.saveEarnGoal(ctx, goal());
    const r = await actions.saveEarnGoal(
      ctx,
      goal({ id: "yt", label: "Watch first", goalDomains: ["youtube.com"], lockedDomains: ["duolingo.com"] }),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("could never be earned");
  });
  it("needs the settings password when one is set", async () => {
    await actions.setSettingsPassword(ctx, "a test password");
    expect((await actions.saveEarnGoal(ctx, goal())).ok).toBe(false);
    expect((await actions.saveEarnGoal({ ...ctx, password: "a test password" }, goal())).ok).toBe(true);
    expect((await actions.deleteEarnGoal(ctx, "duo")).ok).toBe(false);
  });
  it("survives a reload of saved state", async () => {
    await actions.saveEarnGoal(ctx, goal());
    expect((await store.reopen().get()).earnGoals?.[0].id).toBe("duo");
  });
});

describe("earning Fry Time", () => {
  const fryGoal = (patch: Partial<EarnGoal> = {}) =>
    goal({ reward: "fry", repeats: 2, fryMinutes: 10, minutes: 20, ...patch });
  const feedsHidden = (patch: Partial<EarnGoal> = {}) => {
    const s = withGoal({ reward: "fry", repeats: 2, fryMinutes: 10, minutes: 20, ...patch });
    s.feedSettings.sites.youtube.home = true;
    return s;
  };
  it("never blocks; each completion pays out Fry Time, up to the repeat limit", () => {
    const s = feedsHidden();
    expect(evaluatePolicy(s, YT, NOW).status).toBe("allowed");
    expect(evaluatePolicy(s, YT, NOW).freeTime).toBeUndefined();
    spend(s, DUO, NOW, NOW + 20 * MIN);
    expect(evaluatePolicy(s, YT, NOW + 20 * MIN).freeTime).toMatchObject({
      windowId: "earn:duo",
      earned: true,
      remainingMilliseconds: 10 * MIN,
    });
    // Using it counts down; a second completion adds another 10 minutes.
    spend(s, YT, NOW + 20 * MIN, NOW + 25 * MIN);
    expect(evaluatePolicy(s, YT, NOW + 25 * MIN).freeTime?.remainingMilliseconds).toBe(5 * MIN);
    spend(s, DUO, NOW + 25 * MIN, NOW + 65 * MIN); // 40 more minutes, but only one more payout
    expect(evaluatePolicy(s, YT, NOW + 65 * MIN).freeTime?.remainingMilliseconds).toBe(15 * MIN);
    expect(s.usage[Object.keys(s.usage)[0]].millisecondsByGoal?.duo).toBe(40 * MIN);
  });
  it("supports no limit and custom minutes per website", () => {
    const s = feedsHidden({ repeats: 0, fryMinutes: undefined, fryMinutesBySite: { youtube: 3, "news.example.org": 7 } });
    spend(s, DUO, NOW, NOW + 60 * MIN); // three completions
    expect(evaluatePolicy(s, YT, NOW + 60 * MIN).freeTime?.remainingMilliseconds).toBe(9 * MIN);
    expect(evaluatePolicy(s, "https://news.example.org/", NOW + 60 * MIN).freeTime?.remainingMilliseconds).toBe(21 * MIN);
  });
  it("can pay a different amount each time it's earned", () => {
    const s = feedsHidden({ repeats: 3, fryMinutes: 1, fryMinutesSchedule: [1, 5, 10] });
    spend(s, DUO, NOW, NOW + 20 * MIN);
    expect(evaluatePolicy(s, YT, NOW + 20 * MIN).freeTime?.remainingMilliseconds).toBe(1 * MIN);
    spend(s, DUO, NOW + 20 * MIN, NOW + 40 * MIN);
    expect(evaluatePolicy(s, YT, NOW + 40 * MIN).freeTime?.remainingMilliseconds).toBe(6 * MIN);
    spend(s, DUO, NOW + 40 * MIN, NOW + 80 * MIN); // only one more payout: 10
    expect(evaluatePolicy(s, YT, NOW + 80 * MIN).freeTime?.remainingMilliseconds).toBe(16 * MIN);
    // With no limit, the last amount repeats.
    const open = feedsHidden({ repeats: 0, fryMinutes: 1, fryMinutesSchedule: [1, 5] });
    spend(open, DUO, NOW, NOW + 60 * MIN);
    expect(evaluatePolicy(open, YT, NOW + 60 * MIN).freeTime?.remainingMilliseconds).toBe(11 * MIN);
  });
  it("keeps earned Fry Time and a Fry Time window's minutes apart", () => {
    // A 6–8 pm window with 5 minutes, and 10 minutes earned in the morning.
    const s = feedsHidden({ repeats: 1 });
    const evening = at(2026, 10, 9, 18);
    s.windows = [
      {
        id: "eve",
        label: "Evening",
        enabled: true,
        mode: "free",
        days: [0, 1, 2, 3, 4, 5, 6],
        startMinute: 18 * 60,
        endMinute: 20 * 60,
        domains: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
        freeMinutes: 5,
      },
    ];
    spend(s, DUO, NOW, NOW + 20 * MIN);
    // Earned outside the window: usable right away.
    expect(evaluatePolicy(s, YT, NOW + 20 * MIN).freeTime).toMatchObject({ earned: true, remainingMilliseconds: 10 * MIN });
    spend(s, YT, NOW + 20 * MIN, NOW + 24 * MIN);
    // The window still has all 5 of its minutes; they go first during it.
    expect(evaluatePolicy(s, YT, evening).freeTime).toMatchObject({ windowId: "eve", remainingMilliseconds: 5 * MIN });
    spend(s, YT, evening, evening + 5 * MIN);
    // Then the 6 earned minutes left are still there, untouched by the window.
    expect(evaluatePolicy(s, YT, evening + 5 * MIN).freeTime).toMatchObject({ earned: true, remainingMilliseconds: 6 * MIN });
  });
  it("is validated: minutes for every website, sensible repeats, and it locks nothing", async () => {
    const store = new MemoryStateStore();
    const ctx = { store, now: () => NOW };
    expect((await actions.saveEarnGoal(ctx, fryGoal({ fryMinutes: undefined }))).ok).toBe(false);
    expect((await actions.saveEarnGoal(ctx, fryGoal({ repeats: 99 }))).ok).toBe(false);
    expect((await actions.saveEarnGoal(ctx, fryGoal({ fryMinutesSchedule: [1, 0] }))).ok).toBe(false);
    const varied = await actions.saveEarnGoal(ctx, fryGoal({ id: "v", label: "Varied", fryMinutes: undefined, fryMinutesSchedule: [1, 5, 10] }));
    // Trimmed to the two times a day it can be earned.
    expect(varied.ok && varied.data.earnGoals?.find((g) => g.id === "v")).toMatchObject({ fryMinutes: 1, fryMinutesSchedule: [1, 5] });
    await actions.deleteEarnGoal(ctx, "v");
    const saved = await actions.saveEarnGoal(ctx, fryGoal());
    expect(saved.ok && saved.data.earnGoals?.[0]).toMatchObject({ reward: "fry", repeats: 2, fryMinutes: 10 });
    // A Fry Time goal's websites can be another goal's goal website: nothing is locked.
    const other = goal({ id: "yt", label: "YouTube study", goalDomains: ["youtube.com"], lockedDomains: ["x.com"] });
    expect((await actions.saveEarnGoal(ctx, other)).ok).toBe(true);
  });
});
