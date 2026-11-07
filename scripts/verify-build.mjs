// Guards build invariants that break the extension silently if violated.
import { readFileSync, existsSync } from "node:fs";

const dist = new URL("../dist/chrome/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), "utf8");
const errors = [];

const manifest = JSON.parse(read("manifest.json"));
for (const file of [
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((entry) => entry.js),
  manifest.action.default_popup,
  "blocked.html",
  "onboarding.html",
  "dashboard.html",
  "THIRD_PARTY_NOTICES.txt",
]) {
  if (!existsSync(new URL(file, dist))) errors.push(`missing ${file}`);
}
const content = read("assets/content.js");
if (
  /^\s*import[\s{*]|\bimport\s*\(/m.test(content) ||
  /^export\s/m.test(content)
)
  errors.push("content.js must be a classic script without import/export");
if (
  /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(
    read(manifest.background.service_worker) + content,
  )
)
  errors.push("background/content must not make network requests");

if (errors.length) {
  console.error(`Build verification failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("Build verification passed.");
