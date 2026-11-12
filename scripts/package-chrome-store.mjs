#!/usr/bin/env node
// Packages the built Chrome extension (dist/chrome, from `npm run build`) for the Chrome Web
// Store: dist/ScreenFry-chrome-store-<version>.zip, with the manifest checked for what the store
// rejects or replaces. Upload the zip in the developer dashboard (store/chrome-web-store.md).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = join(root, "dist/chrome");
const manifestPath = join(dir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("No dist/chrome build. Run `npm run build` first.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const problems = [];
// The store assigns the ID and the update URL itself.
if (manifest.key) problems.push("manifest has a `key` (the store assigns the ID)");
if (manifest.update_url) problems.push("manifest has an `update_url` (the store sets it)");
if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`version ${manifest.version} isn't 1–4 dot-separated numbers`);
if ((manifest.description ?? "").length > 132) problems.push("description is over 132 characters");
if (!manifest.icons?.["128"]) problems.push("needs a 128px icon");
if (problems.length) {
  console.error(`Not ready for the Chrome Web Store:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

const zip = join(root, "dist", `ScreenFry-chrome-store-${manifest.version}.zip`);
rmSync(zip, { force: true });
// Everything in the build, without macOS clutter.
execFileSync("zip", ["-r", "-X", "-q", zip, ".", "-x", ".DS_Store", "-x", "*/.DS_Store"], { cwd: dir });
console.log(`Wrote ${zip}`);
