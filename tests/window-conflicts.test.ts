import { describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { describeConflict, windowConflicts } from "@policy/index";
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
      "“No X or YouTube” blocks YouTube and X while “Morning BrainRot” allows them (overlap starts Mon 11:15 AM). Change the times, days or websites so they don’t overlap.",
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
  it("is refused when saving, switching on or importing, but editing either side to fix it works", async () => {
    const store = new MemoryStateStore();
    const ctx = { store, now: () => Date.now() };
    expect((await actions.saveWindow(ctx, morning)).ok).toBe(true);
    const refused = await actions.saveWindow(ctx, noX);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain("“No X or YouTube” blocks YouTube and X");
    // Saved switched off, then switched on: refused at the switch.
    expect((await actions.saveWindow(ctx, { ...noX, enabled: false })).ok).toBe(true);
    expect((await actions.saveWindow(ctx, noX)).ok).toBe(false);
    expect((await actions.saveWindow(ctx, { ...noX, startMinute: 690, endMinute: 720 })).ok).toBe(true);
    const exported = actions.exportSettings(await store.get(), Date.now());
    exported.windows = [morning, noX];
    const imported = await actions.importSettings(ctx, exported);
    expect(!imported.ok && imported.error).toMatch(/^Windows: “No X or YouTube” blocks/);
  });
});
