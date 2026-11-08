// Deterministic exports of the user-supplied ScreenFry melting-monitor artwork.
// See assets/branding/README.md. Runs on any OS: `npm run icons`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(import.meta.dirname, "..");
const publicIcons = join(root, "apps/extension/public/icons");
const appIcons = join(
  root,
  "safari/ScreenFry/ScreenFry/Assets.xcassets/AppIcon.appiconset",
);
const brandIcon = join(root, "safari/ScreenFry/ScreenFry/BrandIcon.png");
mkdirSync(publicIcons, { recursive: true });
mkdirSync(appIcons, { recursive: true });

const artwork = readFileSync(join(root, "assets/branding/screenfry-source.png"));
// Center the solid mark in a square, trimming only the outer, near-transparent glow.
// The supplied PNG stays intact; every color export uses this same framing.
const logo = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="250 0 1024 1024">
  <image width="1536" height="1024" xlink:href="data:image/png;base64,${artwork.toString("base64")}"/>
</svg>`;

// Safari tints toolbar icons using their alpha channel. An outline counterpart keeps
// the melting monitor and clock legible at 16 px, in both light and dark toolbars.
const toolbar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g fill="none" stroke="#000" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 9h34a7 7 0 0 1 7 7v21c0 4-3 6-5 6v7a3 3 0 0 1-6 0v-6c0-3-5-3-5 0v8a3 3 0 0 1-6 0v-5c0-4-4-5-8-5H15a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7Z"/>
    <path d="M20 43v10h-5m5 0h10M32 18v9l8 5"/>
    <path d="M17 27h2m26 0h2m-15 9v1" stroke-width="3"/>
  </g>
</svg>`;

// Chrome draws toolbar icons exactly as supplied, so a black outline vanishes on dark or
// colored toolbars. Chrome gets this solid ember version; Safari keeps the tinted outline.
const toolbarColor = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="ember" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#e2461a"/></linearGradient></defs>
  <path d="M15 9h34a7 7 0 0 1 7 7v21c0 4-3 6-5 6v7a3 3 0 0 1-6 0v-6c0-3-5-3-5 0v8a3 3 0 0 1-6 0v-5c0-4-4-5-8-5H15a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7Z" fill="url(#ember)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" paint-order="stroke"/>
  <path d="M20 43v10h-5m5 0h10" fill="none" stroke="#e2461a" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M32 17v10l8 5" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M17 27h2m26 0h2" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
</svg>`;

const png = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
writeFileSync(join(publicIcons, "logo.svg"), logo.trim() + "\n");
writeFileSync(join(publicIcons, "toolbar.svg"), toolbar.trim() + "\n");
writeFileSync(join(publicIcons, "toolbar-color.svg"), toolbarColor.trim() + "\n");
for (const size of [16, 32, 48, 64, 96, 128, 256, 512, 1024])
  writeFileSync(join(publicIcons, `icon-${size}.png`), png(logo, size));
for (const size of [16, 19, 24, 32, 38, 48, 64])
{
  writeFileSync(join(publicIcons, `toolbar-${size}.png`), png(toolbar, size));
  writeFileSync(join(publicIcons, `toolbar-color-${size}.png`), png(toolbarColor, size));
}

const images = [];
for (const points of [16, 32, 128, 256, 512])
  for (const scale of [1, 2]) {
    const filename = `appicon-${points}@${scale}x.png`;
    writeFileSync(join(appIcons, filename), png(logo, points * scale));
    images.push({ filename, idiom: "mac", scale: `${scale}x`, size: `${points}x${points}` });
  }
writeFileSync(
  join(appIcons, "Contents.json"),
  JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2) + "\n",
);
// Dock and setup-window fallback for installations with a stale LaunchServices cache.
writeFileSync(brandIcon, png(logo, 1024));
console.log("Generated ScreenFry melting-monitor extension, toolbar and macOS icons.");
