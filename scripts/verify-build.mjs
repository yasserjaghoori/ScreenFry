// Guards build invariants that break the extension silently if violated.
import { readFileSync, existsSync } from "node:fs";

const dist = new URL("../dist/chrome/", import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), "utf8");
const errors = [];

if (!/^\{"build":"[0-9a-f]{16}"\}\n$/.test(read("build.json")))
  errors.push("build.json must hold the build fingerprint (scripts/stamp-build.mjs)");

const manifest = JSON.parse(read("manifest.json"));
if (
  /declarativeNetRequest\.(?:RuleActionType|ResourceType)\./.test(
    read(manifest.background.service_worker),
  )
)
  errors.push("network rules must use portable schema strings, not Chrome runtime enums");
if (!manifest.permissions.includes("declarativeNetRequestWithHostAccess"))
  errors.push("redirect rules require declarativeNetRequestWithHostAccess in Safari");
for (const [purpose, icons] of Object.entries({
  extension: manifest.icons,
  toolbar: manifest.action.default_icon,
})) {
  if (!icons?.["16"] || !icons?.["32"])
    errors.push(`missing ${purpose} icon declarations`);
  for (const [size, path] of Object.entries(icons ?? {})) {
    const file = new URL(path, dist);
    if (!existsSync(file)) {
      errors.push(`missing ${purpose} icon ${path}`);
      continue;
    }
    const png = readFileSync(file);
    if (
      png.length < 24 ||
      png.subarray(1, 4).toString() !== "PNG" ||
      png.readUInt32BE(16) !== Number(size) ||
      png.readUInt32BE(20) !== Number(size)
    )
      errors.push(`incorrect PNG dimensions for ${path}`);
  }
}
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
// The only allowed fetches read ScreenFry's own packaged manifest.json and build.json (local
// extension files) to notice a newer build on disk; anything else would be a network request.
const ownManifestRead = /\bfetch\(\s*chrome\.runtime\.getURL\(\s*["'`](?:manifest|build)\.json["'`]\s*\)/g;
if (
  /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(
    (read(manifest.background.service_worker) + content).replace(ownManifestRead, ""),
  )
)
  errors.push("background/content must not make network requests");

if (errors.length) {
  console.error(`Build verification failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log("Build verification passed.");
