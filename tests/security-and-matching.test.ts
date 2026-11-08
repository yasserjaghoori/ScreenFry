import { describe, expect, it } from "vitest";
import {
  expandDomainAliases,
  hostMatchesDomain,
  isValidDomain,
  normalizeDomain,
  urlMatchesDomains,
} from "@core/domains";
import {
  createPasswordVerifier,
  failedPasswordAttempt,
  verifyPassword,
} from "@core/password";
import {
  activeSelectors,
  buildBlockingCss,
  shortFormBlock,
} from "@feeds/index";
import { feedDefaults } from "@core/defaults";
import type { FeedSettings } from "@shared/index";

describe("optional password verifier", () => {
  it("uses salted slow hashing for ordinary passwords and compares the verifier", async () => {
    const password = "my settings password",
      record = await createPasswordVerifier(password),
      again = await createPasswordVerifier(password);
    expect(record.iterations).toBeGreaterThanOrEqual(300_000);
    expect(record.salt).not.toBe(again.salt);
    expect(record.verifier).not.toBe(again.verifier);
    expect(JSON.stringify(record)).not.toContain(password);
    expect(await verifyPassword(password, record)).toBe(true);
    expect(await verifyPassword("incorrect", record)).toBe(false);
  });
  it("escalates incorrect attempts without requiring a mandatory password", () => {
    expect(
      failedPasswordAttempt({ failedAttempts: 1 }, 1000).cooldownUntil,
    ).toBeUndefined();
    expect(
      failedPasswordAttempt({ failedAttempts: 2 }, 1000).cooldownUntil,
    ).toBe(31000);
    expect(
      failedPasswordAttempt({ failedAttempts: 99 }, 1000).cooldownUntil,
    ).toBe(3601000);
  });
});

describe("URL matching", () => {
  it("normalizes domains and avoids lookalike hosts", () => {
    expect(normalizeDomain("https://www.YouTube.com/watch?v=x")).toBe(
      "youtube.com",
    );
    expect(normalizeDomain(" reddit.com/r/all ")).toBe("reddit.com");
    expect(hostMatchesDomain("m.youtube.com", "youtube.com")).toBe(true);
    expect(hostMatchesDomain("notyoutube.com", "youtube.com")).toBe(false);
    expect(urlMatchesDomains("chrome://extensions", ["youtube.com"])).toBe(
      false,
    );
    expect(
      urlMatchesDomains("https://user@youtube.com:8443/x", ["youtube.com"]),
    ).toBe(true);
    expect(isValidDomain("youtube.com")).toBe(true);
    expect(isValidDomain("youtube")).toBe(false);
  });

  it("expands product aliases without touching shared Google infrastructure", () => {
    const youtube = expandDomainAliases(["youtube.com"]);
    expect(youtube).toEqual(
      expect.arrayContaining([
        "youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
      ]),
    );
    expect(
      youtube.some((domain) => /(^|\.)google\.com$|googlevideo/.test(domain)),
    ).toBe(false);
    expect(
      urlMatchesDomains("https://www.google.com/search?q=youtube", youtube),
    ).toBe(false);
    expect(urlMatchesDomains("https://mail.google.com", youtube)).toBe(false);
    expect(expandDomainAliases(["twitter.com"])).toEqual([
      "x.com",
      "twitter.com",
    ]);
    expect(expandDomainAliases(["music.youtube.com"])).toEqual([
      "music.youtube.com",
    ]);
  });
});

describe("per-site feed and button controls", () => {
  const settings = (): FeedSettings => {
    const s = structuredClone(feedDefaults);
    s.sites.youtube = {
      ...s.sites.youtube,
      home: true,
      shorts: true,
      recommendations: true,
    };
    s.sites.x = { ...s.sites.x, forYou: true };
    s.sites.instagram = { ...s.sites.instagram, home: true, reels: true };
    s.sites.reddit = { ...s.sites.reddit, home: true, popular: true };
    s.sites.substack = { ...s.sites.substack, home: true, notes: true };
    return s;
  };
  it("applies only selected controls and respects the global switch", () => {
    const s = settings();
    expect(buildBlockingCss(s, "https://youtube.com")).toContain(
      'page-subtype="home"',
    );
    expect(buildBlockingCss(s, "https://youtube.com")).not.toContain(
      "ytd-comments#comments",
    );
    expect(
      buildBlockingCss({ ...s, globalEnabled: false }, "https://youtube.com"),
    ).toBe("");
    expect(buildBlockingCss(s, "https://example.com")).toBe("");
  });
  it("preserves direct posts, profiles, search and channel pages unless their own control is enabled", () => {
    const s = settings();
    expect(
      activeSelectors(s, "https://youtube.com/@channel/videos").join(),
    ).not.toContain('page-subtype="home"');
    expect(
      activeSelectors(s, "https://youtube.com/results?search_query=x").join(),
    ).not.toContain('page-subtype="home"');
    expect(
      activeSelectors(s, "https://reddit.com/r/typescript").join(),
    ).not.toContain("shreddit-feed");
    expect(
      activeSelectors(s, "https://reddit.com/r/a/comments/post/title").join(),
    ).not.toContain("shreddit-feed");
    expect(
      activeSelectors(s, "https://instagram.com/someone").join(),
    ).not.toContain('main[role="main"]');
    expect(
      activeSelectors(s, "https://substack.com/@author/p/article").join(),
    ).not.toContain("main > div");
    expect(
      activeSelectors(s, "https://author.substack.com/p/article").join(),
    ).not.toContain("main > div");
    expect(activeSelectors(s, "https://substack.com/notes").join()).toContain(
      "main > div",
    );
  });
  it("separates X home feeds and Instagram button hiding from playback blocking", () => {
    const s = settings();
    expect(activeSelectors(s, "https://x.com/home").join()).toContain(
      'data-screenfry-x-tab="0"',
    );
    expect(activeSelectors(s, "https://x.com/home").join()).not.toContain(
      'data-screenfry-x-tab="1"',
    );
    s.sites.instagram.reels = false;
    s.sites.instagram.reelsButton = true;
    expect(buildBlockingCss(s, "https://instagram.com")).toContain(
      'a[href="/reels/"]',
    );
    expect(shortFormBlock(s, "https://instagram.com/reel/abc")).toBeUndefined();
  });
  it("blocks short-form URLs entirely instead of rewriting them to a watch URL", () => {
    const s = settings();
    expect(
      shortFormBlock(s, "https://youtube.com/shorts/abc?feature=share"),
    ).toBe("YouTube Shorts");
    expect(shortFormBlock(s, "https://instagram.com/reel/abc")).toBe(
      "Instagram Reels",
    );
    expect(
      shortFormBlock(s, "https://youtube.com/watch?v=abc"),
    ).toBeUndefined();
    s.sites.youtube.shorts = false;
    expect(shortFormBlock(s, "https://youtube.com/shorts/abc")).toBeUndefined();
    expect(
      shortFormBlock(
        { ...settings(), globalEnabled: false },
        "https://youtube.com/shorts/abc",
      ),
    ).toBeUndefined();
  });
});
