import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extensionPageUrl,
  networkBlockAction,
  networkResourceTypes,
} from "@browser/urls";

afterEach(() => vi.unstubAllGlobals());

describe("extension navigation addresses", () => {
  it.each(["chrome-extension", "safari-web-extension"])(
    "preserves the blocked target's query and fragment on %s",
    (scheme) => {
      const getURL = vi.fn(
        (path: string) => `${scheme}://extension-id/${path}`,
      );
      vi.stubGlobal("chrome", { runtime: { getURL } });
      const target =
        "https://www.youtube.com/shorts/test?feature=share&name=a%20b#part";
      const result = new URL(
        extensionPageUrl("blocked.html", {
          url: target,
          label: "YouTube Shorts",
        }),
      );
      expect(getURL).toHaveBeenCalledExactlyOnceWith("blocked.html");
      expect(result.pathname).toBe("/blocked.html");
      expect(result.searchParams.get("url")).toBe(target);
      expect(result.searchParams.get("label")).toBe("YouTube Shorts");
      expect(result.hash).toBe("");
    },
  );

  it("keeps a popup's selected site and section out of the resource path", () => {
    const getURL = vi.fn(
      (path: string) => `safari-web-extension://extension-id/${path}`,
    );
    vi.stubGlobal("chrome", { runtime: { getURL } });
    const result = new URL(
      extensionPageUrl("dashboard.html", { site: "instagram" }, "windows"),
    );
    expect(getURL).toHaveBeenCalledExactlyOnceWith("dashboard.html");
    expect(result.searchParams.get("site")).toBe("instagram");
    expect(result.hash).toBe("#windows");
  });

  it("blocks Safari requests without constructing a cross-scheme network redirect", () => {
    expect(networkBlockAction("safari", "YouTube Shorts")).toEqual({
      type: "block",
    });
  });

  it("leaves whole Safari pages to tab enforcement so its error page never appears", () => {
    expect(networkResourceTypes("safari")).toEqual(["sub_frame"]);
    expect(networkResourceTypes("chrome")).toEqual(["main_frame", "sub_frame"]);
  });

  it("retains Chrome's complete original-target substitution", () => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      },
    });
    expect(networkBlockAction("chrome", "YouTube Shorts")).toEqual({
      type: "redirect",
      redirect: {
        regexSubstitution:
          "chrome-extension://extension-id/blocked.html?label=YouTube+Shorts&source=network&url=\\1",
      },
    });
  });
});
