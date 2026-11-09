import { describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import {
  describeConflict,
  evaluatePolicy,
  runningWindows,
  suspendedWindowIds,
  windowConflicts,
} from "@policy/index";
import { createDefaultState } from "@core/defaults";
import type { AccessWindow } from "@shared/index";

const youtubeAndX = ["youtube.com", "youtu.be", "x.com", "twitter.com"];
const win = (patch: Partial<AccessWindow>): AccessWindow => ({
  id: "w",
  label: "Window",
  enabled: true,
  domains: youtubeAndX,
  days: [0, 1, 2, 3, 4, 5, 6],
  startMinute: 11 * 60 + 15,
  endMinute: 11 * 60 + 30,
  mode: "allow",
  ...patch,
});
const morning = win({ id: "morning", label: "Morning BrainRot" });
const noX = win({ id: "nox", label: "No X or YouTube", mode: "block" });

describe("contradicting windows", () => {
  it("catches a block window over an allow window on the same websites", () => {
    const [conflict] = windowConflicts([morning], noX);
    expect(conflict).toMatchObject({ other: morning, sites: ["YouTube", "X"], day: 1, minute: 675 });
    expect(describeConflict(noX, conflict)).toBe(
      "“No X or YouTube” blocks YouTube and X while “Morning BrainRot” allows them (overlap starts Mon 11:15 AM). Both are paused until you change the times, days or websites so they don’t overlap.",
    );
    // Reported the same way whichever window is being saved.
    expect(describeConflict(morning, windowConflicts([noX], morning)[0])).toContain(
      "“No X or YouTube” blocks YouTube and X while “Morning BrainRot” allows them",
    );
  });
  it("catches a block window over free time", () => {
    const free = win({ id: "free", label: "Evening", mode: "free", freeMinutes: 30 });
    expect(describeConflict(noX, windowConflicts([free], noX)[0])).toContain("opens their feeds");
  });
  it("allows windows that don't actually contradict", () => {
    const later = { ...noX, startMinute: 11 * 60 + 30, endMinute: 12 * 60 };
    expect(windowConflicts([morning], later)).toEqual([]); // back to back, no overlap
    expect(windowConflicts([morning], { ...noX, days: [] })).toEqual([]);
    expect(windowConflicts([morning], { ...noX, domains: ["reddit.com"] })).toEqual([]);
    const instagram = { ...noX, domains: ["instagram.com"] };
    expect(
      describeConflict(instagram, windowConflicts([{ ...morning, domains: ["instagram.com"] }], instagram)[0]),
    ).toContain("blocks Instagram while “Morning BrainRot” allows it (");
    expect(windowConflicts([morning], { ...noX, enabled: false })).toEqual([]);
    expect(windowConflicts([{ ...morning, enabled: false }], noX)).toEqual([]);
    expect(windowConflicts([morning], { ...morning, id: "other" })).toEqual([]); // allow + allow
    expect(windowConflicts([noX], { ...noX, id: "other" })).toEqual([]); // block + block
    expect(windowConflicts([morning], { ...morning, id: "f", mode: "free" })).toEqual([]);
  });
  it("finds overlaps across midnight and with all-day windows", () => {
    const night = win({ id: "night", mode: "allow", days: [5], startMinute: 22 * 60, endMinute: 60 });
    const saturdayMorning = win({ id: "sat", mode: "block", days: [6], startMinute: 30, endMinute: 120 });
    expect(windowConflicts([night], saturdayMorning)[0]).toMatchObject({ day: 6, minute: 30 });
    const allDay = win({ id: "all", mode: "block", days: [3], startMinute: 0, endMinute: 0 });
    expect(windowConflicts([morning], allDay)[0]).toMatchObject({ day: 3, minute: 675 });
  });
  it("is saved, but pauses both windows until either one is edited to fix it", async () => {
    const store = new MemoryStateStore();
    const ctx = { store, now: () => Date.now() };
    expect((await actions.saveWindow(ctx, morning)).ok).toBe(true);
    const saved = await actions.saveWindow(ctx, noX);
    expect(saved.ok).toBe(true);
    const windows = (await store.get()).windows;
    expect([...suspendedWindowIds(windows)].sort()).toEqual(["morning", "nox"]);
    expect(runningWindows(windows)).toEqual([]);
    // Switching one off reconciles it; so does moving it.
    expect(suspendedWindowIds([morning, { ...noX, enabled: false }]).size).toBe(0);
    expect((await actions.saveWindow(ctx, { ...noX, startMinute: 690, endMinute: 720 })).ok).toBe(true);
    expect(runningWindows((await store.get()).windows).map((w) => w.id).sort()).toEqual(["morning", "nox"]);
    // Imports keep a contradiction too, paused the same way.
    const exported = actions.exportSettings(await store.get(), Date.now());
    exported.windows = [morning, noX];
    expect((await actions.importSettings(ctx, exported)).ok).toBe(true);
    expect(suspendedWindowIds((await store.get()).windows).size).toBe(2);
  });
  it("lets neither paused window decide whether a website is open", () => {
    const state = createDefaultState();
    state.windows = [morning, noX];
    const monday1120 = new Date(2026, 10, 9, 11, 20).getTime();
    const decision = evaluatePolicy(state, "https://www.youtube.com/", monday1120);
    expect(decision.reasons).not.toContain("block-window");
    expect(decision.reasons).not.toContain("outside-window");
    // Without the contradiction the block window applies.
    state.windows = [noX];
    expect(evaluatePolicy(state, "https://www.youtube.com/", monday1120).reasons).toContain("block-window");
  });
});
