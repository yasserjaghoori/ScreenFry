import { describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { migrateState } from "@core/defaults";
import { localDateKey } from "@core/date";
import { creditUsage, nextTrackingBoundary } from "@core/tracking";
import {
  activeFreeTime,
  effectiveFeedSettings,
  evaluatePolicy,
} from "@policy/index";
import { buildBlockingCss } from "@feeds/index";
import { blockedCopy } from "../apps/extension/src/ui/blocked-copy";
import { MIN, at, rule, stateWith } from "./helpers";
import type { AccessWindow, AppState } from "@shared/index";

const evening = (patch: Partial<AccessWindow> = {}): AccessWindow => ({
  id: "evening",
  label: "Brainrot time",
  enabled: true,
  domains: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
  days: [0, 1, 2, 3, 4, 5, 6],
  startMinute: 19 * 60,
  endMinute: 21 * 60,
  mode: "free",
  freeMinutes: 30,
  ...patch,
});
/** The research-browser setup: YouTube's feed and Shorts hidden, no time limit. */
function feedBlocked(windows: AccessWindow[] = [evening()]): AppState {
  const s = stateWith([rule({ dailyAllowance: undefined })], { windows });
  s.feedSettings.sites.youtube.home = true;
  s.feedSettings.sites.youtube.shorts = true;
  s.feedSettings.sites.x.forYou = true;
  return s;
}
/** Sessions are credited at most 90 seconds at a time, so step through longer spans. */
function use(s: AppState, url: string, from: number, to: number) {
  for (let t = from; t < to; t += MIN) creditUsage(s, url, t, Math.min(to, t + MIN));
}
const home = "https://www.youtube.com/";
const shorts = "https://www.youtube.com/shorts/abc";
const before = at(2026, 10, 3, 18),
  during = at(2026, 10, 3, 19, 30),
  after = at(2026, 10, 3, 21, 30);

describe("Fry Time for each website", () => {
  const both = (patch: Partial<AccessWindow> = {}) =>
    evening({ domains: ["youtube.com", "youtu.be", "x.com", "twitter.com"], freeMinutes: 5, ...patch });
  const x = "https://x.com/home";
  it("gives every website its own minutes; one running out doesn't end another's", () => {
    const s = feedBlocked([both()]);
    use(s, home, during, during + 10 * MIN);
    // YouTube's 5 minutes are spent, so it's back to its normal settings...
    expect(activeFreeTime(s, home, during + 10 * MIN)).toBeUndefined();
    expect(buildBlockingCss(effectiveFeedSettings(s, home, during + 10 * MIN), home)).not.toBe("");
    // ...while X still has all of its own.
    expect(activeFreeTime(s, x, during + 10 * MIN)?.remainingMilliseconds).toBe(5 * MIN);
    const day = s.usage[localDateKey(new Date(during))].millisecondsByWindow;
    expect(day).toEqual({ "evening:youtube": 5 * MIN });
  });
  it("supports custom minutes per website, and keeps them through saving", async () => {
    const custom = both({ freeMinutes: undefined, freeMinutesBySite: { youtube: 10, x: 2 } });
    const s = feedBlocked([custom]);
    expect(activeFreeTime(s, home, during)?.remainingMilliseconds).toBe(10 * MIN);
    expect(activeFreeTime(s, x, during)?.remainingMilliseconds).toBe(2 * MIN);
    const store = new MemoryStateStore();
    const ctx = { store, now: () => during };
    const saved = await actions.saveWindow(ctx, {
      ...custom,
      freeMinutesBySite: { youtube: 10, x: 2, reddit: 4 }, // Reddit isn't in this window
    });
    expect(saved.ok && saved.data.windows[0].freeMinutesBySite).toEqual({ youtube: 10, x: 2 });
    expect(saved.ok && saved.data.windows[0].freeMinutes).toBeUndefined();
    expect((await actions.saveWindow(ctx, { ...custom, freeMinutesBySite: { youtube: 0 } })).ok).toBe(false);
    expect(migrateState(JSON.parse(JSON.stringify(await store.get()))).windows[0].freeMinutesBySite).toEqual({ youtube: 10, x: 2 });
  });
});

describe("when Fry Time does nothing", () => {
  it("doesn't run, or use minutes, on a website with no filters on", () => {
    const s = feedBlocked();
    s.feedSettings.sites.youtube.home = false;
    s.feedSettings.sites.youtube.shorts = false;
    expect(activeFreeTime(s, home, during)).toBeUndefined();
    use(s, home, during, during + 3 * MIN);
    expect(s.usage[localDateKey(new Date(during))]?.millisecondsByWindow ?? {}).toEqual({});
  });
  it("doesn't run on a blocked website: a block outranks a filter", () => {
    const s = feedBlocked();
    s.rules[0].blocked = true;
    expect(activeFreeTime(s, home, during)).toBeUndefined();
    expect(evaluatePolicy(s, home, during)).toMatchObject({ status: "blocked" });
    expect(evaluatePolicy(s, home, during).freeTime).toBeUndefined();
  });
});

describe("free-time windows", () => {
  it("keeps feeds blocked outside the window and pauses them inside it", () => {
    const s = feedBlocked();
    expect(buildBlockingCss(effectiveFeedSettings(s, home, before), home)).not.toBe("");
    expect(evaluatePolicy(s, shorts, before).reasons).toContain("short-form");
    expect(buildBlockingCss(effectiveFeedSettings(s, home, during), home)).toBe("");
    const inside = evaluatePolicy(s, shorts, during);
    expect(inside.status).toBe("allowed");
    expect(inside.freeTime).toEqual({
      windowId: "evening",
      label: "Brainrot time",
      remainingMilliseconds: 30 * MIN,
    });
    expect(evaluatePolicy(s, shorts, after).reasons).toContain("short-form");
    // The saved settings themselves never change.
    expect(s.feedSettings.sites.youtube.home).toBe(true);
  });
  it("counts time inside the window and brings feed blocking back when it runs out", () => {
    const s = feedBlocked();
    use(s, home, during, during + 20 * MIN);
    expect(s.usage[localDateKey(new Date(during))].millisecondsByWindow["evening:youtube"]).toBe(20 * MIN);
    expect(activeFreeTime(s, home, during + 20 * MIN)?.remainingMilliseconds).toBe(10 * MIN);
    expect(nextTrackingBoundary(s, home, during + 20 * MIN)).toBe(during + 30 * MIN);
    use(s, home, during + 20 * MIN, during + 45 * MIN);
    // Capped at the budget; the site stays usable, with feeds hidden again.
    expect(s.usage[localDateKey(new Date(during))].millisecondsByWindow["evening:youtube"]).toBe(30 * MIN);
    const later = evaluatePolicy(s, shorts, during + 45 * MIN);
    expect(later.freeTime).toBeUndefined();
    expect(later.reasons).toEqual(["short-form"]);
    expect(evaluatePolicy(s, home, during + 45 * MIN).status).toBe("allowed");
  });
  it("doesn't count time outside the window, and an unbudgeted window lasts all window", () => {
    const s = feedBlocked([evening({ freeMinutes: undefined })]);
    use(s, home, before, before + 10 * MIN);
    expect(s.usage[localDateKey(new Date(before))]?.millisecondsByWindow?.["evening:youtube"]).toBeUndefined();
    use(s, home, during, during + 60 * MIN);
    expect(activeFreeTime(s, home, during + 60 * MIN)).toEqual({
      windowId: "evening",
      label: "Brainrot time",
      remainingMilliseconds: undefined,
    });
  });
  it("never unblocks a blocked website or lifts a daily limit", () => {
    const blocked = stateWith([rule({ blocked: true })], { windows: [evening()] });
    expect(evaluatePolicy(blocked, home, during).status).toBe("blocked");
    const limited = stateWith([rule({ dailyAllowance: { defaultMinutes: 0 } })], {
      windows: [evening()],
    });
    expect(evaluatePolicy(limited, home, during).reasons).toContain("daily-limit");
  });
  it("tells 'outside free time' apart from 'free time used up' on the block screen", () => {
    const s = feedBlocked();
    const early = evaluatePolicy(s, shorts, before);
    expect(early.freeTimeOff).toEqual({
      state: "not-started",
      label: "Brainrot time",
      nextAt: at(2026, 10, 3, 19),
    });
    const earlyCopy = blockedCopy(early, "YouTube Shorts", before);
    expect(earlyCopy.title).toBe("YouTube Shorts is off for now.");
    expect(earlyCopy.details.join(" ")).toContain("outside your Fry Time");
    expect(earlyCopy.next).toMatch(/^Fry Time starts today at/);

    use(s, home, during, during + 30 * MIN);
    const spent = evaluatePolicy(s, shorts, during + 31 * MIN);
    expect(spent.freeTimeOff).toEqual({
      state: "used-up",
      label: "Brainrot time",
      nextAt: at(2026, 10, 4, 19),
    });
    const spentCopy = blockedCopy(spent, "YouTube Shorts", during + 31 * MIN);
    expect(spentCopy.title).toBe("Fry Time is up!");
    expect(spentCopy.details.join(" ")).toContain("used today’s Fry Time");
    expect(spentCopy.next).toMatch(/^Fry Time is back tomorrow at/);

    // After the window ends it reads as outside free time again, not as used up.
    expect(evaluatePolicy(s, shorts, after).freeTimeOff?.state).toBe("not-started");
    // Inside free time, and on sites without free-time windows, there is nothing to explain.
    expect(evaluatePolicy(feedBlocked(), shorts, during).freeTimeOff).toBeUndefined();
    expect(evaluatePolicy(feedBlocked([]), shorts, during).freeTimeOff).toBeUndefined();
  });
  it("keeps the other block reasons distinct", () => {
    const allow = (mode: "allow" | "block") =>
      stateWith([rule({ dailyAllowance: undefined })], {
        windows: [evening({ mode, freeMinutes: undefined })],
      });
    const outside = blockedCopy(evaluatePolicy(allow("allow"), home, before), "YouTube", before);
    expect(outside.details.join(" ")).toContain("outside its allowed windows");
    expect(outside.next).toMatch(/^Back today at/);
    expect(blockedCopy(evaluatePolicy(allow("block"), home, during), "YouTube").details).toEqual([
      "One of your block windows is on right now.",
    ]);
    const limited = stateWith([rule({ dailyAllowance: { defaultMinutes: 0 } })]);
    expect(blockedCopy(evaluatePolicy(limited, home, during), "YouTube").title).toBe("Time is up!");
  });
  it("is not treated as an allow window", () => {
    expect(evaluatePolicy(feedBlocked(), home, before).reasons).not.toContain(
      "outside-window",
    );
  });
  it("validates and survives saving, migration and settings import", async () => {
    const store = new MemoryStateStore();
    const ctx = { store, now: () => during };
    expect((await actions.saveWindow(ctx, evening({ freeMinutes: 0 }))).ok).toBe(false);
    expect((await actions.saveWindow(ctx, evening())).ok).toBe(true);
    const saved = (await store.get()).windows[0];
    expect(saved.mode).toBe("free");
    expect(saved.freeMinutes).toBe(30);
    expect(migrateState(JSON.parse(JSON.stringify(await store.get()))).windows[0].freeMinutes).toBe(30);
    // An allow window never keeps a stray budget.
    expect((await actions.saveWindow(ctx, evening({ id: "a", mode: "allow" }))).ok).toBe(true);
    expect((await store.get()).windows.find((w) => w.id === "a")?.freeMinutes).toBeUndefined();
    const file = actions.exportSettings(await store.get(), during);
    const other = new MemoryStateStore();
    expect((await actions.importSettings({ store: other, now: () => during }, file)).ok).toBe(true);
    expect((await other.get()).windows.find((w) => w.id === "evening")?.freeMinutes).toBe(30);
  });
});
