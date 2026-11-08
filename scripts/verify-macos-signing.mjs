// Signature validity alone does not establish that dyld can load embedded frameworks.
// Run on a signed app, not the intentionally unsigned Safari packaging job.
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const app = resolve(process.argv[2] ?? "dist/safari/Build/Products/Release/ScreenFry.app");
// codesign writes its display metadata to stderr, even on success.
function metadata(path) {
  const result = spawnSync("codesign", ["-d", "--verbose=4", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Unable to read a bundle's signature.");
  const team = /^TeamIdentifier=(.+)$/m.exec(result.stderr)?.[1];
  return {
    team: team && team !== "not set" ? team : undefined,
    runtime: /CodeDirectory[^\n]*\bruntime\b/.test(result.stderr),
  };
}

try {
  execFileSync("codesign", ["--verify", "--deep", "--strict", "--all-architectures", app], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const main = metadata(app);
  if (main.runtime) {
    if (!main.team)
      throw new Error("Hardened-runtime app has no Team ID. Sparkle cannot load under library validation. Use an Apple Development/Developer ID signature; CI test downloads must use their non-hardened test configuration.");
    for (const item of readdirSync(join(app, "Contents/Frameworks"), { withFileTypes: true })) {
      if (!item.name.endsWith(".framework")) continue;
      const framework = metadata(join(app, "Contents/Frameworks", item.name));
      if (framework.team !== main.team)
        throw new Error(`${item.name} is not signed by the app's team; library validation will reject it.`);
    }
  }
  console.log(`Mac signing verified (${main.runtime ? "hardened, matching framework team" : "non-hardened test build"}).`);
} catch (error) {
  console.error(`Mac signing verification failed: ${error instanceof Error ? error.message : "invalid signature"}`);
  process.exit(1);
}
