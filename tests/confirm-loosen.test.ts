import { describe, expect, it } from "vitest";
import { loosenQuestion } from "../apps/extension/src/ui/ConfirmLoosen";
import { siteDefinitions } from "@feeds/index";

describe("loosen confirmation wording", () => {
  it("phrases each kind of switch as turning something back on", () => {
    expect(loosenQuestion("Hide home feed", "YouTube")).toBe("Bring back the home feed on YouTube?");
    expect(loosenQuestion("Block Shorts entirely", "YouTube")).toBe("Unblock Shorts on YouTube?");
    expect(loosenQuestion("Only play the linked video", "TikTok")).toBe(
      "Turn off “Only play the linked video” on TikTok?",
    );
  });
  it("reads naturally for every registered switch", () => {
    for (const site of siteDefinitions)
      for (const element of Object.values(site.elements)) {
        const question = loosenQuestion(element.label, site.name);
        expect(question).toMatch(/\?$/);
        expect(question).not.toMatch(/the the /i);
      }
  });
});
