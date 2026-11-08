// Checks the generated Safari package and the entitlement files XcodeGen actually writes.
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const app = resolve(
  process.argv[2] ?? "dist/safari/Build/Products/Debug/ScreenFry.app",
);
const extension = join(app, "Contents/PlugIns/ScreenFry Extension.appex");
const resources = join(extension, "Contents/Resources");
const plist = (path) =>
  JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], {
      encoding: "utf8",
    }),
  );
const errors = [];

// The Safari extension must stay sandboxed. The containing app is deliberately not
// sandboxed (it installs the Chrome folder and runs Sparkle updates).
if (
  plist(
    join(
      projectRoot,
      "safari/ScreenFry/ScreenFry Extension/ScreenFry Extension.entitlements",
    ),
  )["com.apple.security.app-sandbox"] !== true
)
  errors.push("the Safari extension lost its sandbox entitlement");
const chromeDir = join(app, "Contents/Resources/ChromeExtension");
if (!existsSync(join(chromeDir, "manifest.json")))
  errors.push("missing bundled Chrome extension");
else {
  const chrome = JSON.parse(readFileSync(join(chromeDir, "manifest.json"), "utf8"));
  if (!chrome.background?.service_worker)
    errors.push("bundled Chrome extension must keep its service worker");
}
if (!existsSync(join(app, "Contents/Frameworks/Sparkle.framework")))
  errors.push("Sparkle updater framework is not embedded");
const appInfo = plist(join(app, "Contents/Info.plist"));
if (typeof appInfo.ScreenFryShowSafariDeveloperSetup !== "boolean")
  errors.push("Safari developer-setup switch is missing");
for (const image of ["ChromeDeveloperModeOff.png", "ChromeDeveloperModeOn.png"]) {
  if (!existsSync(join(app, "Contents/Resources", image)))
    errors.push(`missing Chrome setup screenshot ${image}`);
}
if (!/^https:\/\/github\.com\/.+\/appcast\.xml$/.test(appInfo.SUFeedURL ?? ""))
  errors.push("update feed URL is missing");
const info = plist(join(extension, "Contents/Info.plist"));
if (
  info.NSExtension?.NSExtensionPointIdentifier !==
  "com.apple.Safari.web-extension"
)
  errors.push("incorrect extension point");
for (const file of [
  "manifest.json",
  "dashboard.html",
  "popup.html",
  "blocked.html",
  "onboarding.html",
  "THIRD_PARTY_NOTICES.txt",
]) {
  if (!existsSync(join(resources, file)))
    errors.push(`missing embedded ${file}`);
}
if (!errors.length) {
  const manifest = JSON.parse(
    readFileSync(join(resources, "manifest.json"), "utf8"),
  );
  if (!manifest.permissions.includes("declarativeNetRequestWithHostAccess"))
    errors.push("Safari redirect permission is missing");
  if (
    manifest.background?.service_worker ||
    manifest.background?.type !== "module" ||
    manifest.background?.persistent !== false ||
    manifest.background?.scripts?.length !== 1 ||
    !existsSync(
      join(resources, manifest.background?.scripts?.[0] ?? "missing-background"),
    )
  )
    errors.push("missing packaged Safari nonpersistent module background page");
  if (
    Object.values(manifest.action.default_icon ?? {}).some(
      (path) => !/^icons\/toolbar-\d+\.png$/.test(path),
    )
  )
    errors.push("Safari toolbar must use the monochrome outline icons it tints");
  for (const iconMap of [manifest.icons, manifest.action.default_icon]) {
    if (!iconMap?.["16"] || !iconMap?.["32"])
      errors.push("missing embedded icon declarations");
    for (const [size, path] of Object.entries(iconMap ?? {})) {
      if (!existsSync(join(resources, path))) {
        errors.push(`missing embedded icon ${path}`);
        continue;
      }
      const png = readFileSync(join(resources, path));
      if (
        png.length < 24 ||
        png.subarray(1, 4).toString() !== "PNG" ||
        png.readUInt32BE(16) !== Number(size) ||
        png.readUInt32BE(20) !== Number(size)
      )
        errors.push(`incorrect embedded PNG ${path}`);
    }
  }
  if (!existsSync(join(app, "Contents/Resources/AppIcon.icns")))
    errors.push("missing native app icon");
  if (!existsSync(join(app, "Contents/Resources/BrandIcon.png")))
    errors.push("missing bundled Dock icon");
  const packageVersion = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
  ).version;
  const chromeVersion = existsSync(join(chromeDir, "manifest.json"))
    ? JSON.parse(readFileSync(join(chromeDir, "manifest.json"), "utf8")).version
    : undefined;
  if (
    manifest.version !== packageVersion ||
    info.CFBundleShortVersionString !== packageVersion ||
    chromeVersion !== packageVersion
  )
    errors.push("Safari version does not match the package");
  if (
    !readFileSync(join(resources, "THIRD_PARTY_NOTICES.txt"), "utf8").includes(
      "Copyright (c) 2023 Tobias Dalhof",
    )
  )
    errors.push("upstream attribution missing");
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Safari packaging and generated sandbox entitlements verified.");
