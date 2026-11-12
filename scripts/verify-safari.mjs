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
const plist2 = (xml) =>
  JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: xml, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }));
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
const appInfo = plist(join(app, "Contents/Info.plist"));
// The Mac App Store edition (docs/MAC_APP_STORE.md): sandboxed, updated by the App Store, and
// Chrome's ScreenFry comes from the Chrome Web Store, so no Sparkle and no unpacked folder.
const appStore = appInfo.ScreenFryChannel === "appstore";
const chromeDir = join(app, "Contents/Resources/ChromeExtension");
if (appStore) {
  if (existsSync(chromeDir)) errors.push("the Mac App Store app must not carry the unpacked Chrome extension");
  if (existsSync(join(app, "Contents/Frameworks/Sparkle.framework")))
    errors.push("the Mac App Store app must not embed Sparkle");
  if (appInfo.SUFeedURL) errors.push("the Mac App Store app must not have an update feed");
  const signed = (path) => {
    try {
      const xml = execFileSync("/usr/bin/codesign", ["-d", "--entitlements", "-", "--xml", path], { stdio: ["ignore", "pipe", "ignore"] });
      return xml.length ? plist2(xml) : null;
    } catch {
      return null; // unsigned (CI's compile check)
    }
  };
  for (const [path, name] of [[app, "app"], [extension, "Safari extension"]]) {
    const entitlements = signed(path);
    if (!entitlements) continue;
    if (entitlements["com.apple.security.app-sandbox"] !== true) errors.push(`the Mac App Store ${name} must be sandboxed`);
    if (!entitlements["com.apple.security.application-groups"]?.includes(appInfo.ScreenFryAppGroup))
      errors.push(`the Mac App Store ${name} must be in the App Group ${appInfo.ScreenFryAppGroup}`);
  }
  if (plist(join(extension, "Contents/Info.plist")).ScreenFryAppGroup !== appInfo.ScreenFryAppGroup)
    errors.push("the Safari extension must name the same App Group as the app");
} else if (!existsSync(join(chromeDir, "manifest.json")))
  errors.push("missing bundled Chrome extension");
else {
  const chrome = JSON.parse(readFileSync(join(chromeDir, "manifest.json"), "utf8"));
  if (!chrome.background?.service_worker)
    errors.push("bundled Chrome extension must keep its service worker");
}
if (!appStore && !existsSync(join(app, "Contents/Frameworks/Sparkle.framework")))
  errors.push("Sparkle updater framework is not embedded");
if (typeof appInfo.ScreenFryShowSafariDeveloperSetup !== "boolean")
  errors.push("Safari developer-setup switch is missing");
for (const image of ["ChromeDeveloperModeOff.png", "ChromeDeveloperModeOn.png"]) {
  if (!existsSync(join(app, "Contents/Resources", image)))
    errors.push(`missing Chrome setup screenshot ${image}`);
}
// Each flavor (docs/DISTRIBUTION.md) updates from its own feed, so it never turns into the other.
const feeds = { official: "appcast.xml", developer: "appcast-developer.xml" };
if (appStore) {
  /* updated by the App Store, checked above */
} else if (!(appInfo.ScreenFryChannel in feeds))
  errors.push(`unknown ScreenFryChannel ${appInfo.ScreenFryChannel}`);
else if (!(appInfo.SUFeedURL ?? "").startsWith("https://github.com/") || !appInfo.SUFeedURL.endsWith(`/${feeds[appInfo.ScreenFryChannel]}`))
  errors.push(`update feed URL ${appInfo.SUFeedURL} doesn't match the ${appInfo.ScreenFryChannel} flavor`);
const displayNames = { official: "ScreenFry", developer: "ScreenFry Developer", appstore: "ScreenFry" };
if (appInfo.ScreenFryChannel in displayNames && appInfo.CFBundleDisplayName !== displayNames[appInfo.ScreenFryChannel])
  errors.push(`display name ${appInfo.CFBundleDisplayName} doesn't match the ${appInfo.ScreenFryChannel} flavor`);
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
  // ScreenFry Developer uses the greyed AppIconDeveloper set.
  const iconName = appInfo.ScreenFryChannel === "developer" ? "AppIconDeveloper" : "AppIcon";
  if (appInfo.CFBundleIconName !== iconName || !existsSync(join(app, `Contents/Resources/${iconName}.icns`)))
    errors.push(`missing native app icon ${iconName}`);
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
    (!appStore && chromeVersion !== packageVersion)
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
