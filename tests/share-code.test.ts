import { beforeEach, describe, expect, it } from "vitest";
import * as actions from "@core/actions";
import { MemoryStateStore } from "@core/store";
import { SHARE_PREFIX, decodeShareCode, encodeShareCode, summarizeShared } from "@core/share";
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
  it("is one compact line without usage or the password", async () => {
    const code = await myCode();
    expect(code.startsWith(SHARE_PREFIX)).toBe(true);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    const data = JSON.stringify(await decodeShareCode(code));
    expect(data).not.toContain("PBKDF2");
    expect(data).not.toContain("usage");
    expect(data).not.toContain("createdAt");
  });

  it("previews what a code sets", async () => {
    const summary = summarizeShared(await decodeShareCode(await myCode()));
    expect(summary.limits).toEqual(["YouTube: 15 min a day"]);
    expect(summary.windows).toEqual(["Lunch"]);
    expect(summary.earnGoals).toEqual(["20 min on duolingo.com unlocks TikTok"]);
    expect(summary.feedBlockers).toBe(1);
    expect(summarizeShared(null)).toMatchObject({ blocked: [], windows: [] });
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
