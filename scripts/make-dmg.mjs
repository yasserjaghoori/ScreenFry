// Builds the drag-to-Applications download: dist/ScreenFry-<version>.dmg (macOS only).
//   npm run dmg -- [path/to/ScreenFry.app]
// The window shows ScreenFry beside an Applications shortcut over assets/dmg/background.png.
// Dropping a newer ScreenFry onto Applications replaces the old one; bundle identifiers never
// change, so Safari keeps the extension and its settings, and the app refreshes Chrome's copy.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (process.platform !== "darwin") {
  console.error("make-dmg runs on macOS (it uses hdiutil).");
  process.exit(1);
}
const root = resolve(import.meta.dirname, "..");
const app = resolve(process.argv[2] ?? "dist/safari/Build/Products/Release/ScreenFry.app");
if (!existsSync(app)) {
  console.error(`No app at ${app}. Build it first (see docs/DISTRIBUTION.md).`);
  process.exit(1);
}
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = join(root, "dist", `ScreenFry-${version}.dmg`);
rmSync(out, { force: true });

const work = mkdtempSync(join(tmpdir(), "screenfry-dmg-"));
try {
  // Preferred: appdmg writes the window layout and background without needing Finder.
  const spec = join(work, "spec.json");
  writeFileSync(
    spec,
    JSON.stringify({
      title: "ScreenFry",
      icon: join(root, "apps/extension/public/icons/icon-512.png"),
      background: join(root, "assets/dmg/background.png"),
      "icon-size": 112,
      window: { size: { width: 660, height: 400 } },
      contents: [
        { x: 170, y: 190, type: "file", path: app },
        { x: 490, y: 190, type: "link", path: "/Applications" },
      ],
      format: "UDZO",
    }),
  );
  try {
    execFileSync("npx", ["--yes", "appdmg@0.6.6", spec, out], { stdio: "inherit" });
  } catch {
    // Fallback: a plain image with the app and an Applications shortcut (no background).
    console.warn("appdmg failed; building a plain disk image instead.");
    const staging = join(work, "staging");
    cpSync(app, join(staging, "ScreenFry.app"), { recursive: true, verbatimSymlinks: true });
    symlinkSync("/Applications", join(staging, "Applications"));
    execFileSync("hdiutil", ["create", "-volname", "ScreenFry", "-srcfolder", staging, "-ov", "-format", "UDZO", out], {
      stdio: "inherit",
    });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`Built ${out}`);
