import { describe, expect, it } from "vitest";
import { createDefaultState, migrateState } from "@core/defaults";
import { siteFor, buildBlockingCss } from "@feeds/index";
import { tiktokVideoId } from "@feeds/tiktok";
import { evaluatePolicy } from "@policy/index";

describe("TikTok controls", () => {
  it("puts Sidebar before Navigation and has no redundant all-video block", () => {
    const site = siteFor("www.tiktok.com")!;
    const groups = [
      ...new Set(Object.values(site.elements).map((e) => e.group)),
    ];
    expect(groups.indexOf("Sidebar")).toBeLessThan(
      groups.indexOf("Navigation"),
    );
    expect(site.elements.videos).toBeUndefined();
    expect(site.shortForm).toBeUndefined();
  });
  it("scopes recommendations and next-video controls to video pages", () => {
    const state = createDefaultState();
    state.feedSettings.sites.tiktok.recommendedVideos = true;
    state.feedSettings.sites.tiktok.singleVideo = true;
    expect(
      buildBlockingCss(state.feedSettings, "https://tiktok.com/@a/video/123"),
    ).toContain("recommend-video-list");
    expect(
      buildBlockingCss(state.feedSettings, "https://tiktok.com/@a"),
    ).not.toContain("recommend-video-list");
    expect(tiktokVideoId("https://www.tiktok.com/@a/video/123?share=1")).toBe(
      "123",
    );
    expect(tiktokVideoId("https://tiktok.com/@a/video/456")).toBe("456");
    expect(
      tiktokVideoId("https://evil-tiktok.com/@a/video/123"),
    ).toBeUndefined();
    expect(tiktokVideoId("https://tiktok.com/@a")).toBeUndefined();
  });
  it("migrates an active old video block once into the main site control", () => {
    const old = createDefaultState();
    old.feedSettings.sites.tiktok.videos = true;
    const migrated = migrateState(old);
    expect(
      evaluatePolicy(migrated, "https://tiktok.com/", Date.now()).reasons,
    ).toContain("site-blocked");
    expect(migrated.feedSettings.sites.tiktok.videos).toBeUndefined();
    migrated.rules.find((r) => r.id === "tiktok")!.blocked = false;
    expect(
      migrateState(migrated).rules.find((r) => r.id === "tiktok")!.blocked,
    ).toBe(false);
    old.feedSettings.globalEnabled = false;
    expect(
      migrateState(old).rules.find((r) => r.id === "tiktok")!.blocked,
    ).toBe(false);
  });
});
