# Adding a website

Every supported website is one entry in the site registry, `siteDefinitions` in `packages/feed-blockers/src/index.ts`. The Websites page, popup, Today panel, Windows picker, default rules, feed settings, network rules and short-form blocking all read from it.

## Steps

1. Add the site's id to `FeedSite` in `packages/shared-types/src/index.ts`, e.g. `| "tiktok"`.
2. Add one entry to `siteDefinitions`:

   ```ts
   {
     site: "tiktok",
     name: "TikTok",
     color: "#111111",      // avatar background
     symbol: "♪",           // one character shown in the avatar
     domains: ["tiktok.com"], // main domain first; aliases and embed domains after. Subdomains always match.
     shortForm: {           // optional: "Block … entirely"
       setting: "videos",   // must be a key in `elements`
       label: "TikTok videos",
       pathSegment: "@[^/]+/video",   // regex fragment for the first path segment(s)
       examplePath: "/@someone/video/123",
       playerSelectors: ['[data-e2e="feed-video"] video'], // players found without a matching URL
     },
     elements: {
       forYou: element("Hide For You feed", "Feeds", ['[data-e2e="recommend-list-item-container"]'], at("/", "/foryou"), true),
       videos: element("Block videos entirely", "Short-form video", ["video"], undefined, true),
     },
   },
   ```

   `element(label, group, selectors, when?, pauseMedia?)`: `group` becomes the section heading, `when` limits it to certain pages (`at("/")`), and `pauseMedia` also pauses matching players.
3. If the site has alias domains, also add them to `DOMAIN_ALIAS_GROUPS` in `packages/core/src/domains.ts`, so typed domains expand to all of them.
4. Update the test that asserts the launch-site list (`tests/storage.test.ts`, "uses the five launch sites…").
5. Run `npm run check` and `npm run test:e2e`. `tests/site-registry.test.ts` fails if an entry is incomplete.

Existing installs pick the new site up on their next load: a default, unrestricted rule is added and all its controls start off.

## Notes

- Selectors break when sites change their markup. Prefer stable attributes (`data-testid`, `aria-label`, URL paths) over class names, and keep each selector narrow. Avoid broad `:has()` rules, which are slow in Safari on large pages.
- Feed hiding must leave search, direct posts, profiles and messages usable unless a setting says otherwise.
- Site-specific behaviour that doesn't fit the registry (for example, X's For You and Following tabs, marked by `markXTab` in the content script) lives next to the code that needs it.
