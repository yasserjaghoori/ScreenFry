import { describe, expect, it } from "vitest";
import { createDefaultState, migrateState } from "@core/defaults";
import {
  activeShortForm,
  buildBlockingCss,
  researchMode,
  shortFormBlock,
  siteDefinitions,
  siteFor,
} from "@feeds/index";

const id = (href: string) => {
  const url = new URL(href);
  return siteFor(url.hostname)!.research!.videoId(url);
};

describe("research mode", () => {
  it("is offered under every block-entirely switch, and on its own for TikTok", () => {
    for (const site of siteDefinitions.filter((s) => s.shortForm)) {
      const research = site.research!;
      expect(research.requires).toBe(site.shortForm!.setting);
      const element = site.elements[research.setting];
      expect(element.requires).toBe(site.shortForm!.setting);
      expect(element.note).toMatch(/link/);
      // Listed right under the switch it loosens.
      const keys = Object.keys(site.elements);
      expect(keys.indexOf(research.setting)).toBe(keys.indexOf(research.requires!) + 1);
    }
    const tiktok = siteFor("tiktok.com")!;
    expect(tiktok.research?.setting).toBe("singleVideo");
    expect(tiktok.research?.requires).toBeUndefined();
  });

  it("knows which video an address is", () => {
    expect(id("https://www.youtube.com/shorts/abc?feature=share")).toBe("abc");
    expect(id("https://www.youtube.com/watch?v=abc")).toBeUndefined();
    expect(id("https://www.instagram.com/reel/C1x/")).toBe("C1x");
    expect(id("https://x.com/someone/status/123/video/1")).toBe("123");
    expect(id("https://x.com/someone/status/123")).toBeUndefined();
    expect(id("https://www.facebook.com/reel/987654")).toBe("987654");
    expect(id("https://www.tiktok.com/@a/video/42?is_from_webapp=1")).toBe("42");
    expect(id("https://www.tiktok.com/@a")).toBeUndefined();
  });

  it("only applies while the block it loosens is on", () => {
    const { feedSettings } = createDefaultState();
    feedSettings.sites.youtube.shortsFromLinks = true;
    expect(researchMode(feedSettings, "www.youtube.com")).toBeUndefined();
    feedSettings.sites.youtube.shorts = true;
    expect(researchMode(feedSettings, "www.youtube.com")?.setting).toBe("shortsFromLinks");
  });

  it("lets a linked Short's page through while Shorts stay hidden everywhere else", () => {
    const { feedSettings } = createDefaultState();
    feedSettings.sites.youtube.shorts = true;
    expect(shortFormBlock(feedSettings, "https://www.youtube.com/shorts/abc")).toBe("YouTube Shorts");
    expect(buildBlockingCss(feedSettings, "https://www.youtube.com/")).toContain("ytd-reel-shelf-renderer");

    feedSettings.sites.youtube.shortsFromLinks = true;
    // The content script decides Shorts pages itself, so no network redirect or policy block.
    expect(activeShortForm(feedSettings, "www.youtube.com")).toBeUndefined();
    expect(shortFormBlock(feedSettings, "https://www.youtube.com/shorts/abc")).toBeUndefined();
    const shortsPage = buildBlockingCss(feedSettings, "https://www.youtube.com/shorts/abc");
    expect(shortsPage).not.toContain("ytd-shorts{");
    expect(shortsPage).toContain("#navigation-button-down");
    // Shelves and buttons stay hidden on every other page.
    expect(buildBlockingCss(feedSettings, "https://www.youtube.com/")).toContain("ytd-reel-shelf-renderer");
  });
});

describe("renamed and removed controls", () => {
  it("carries Facebook's old Video button switch over to the Reels button", () => {
    const old = createDefaultState() as unknown as { feedSettings: { sites: Record<string, Record<string, boolean>> } };
    old.feedSettings.sites.facebook.videoButton = true;
    old.feedSettings.sites.substack.notesButton = true;
    const migrated = migrateState(old);
    expect(migrated.feedSettings.sites.facebook.reelsButton).toBe(true);
    expect(migrated.feedSettings.sites.facebook.videoButton).toBeUndefined();
    expect(migrated.feedSettings.sites.substack.notesButton).toBeUndefined();
  });

  it("hides Reddit's Recent Posts and Facebook's Groups button", () => {
    const { feedSettings } = createDefaultState();
    feedSettings.sites.reddit.recentPosts = true;
    feedSettings.sites.facebook.groupsButton = true;
    expect(buildBlockingCss(feedSettings, "https://www.reddit.com/")).toContain("recent-posts");
    expect(buildBlockingCss(feedSettings, "https://www.facebook.com/")).toContain('a[href^="/groups/"]');
  });
});
