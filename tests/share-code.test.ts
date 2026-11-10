import { beforeEach, describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { SHARE_PREFIX, decodeShareCode, encodeShareCode } from "@core/share";
import { createDefaultState } from "@core/defaults";
import { shareSlides } from "../apps/extension/src/ui/share-changes";
import { Clock, MIN, at, rule, setUsage } from "./helpers";
import type { AccessWindow, AppState } from "@shared/index";

const NOW = at(2026, 10, 9, 12);
const lunch: AccessWindow = {
  id: "lunch",
  label: "Lunch",
  enabled: true,
  domains: ["reddit.com"],
  days: [1, 2, 3, 4, 5],
  startMinute: 720,
  endMinute: 780,
  mode: "allow",
};
let mine: actions.ActionContext, friend: actions.ActionContext;
beforeEach(() => {
  const clock = new Clock(NOW);
  mine = { store: new MemoryStateStore(), now: clock.now };
  friend = { store: new MemoryStateStore(), now: clock.now };
});
async function myCode() {
  await actions.saveRule(mine, rule({ dailyAllowance: { defaultMinutes: 15 } }));
  await actions.saveWindow(mine, lunch);
  await actions.saveEarnGoal(mine, {
    id: "duo",
    label: "Spanish first",
    enabled: true,
    goalDomains: ["duolingo.com"],
    minutes: 20,
    lockedDomains: ["tiktok.com"],
  });
  const s = await mine.store.get();
  s.feedSettings.sites.youtube.shorts = true;
  await mine.store.update(() => s);
  await actions.setSettingsPassword(mine, "my secret password");
  return encodeShareCode(actions.exportSettings(await mine.store.get(), NOW));
}

describe("share codes", () => {
  it("is one short line without usage or the password", async () => {
    const code = await myCode();
    expect(code.startsWith(SHARE_PREFIX)).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    // A limit, a window, an earn goal and a feed blocker fit in a short line.
    expect(code.length).toBeLessThan(220);
    const data = JSON.stringify(await decodeShareCode(code));
    expect(data).not.toContain("PBKDF2");
    expect(data).not.toContain("usage");
  });

  it("is tiny for a fresh install", async () => {
    const code = await encodeShareCode(actions.exportSettings(createDefaultState(), NOW));
    expect(code).toBe("SF2-je30");
  });

  it("round-trips every kind of setting", async () => {
    const { store } = mine;
    await actions.saveRule(mine, rule({ blocked: true, showTimer: true, dailyAllowance: { defaultMinutes: 20, byWeekday: { 6: 60 } } }));
    await actions.saveRule(mine, rule({ id: "news", label: "news.example.org", domains: ["news.example.org"], dailyAllowance: { defaultMinutes: 5 } }));
    await actions.saveWindow(mine, { ...lunch, id: "fry", label: "Fry", mode: "free", domains: ["youtube.com", "x.com"], freeMinutesBySite: { youtube: 10 } });
    await actions.saveWindow(mine, { ...lunch, id: "off", label: "Off", enabled: false, startMinute: 1320, endMinute: 360 });
    await actions.setPreferences(mine, { warningsEnabled: false });
    const s = await store.get();
    s.feedSettings.globalEnabled = false;
    await store.update(() => s);
    const before = actions.exportSettings(await store.get(), NOW);
    const after = (await decodeShareCode(await encodeShareCode(before))) as typeof before;
    const strip = (x: typeof before) => ({
      rules: x.rules.map(({ id: _i, createdAt: _c, updatedAt: _u, ...r }) => r).sort((a, b) => a.label.localeCompare(b.label)),
      windows: x.windows.map(({ id: _i, ...w }) => w),
      feedSettings: x.feedSettings,
      warningsEnabled: x.warningsEnabled,
    });
    expect(strip(after)).toEqual(strip(before));
  });

  it("keeps Fry Time earn goals intact", async () => {
    await actions.saveEarnGoal(mine, {
      id: "fry",
      label: "Read for Fry Time",
      enabled: false,
      goalDomains: ["wikipedia.org"],
      minutes: 15,
      lockedDomains: ["youtube.com", "instagram.com"],
      reward: "fry",
      repeats: 3,
      fryMinutesBySite: { youtube: 10, instagram: 5 },
    });
    const before = actions.exportSettings(await mine.store.get(), NOW);
    const after = (await decodeShareCode(await encodeShareCode(before))) as typeof before;
    const strip = (goals: typeof before.earnGoals) => goals!.map(({ id: _i, ...g }) => g);
    expect(strip(after.earnGoals)).toEqual(strip(before.earnGoals));
    expect(actions.checkSettings(after, NOW).error).toBeUndefined();
  });

  it("still reads the older SCREENFRY-1 codes", async () => {
    await actions.saveWindow(mine, lunch);
    const json = new TextEncoder().encode(JSON.stringify(actions.exportSettings(await mine.store.get(), NOW)));
    const zipped = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const v1 = "SCREENFRY-1-" + btoa(String.fromCharCode(...zipped)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect((await actions.importShareCode(friend, v1)).ok).toBe(true);
    expect((await friend.store.get()).windows.map((w) => w.label)).toEqual(["Lunch"]);
  });

  it("shows one slide per website it changes, each setting as now → after", async () => {
    const incoming = actions.checkSettings(await decodeShareCode(await myCode()), NOW).settings!;
    const slides = shareSlides(await friend.store.get(), incoming as never);
    expect(slides.map((s) => s.name)).toEqual(["YouTube", "Reddit", "TikTok", "duolingo.com"]);
    expect(slides[0].changes).toEqual([
      { label: "Daily limit", from: "No limit", to: "15 min a day" },
      { label: "Block Shorts entirely", from: "Off", to: "On" },
    ]);
    expect(slides[1].changes).toEqual([
      { label: "Allow window “Lunch”", from: "None", to: "Weekdays, 12:00 PM–1:00 PM" },
    ]);
    expect(slides[2].changes).toEqual([
      { label: "Earn goal “Spanish first”", from: "None", to: "Locked until 20 min on duolingo.com" },
    ]);
    expect(slides[3].changes[0].to).toBe("20 min here unlocks TikTok");
    // Applying the same settings again changes nothing.
    const same = actions.checkSettings(await decodeShareCode(await myCode()), NOW).settings!;
    expect(shareSlides(await mine.store.get(), same as never)).toEqual([]);
  });

  it("keeps today's Fry Time and earn progress for windows and goals with the same name", async () => {
    const code = await myCode();
    await actions.saveWindow(friend, { ...lunch, id: "friend-lunch" });
    await actions.importShareCode(friend, code);
    expect((await friend.store.get()).windows.map((w) => w.id)).toEqual(["friend-lunch"]);
  });

  it("applies a friend's code, keeping today's usage for the same website", async () => {
    const code = await myCode();
    // The friend's YouTube rule has its own id and 10 minutes used today.
    await friend.store.update((s: AppState) => {
      s.rules = s.rules.map((r) => (r.id === "youtube" ? { ...r, id: "friend-yt" } : r));
      return setUsage(s, 10 * MIN, "friend-yt", NOW);
    });
    // Tolerates the line breaks a chat app may add.
    const r = await actions.importShareCode(friend, `  ${code.slice(0, 40)}\n${code.slice(40)} `);
    expect(r.ok).toBe(true);
    const s = await friend.store.get();
    const yt = s.rules.find((x) => x.domains.includes("youtube.com"))!;
    expect(yt.id).toBe("friend-yt");
    expect(yt.dailyAllowance?.defaultMinutes).toBe(15);
    expect(s.windows.map((w) => w.label)).toEqual(["Lunch"]);
    expect(s.earnGoals?.map((g) => g.label)).toEqual(["Spanish first"]);
    expect(s.feedSettings.sites.youtube.shorts).toBe(true);
    // The sharer's password never comes along.
    expect(s.settingsPassword).toBeUndefined();
  });

  it("follows the receiver's password", async () => {
    const code = await myCode();
    await actions.setSettingsPassword(friend, "friend password");
    expect((await actions.importShareCode(friend, code)).ok).toBe(false);
    expect((await actions.importShareCode({ ...friend, password: "friend password" }, code)).ok).toBe(true);
  });

  it("rejects junk, damaged and tampered codes with a clear message", async () => {
    const code = await myCode();
    for (const bad of ["", "hello", "SCREENFRY-1-!!!", `${code.slice(0, -12)}`]) {
      const r = await actions.importShareCode(friend, bad);
      expect(r.ok).toBe(false);
    }
    // A decoded-but-invalid payload is validated like a settings file.
    const tampered = await encodeShareCode({
      ...actions.exportSettings(await mine.store.get(), NOW),
      rules: [rule({ domains: ["not a domain"] })],
    });
    expect((await actions.importShareCode(friend, tampered)).ok).toBe(false);
  });

  it("accepts a pasted settings file too", async () => {
    await actions.saveWindow(mine, lunch);
    const file = JSON.stringify(actions.exportSettings(await mine.store.get(), NOW));
    expect((await actions.importShareCode(friend, file)).ok).toBe(true);
    expect((await friend.store.get()).windows.map((w) => w.id)).toEqual(["lunch"]);
  });

  it("leaves earn goals alone when a file predates them", async () => {
    await actions.saveEarnGoal(friend, {
      id: "g",
      label: "Read first",
      enabled: true,
      goalDomains: ["wikipedia.org"],
      minutes: 10,
      lockedDomains: ["x.com"],
    });
    const { earnGoals: _drop, ...old } = actions.exportSettings(await mine.store.get(), NOW);
    expect((await actions.importSettings(friend, old)).ok).toBe(true);
    expect((await friend.store.get()).earnGoals?.map((g) => g.id)).toEqual(["g"]);
  });
});

describe("Fry Time rewards that differ each time", () => {
  it("survive a share code", async () => {
    const s = createDefaultState();
    const goal = {
      id: "g",
      label: "Spanish",
      enabled: true,
      goalDomains: ["duolingo.com"],
      minutes: 20,
      lockedDomains: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
      reward: "fry" as const,
      repeats: 3,
      fryMinutes: 1,
      fryMinutesSchedule: [1, 5, 10],
    };
    const code = await encodeShareCode({ ...s, earnGoals: [goal] });
    const back = (await decodeShareCode(code)) as { earnGoals?: unknown[] };
    expect(back.earnGoals?.[0]).toMatchObject({ repeats: 3, fryMinutes: 1, fryMinutesSchedule: [1, 5, 10] });
  });
});
