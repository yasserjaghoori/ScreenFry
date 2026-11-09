// Writes dist/chrome/build.json: a fingerprint of every file in the build. The Mac app
// refreshes Chrome's unpacked copy when it changes, and the extension reloads itself, so
// rebuilds without a version bump still reach Chrome. Identical builds get the same id.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/chrome/", import.meta.url));
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (relative(dist, path) !== "build.json") files.push(path);
  }
})(dist);
const hash = createHash("sha256");
for (const path of files.map((p) => relative(dist, p).split("\\").join("/")).sort())
  hash.update(path).update("\0").update(readFileSync(join(dist, path))).update("\0");
const build = hash.digest("hex").slice(0, 16);
writeFileSync(join(dist, "build.json"), `${JSON.stringify({ build })}\n`);
console.log(`Build ${build}`);
