#!/usr/bin/env node
// A version's notes from CHANGELOG.md, for the update window and the GitHub release.
//   node scripts/release-notes.mjs 0.8.2 --html   an HTML fragment (Sparkle embeds it in the feed)
//   node scripts/release-notes.mjs 0.8.2 --md     Markdown (the GitHub release notes)
//   node scripts/release-notes.mjs 0.8.2          checks that the version has notes
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const changelogPath = fileURLToPath(new URL("../CHANGELOG.md", import.meta.url));

/** The lines under "## <version>", without blank lines at either end. */
export function sectionFor(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body || undefined;
}

const escape = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (text) =>
  escape(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");

/** Bullets become a list and other lines paragraphs; no DOCTYPE or body, so it's embedded. */
export function toHtml(section) {
  const out = [];
  let list = false;
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*] (.*)$/.exec(line);
    if (bullet && !list) out.push("<ul>");
    if (!bullet && list) out.push("</ul>");
    list = !!bullet;
    if (bullet) out.push(`<li>${inline(bullet[1])}</li>`);
    else if (line) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [version, format] = process.argv.slice(2);
  const section = version && sectionFor(readFileSync(changelogPath, "utf8"), version);
  if (!section) {
    console.error(
      `CHANGELOG.md has no "## ${version}" section. Rename "## Unreleased" to it before releasing.`,
    );
    process.exit(1);
  }
  if (format === "--html") console.log(toHtml(section));
  else if (format === "--md") console.log(section);
}
