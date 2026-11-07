// Deterministic PNG exports of the ScreenFry clock mark. Runs on any OS: `npm run icons`.
// Source of truth is the SVG built below; the committed SVGs in apps/extension/public/icons
// are written from the same strings so designers can open them directly.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = resolve(import.meta.dirname, "..");
const publicIcons = join(root, "apps/extension/public/icons");
const appIcons = join(
  root,
  "safari/Screentime/Screentime/Assets.xcassets/AppIcon.appiconset",
);
const brandIcon = join(root, "safari/Screentime/Screentime/BrandIcon.png");
mkdirSync(publicIcons, { recursive: true });
mkdirSync(appIcons, { recursive: true });

const clock = `
  <circle cx="512" cy="512" r="236" fill="#fff" fill-opacity=".12"/>
  <circle cx="512" cy="512" r="236" fill="none" stroke="#fff" stroke-width="58"/>
  <g fill="#fff">
    <circle cx="512" cy="338" r="15"/><circle cx="686" cy="512" r="15"/>
    <circle cx="512" cy="686" r="15"/><circle cx="338" cy="512" r="15"/>
  </g>
  <path d="M512 382V512l104 62" fill="none" stroke="#fff" stroke-width="54"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="512" cy="512" r="34" fill="#fff"/>`;

const defs = `
  <defs>
    <linearGradient id="ember" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff9a3c"/>
      <stop offset=".55" stop-color="#f4621f"/>
      <stop offset="1" stop-color="#d63a16"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
      <stop offset=".5" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity=".28"/>
    </filter>
  </defs>`;

/** Apple's macOS grid: an 824pt rounded square centered on a 1024pt canvas, with a soft shadow. */
const gridIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}
  <g filter="url(#shadow)">
    <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#ember)"/>
  </g>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#gloss)"/>
  <g transform="translate(512 512) scale(.86) translate(-512 -512)">${clock}</g>
</svg>`;

/** Full-bleed version for 16 and 32 px, where the grid margin would make the mark unreadable. */
const smallIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${defs}
  <rect width="1024" height="1024" rx="230" fill="url(#ember)"/>
  <g transform="translate(512 512) scale(1.12) translate(-512 -512)">${clock
    .replace(/stroke-width="58"/, 'stroke-width="80"')
    .replace(/stroke-width="54"/, 'stroke-width="76"')
    .replace(/<g fill="#fff">[\s\S]*?<\/g>/, "")}</g>
</svg>`;

/** Monochrome toolbar mark; unchanged shape so the pinned Safari/Chrome button keeps its look. */
const toolbarIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g fill="none" stroke="#000" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="32" cy="32" r="24"/>
    <path d="M32 17v16l11 6"/>
  </g>
</svg>`;

const png = (svg, size) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
const iconFor = (size) => png(size <= 32 ? smallIcon : gridIcon, size);

writeFileSync(join(publicIcons, "logo.svg"), gridIcon.trim() + "\n");
writeFileSync(join(publicIcons, "toolbar.svg"), toolbarIcon.trim() + "\n");
for (const size of [16, 32, 48, 64, 96, 128, 256, 512, 1024])
  writeFileSync(join(publicIcons, `icon-${size}.png`), iconFor(size));
for (const size of [16, 19, 24, 32, 38, 48, 64])
  writeFileSync(join(publicIcons, `toolbar-${size}.png`), png(toolbarIcon, size));

const images = [];
for (const points of [16, 32, 128, 256, 512])
  for (const scale of [1, 2]) {
    const filename = `appicon-${points}@${scale}x.png`;
    writeFileSync(join(appIcons, filename), iconFor(points * scale));
    images.push({ filename, idiom: "mac", scale: `${scale}x`, size: `${points}x${points}` });
  }
writeFileSync(
  join(appIcons, "Contents.json"),
  JSON.stringify({ images, info: { author: "xcode", version: 1 } }, null, 2) + "\n",
);
// Bundled copy the containing app sets as its Dock icon at launch, so a stale
// LaunchServices icon cache can't leave the Dock showing the generic placeholder.
writeFileSync(brandIcon, png(gridIcon, 1024));
console.log("Generated extension, toolbar and macOS app icons.");
