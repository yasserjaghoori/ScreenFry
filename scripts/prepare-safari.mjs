// Safari uses a nonpersistent module background page; Chrome retains its MV3 worker.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const manifestPath = resolve(
  import.meta.dirname,
  "../safari/Screentime/Screentime Extension/Resources/manifest.json",
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entry = manifest.background.service_worker;
if (!entry || !existsSync(resolve(dirname(manifestPath), entry)))
  throw new Error("Build the Chrome background entry before preparing Safari.");
manifest.background = { scripts: [entry], type: "module", persistent: false };
// Safari tints toolbar icons from their alpha channel, so it uses the monochrome outline;
// Chrome's manifest uses the solid color version, which reads on any toolbar color.
for (const size of Object.keys(manifest.action.default_icon))
  manifest.action.default_icon[size] = `icons/toolbar-${size}.png`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("Prepared Safari's nonpersistent module background page.");
