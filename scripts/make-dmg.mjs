// Builds the drag-to-Applications download: dist/ScreenFry-<version>.dmg (macOS only).
//   npm run dmg -- [path/to/ScreenFry.app]
// The window shows ScreenFry beside an Applications shortcut over assets/dmg/background.png.
// Dropping a newer ScreenFry onto Applications replaces the old one; bundle identifiers never
// change, so Safari keeps the extension and its settings, and the app refreshes Chrome's copy.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, cpSync } from "node:fs";
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
  // appdmg sometimes fails to detach its working image on GitHub's Macs ("hdiutil detach
  // failed"), which once shipped a plain installer (0.7.4). Clear leftover ScreenFry volumes
  // and try a few times; a release must never fall back to the plain image.
  const detachStale = () => {
    for (const volume of readdirSync("/Volumes").filter((v) => v.startsWith("ScreenFry"))) {
      try {
        execFileSync("hdiutil", ["detach", "-force", join("/Volumes", volume)], { stdio: "ignore" });
      } catch {
        /* not ours or already gone */
      }
    }
  };
  let laidOut = false;
  for (let attempt = 1; attempt <= 3 && !laidOut; attempt++) {
    detachStale();
    rmSync(out, { force: true });
    try {
      execFileSync("npx", ["--yes", "appdmg@0.6.6", spec, out], { stdio: "inherit" });
      laidOut = true;
    } catch {
      console.warn(`appdmg attempt ${attempt} failed.`);
      execFileSync("sleep", ["5"]);
    }
  }
  if (laidOut) verifyLayout(out);
  else {
    if (process.env.CI) {
      console.error("appdmg failed three times; not shipping an installer without its window layout.");
      process.exit(1);
    }
    // Local builds only: a plain image with the app and an Applications shortcut.
    console.warn("appdmg failed; building a plain disk image instead (local builds only).");
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

/** The installer must carry its background and window layout (Finder's .DS_Store). */
function verifyLayout(dmg) {
  const mount = mkdtempSync(join(tmpdir(), "screenfry-dmg-check-"));
  execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmg], { stdio: "ignore" });
  try {
    const missing = [".background", ".DS_Store", "ScreenFry.app", "Applications"].filter(
      (name) => !existsSync(join(mount, name)),
    );
    if (missing.length) {
      console.error(`The installer is missing ${missing.join(", ")}.`);
      process.exit(1);
    }
  } finally {
    execFileSync("hdiutil", ["detach", mount], { stdio: "ignore" });
    rmSync(mount, { recursive: true, force: true });
  }
}
