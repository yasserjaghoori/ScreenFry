import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sectionFor, toHtml } from "../scripts/release-notes.mjs";

const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("release notes", () => {
  it("has notes for the current version, and a place for the next one", () => {
    expect(sectionFor(changelog, version)).toBeTruthy();
    expect(sectionFor(changelog, "Unreleased")).toBeTruthy();
  });

  it("stops at the next version and becomes an embeddable HTML list", () => {
    const sample = "## 1.1\n\n- **New** <thing> & `code`\n- Two\n\nAfter.\n\n## 1.0\n\n- Old";
    const section = sectionFor(sample, "1.1")!;
    expect(section).not.toContain("Old");
    const html = toHtml(section);
    expect(html).toBe(
      "<ul>\n<li><strong>New</strong> &lt;thing&gt; &amp; <code>code</code></li>\n<li>Two</li>\n</ul>\n<p>After.</p>",
    );
    // Sparkle embeds notes only without these.
    expect(html).not.toMatch(/<!DOCTYPE|<body/i);
    expect(sectionFor(sample, "2.0")).toBeUndefined();
  });
});
