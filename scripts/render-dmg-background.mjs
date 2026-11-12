#!/usr/bin/env node
// Renders the installer window's background (assets/dmg/background.svg) to background.png and
// background@2x.png, which scripts/make-dmg.mjs uses. Run after editing the SVG.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const dir = join(resolve(import.meta.dirname, ".."), "assets/dmg");
const svg = readFileSync(join(dir, "background.svg"), "utf8");
const width = Number(/width="(\d+)"/.exec(svg)[1]);
for (const [name, scale] of [["background.png", 1], ["background@2x.png", 2]]) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: width * scale },
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica Neue" },
  })
    .render()
    .asPng();
  writeFileSync(join(dir, name), png);
  console.log(`Wrote assets/dmg/${name}`);
}
