import { afterEach, describe, expect, it, vi } from "vitest";
import { isUnpackedChrome } from "@browser/platform";

afterEach(() => vi.unstubAllGlobals());

const stub = (scheme: string, getSelf: () => Promise<{ installType: string }>) =>
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `${scheme}://extension-id/${path}` },
    management: { getSelf },
  });

describe("which copies run ScreenFry's own update checks", () => {
  it("is the unpacked Chrome copy the Mac app keeps current", async () => {
    stub("chrome-extension", async () => ({ installType: "development" }));
    expect(await isUnpackedChrome()).toBe(true);
  });

  it.each(["normal", "admin", "sideload", "other"])(
    "leaves a %s Chrome install (Web Store and the like) to Chrome's updates",
    async (installType) => {
      stub("chrome-extension", async () => ({ installType }));
      expect(await isUnpackedChrome()).toBe(false);
    },
  );

  it("never applies to Safari or when Chrome can't say", async () => {
    stub("safari-web-extension", async () => ({ installType: "development" }));
    expect(await isUnpackedChrome()).toBe(false);
    stub("chrome-extension", () => Promise.reject(new Error("unavailable")));
    expect(await isUnpackedChrome()).toBe(false);
  });
});
