import { describe, expect, it } from "vitest";
import { feedDefaults } from "@core/defaults";
import { isValidDomain } from "@core/domains";
import { defaultRules, launchSites } from "@core/sites";
import {
  shortFormBlock,
  shortFormLabels,
  siteDefinitions,
  siteFor,
} from "@feeds/index";

/** Guards the single site registry so a new website can't be added half-configured. */
describe("site registry", () => {
  it.each(siteDefinitions.map((s) => [s.name, s] as const))(
    "%s is complete and wired everywhere",
    (_name, site) => {
      expect(site.domains.length).toBeGreaterThan(0);
      for (const domain of site.domains)
        expect(isValidDomain(domain)).toBe(true);
      expect(site.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect([...site.symbol].length).toBe(1);
      expect(Object.keys(site.elements).length).toBeGreaterThan(0);
      expect(siteFor(site.domains[0])?.site).toBe(site.site);
      expect(launchSites.map((s) => s.id)).toContain(site.site);
      expect(defaultRules().map((r) => r.id)).toContain(site.site);
      expect(Object.keys(feedDefaults.sites[site.site])).toEqual(
        Object.keys(site.elements),
      );
      if (site.shortForm) {
        expect(site.elements[site.shortForm.setting]).toBeDefined();
        expect(site.shortForm.playerSelectors.length).toBeGreaterThan(0);
        expect(shortFormLabels).toContain(site.shortForm.label);
      }
    },
  );

  it("has unique ids and non-overlapping domains", () => {
    const ids = siteDefinitions.map((s) => s.site);
    expect(new Set(ids).size).toBe(ids.length);
    const domains = siteDefinitions.flatMap((s) => s.domains);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("blocks each short-form URL only when its own setting is on", () => {
    for (const site of siteDefinitions.filter((s) => s.shortForm)) {
      const short = site.shortForm!;
      const url = `https://${site.domains[0]}${short.examplePath}`;
      const off = structuredClone(feedDefaults);
      const on = structuredClone(feedDefaults);
      on.sites[site.site][short.setting] = true;
      expect(shortFormBlock(off, url)).toBeUndefined();
      expect(shortFormBlock(on, url)).toBe(short.label);
      expect(shortFormBlock(on, `https://${site.domains[0]}/`)).toBeUndefined();
    }
  });
});
