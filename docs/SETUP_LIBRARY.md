# Setup library and search (plan)

Section 4 of [NEXT.md](NEXT.md). People browse and search setups that others have published ("YouTube for studying", "no Shorts, 30 minutes of Reddit"), preview what a setup changes, and put it in one of their five loadouts. This is a plan. Nothing here is built yet.

A setup is published as the `SF2-` share code the Share page already makes (`packages/core/src/share.ts`). A code holds settings only (rules, windows, earn goals, feed blockers and the warnings switch), never usage, history, the password or browser details. The library adds a title, a description, tags and a place to find codes. Applying one goes through the same validation, preview slides and loadout actions as a pasted code.

This is ScreenFry's first backend. The local-first rule is relaxed for this feature only: it is opt-in, nothing about you or your settings is sent unless you publish, and everything else keeps working with no network connection. Section 5 (the Earn leaderboard) will use the same backend and the same install keys.

## Decisions (Sam, November 12, 2026)

| | Decision |
| --- | --- |
| **Publishing** | An **anonymous key for each install**: a key pair made on the device the first time you publish, upvote or report. Requests are signed with it. There's no account, email or sign-in. Browsing and applying setups need no key. |
| **Moderation** | **Setups go live at once and are hidden after 3 reports.** A word filter checks the title, description, tags and every name in the code before a setup is published. A setup is hidden automatically once 3 different installs report it. An admin restores or deletes it, or blocks a publisher's key, with a small script. |
| **Backend** | **Cloudflare Workers + D1, in `services/library` in this repo.** The Worker uses `packages/core` to validate codes, so the server and the extension check them the same way. |
| **Where** | **A Library tab on the extension's Share page first.** The Mac app comes later (see [Later: the Mac app](#later-the-mac-app)). That keeps the Mac App Store build (PR #63) without a network entitlement for now. |

Still open (decide before step 3 of the build order):

- **The API's address**: a `*.workers.dev` subdomain, or a custom domain such as `library.<our domain>`. A custom domain can move to another host later without an extension update, so it's better if we have one.
- **The tag list** (draft below).
- **Contact for reports**: App Store guideline 1.2 asks for published contact information. A GitHub issue form or a shared address, shown on the Library tab and the privacy page.

## Why these choices

- **Anonymous key**: the server can rate-limit publishers, you can delete your own setups, and an admin can block an abusive publisher without anyone having an account. Blocking abusive users is one of the four things App Store guideline 1.2 asks of user-generated content. Sign in with Apple would need a web sign-in flow inside a Chrome extension and an Apple Services ID, which is a lot for a free, optional feature. The leaderboard can reuse the same key, or add Sign in with Apple on top later if cheating becomes a problem.
- **Cloudflare over Supabase**: Workers' free plan covers 100,000 requests a day, D1's covers 5 GB and 5 million rows read a day, and the paid plan is $5 a month in total. A free Supabase project pauses after a week without traffic, and Pro costs $25 a month. Supabase's main strength is built-in accounts, which we don't need. Workers also have a built-in rate-limiting binding. Check these prices again before launch.
- **In this repo**: the Worker imports `decodeShareCode`, `checkSettings` and `encodeShareCode` from `packages/core` directly, with no copied code or published package. A change to the share-code format and the server's validation land in the same pull request.

## Architecture

```
Extension Share page ──fetch──▶ Cloudflare Worker (services/library) ──▶ D1 (setups, publishers, votes, reports)
  (dashboard page only)           uses packages/core to validate codes
```

- Only the **dashboard page** (the Share page) talks to the library. The background service worker, the popup, content scripts and the blocked page never make a network request. A build check enforces this (see [Tests](#tests)).
- The library client lives in `apps/extension/src/library/`: the API client, the install key and the response types.
- The pure checks shared by the extension and the Worker go in `packages/core/src/library.ts`: `checkPublishable(code)`, the tag list, the word filter and the websites a code names. State changes, such as turning the library on, are core actions as usual.
- The Worker is plain TypeScript with no framework: a small router, D1 queries and the core imports. `wrangler.jsonc` sets the D1 binding, the rate-limit bindings, the `ADMIN_TOKEN` secret, and an `alias` entry so `@core` and `@feeds` resolve the way they do in Vite.
- Migrations are numbered SQL files in `services/library/migrations/`, applied with `wrangler d1 migrations apply`.

## API

JSON over HTTPS, versioned by path (`/v1/…`). Responses carry `Access-Control-Allow-Origin: *`: library data is public, and writes are authorized by signature, not by origin. That works whether or not the extension keeps `<all_urls>` (the open question in NEXT.md section 1). Errors are `{ "error": "<a sentence to show the user>" }` with a fitting status code (400, 403, 404, 409 or 429).

| Method and path | Key | What it does |
| --- | --- | --- |
| `GET /v1/setups?q=&website=&tag=&sort=top\|new&cursor=` | — | Search. `q` matches the title and description (FTS5). `website` is a site id from the registry (`youtube`) or a domain. `website` and `tag` may each repeat (all must match). Returns up to 20 cards and a `next` cursor. Live setups only. |
| `GET /v1/setups/:id` | — | One setup: its card plus the `code`. |
| `POST /v1/setups` | yes | Publish `{ code, title, description, tags }`. Returns `{ id }`. If the same setup is already published, returns `409` with the existing id. |
| `DELETE /v1/setups/:id` | yes, owner | Unpublish your own setup. |
| `GET /v1/me/setups` | yes | Your published setups, including hidden ones, with their state. |
| `PUT` / `DELETE /v1/setups/:id/vote` | yes | Upvote, or take the upvote back. One per key. |
| `POST /v1/setups/:id/report` | yes | `{ reason: "offensive" \| "spam" \| "misleading" \| "other", note? }`. One per key per setup. |
| `GET /v1/health` | — | For monitoring. |
| `/admin/…` | `ADMIN_TOKEN` | Hidden setups, restore, remove, block or unblock a publisher. Used only by `services/library/scripts/admin.mjs`. |

A **card** is `{ id, title, description, websites, tags, summary, upvotes, createdAt }`. `summary` is what `summarizeShared` gives (blocked websites, limits, window and goal names, the number of feed blockers), computed by the server when the setup is published, so the list draws without decoding every code. The `code` comes only with the single setup, so search results stay small.

**Signed requests.** The install key is an ECDSA P-256 key pair made with WebCrypto. P-256 works in Chrome 116 (the manifest's minimum) and Safari, while Ed25519 needs newer browsers. The private key is non-extractable and kept in the dashboard's IndexedDB. A signed request carries:

- `ScreenFry-Key`: the raw public key (base64url). The publisher id is the first 16 bytes of its SHA-256, base64url.
- `ScreenFry-Time`: Unix milliseconds. The server refuses anything more than 5 minutes off.
- `ScreenFry-Signature`: a signature over `v1\n<method>\n<path>\n<time>\n<SHA-256 of the body, hex>`.

A replayed request within the 5 minutes changes nothing: votes and reports are one per key, and a publish of the same setup returns the existing id. The server records a key the first time it sees one. There's no separate sign-up call.

**Rate limits.** Nothing about them is stored except counts:

- Per IP address, with the Workers rate-limiting binding (kept in memory by Cloudflare, never written to D1): 60 reads a minute, 10 writes a minute.
- Per key, counted in D1: 10 publishes a day, 50 votes a day and 20 reports a day.
- A circuit breaker for everyone: 1,000 publishes a day. Above it, publishing pauses and an admin is alerted. Reading carries on.
- Search responses are cached at the edge for 60 seconds (Cache API) to save D1 reads.

## Data schema (D1)

```sql
CREATE TABLE publishers (
  id          TEXT PRIMARY KEY,           -- SHA-256 of the public key, 16 bytes, base64url
  public_key  TEXT NOT NULL,              -- raw P-256 key, base64url
  created_at  INTEGER NOT NULL,           -- Unix ms, first seen
  blocked     INTEGER NOT NULL DEFAULT 0  -- 1: can't publish, vote or report; their setups are hidden
);

CREATE TABLE setups (
  id          TEXT PRIMARY KEY,           -- 10 random base58 characters, used in links
  code        TEXT NOT NULL,              -- canonical SF2- code, re-encoded by the server
  code_hash   TEXT NOT NULL UNIQUE,       -- SHA-256 of code: each setup is published once
  title       TEXT NOT NULL,              -- 3–60 characters
  description TEXT NOT NULL DEFAULT '',   -- up to 280 characters
  websites    TEXT NOT NULL,              -- space-separated site ids / domains, derived from the code
  tags        TEXT NOT NULL DEFAULT '',   -- space-separated, from the fixed list
  summary     TEXT NOT NULL,              -- JSON from summarizeShared
  publisher   TEXT NOT NULL REFERENCES publishers(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  upvotes     INTEGER NOT NULL DEFAULT 0,
  reports     INTEGER NOT NULL DEFAULT 0, -- open reports since the last admin review
  status      TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'hidden', 'removed')),
  reviewed    INTEGER NOT NULL DEFAULT 0  -- 1: an admin restored it; reports no longer hide it automatically
);
CREATE INDEX setups_live_top ON setups (status, upvotes DESC, created_at DESC);
CREATE INDEX setups_live_new ON setups (status, created_at DESC);
CREATE INDEX setups_publisher ON setups (publisher);

-- One row per website and tag, for filters.
CREATE TABLE setup_websites (setup_id TEXT NOT NULL REFERENCES setups(id) ON DELETE CASCADE, website TEXT NOT NULL, PRIMARY KEY (setup_id, website));
CREATE INDEX setup_websites_by_website ON setup_websites (website);
CREATE TABLE setup_tags (setup_id TEXT NOT NULL REFERENCES setups(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY (setup_id, tag));
CREATE INDEX setup_tags_by_tag ON setup_tags (tag);

CREATE VIRTUAL TABLE setups_fts USING fts5(setup_id UNINDEXED, title, description);

CREATE TABLE votes (
  setup_id   TEXT NOT NULL REFERENCES setups(id) ON DELETE CASCADE,
  publisher  TEXT NOT NULL REFERENCES publishers(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (setup_id, publisher)
);

CREATE TABLE reports (
  setup_id   TEXT NOT NULL REFERENCES setups(id) ON DELETE CASCADE,
  publisher  TEXT NOT NULL REFERENCES publishers(id),
  reason     TEXT NOT NULL CHECK (reason IN ('offensive', 'spam', 'misleading', 'other')),
  note       TEXT NOT NULL DEFAULT '',    -- up to 280 characters, seen only by admins
  created_at INTEGER NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (setup_id, publisher)
);
```

No IP addresses, user agents, extension versions or browser names are stored. `wrangler d1 export` skips virtual tables, so backups rebuild `setups_fts` from `setups`.

**Draft tag list** (fixed, so tags need no moderation): `studying`, `work`, `deep-focus`, `evenings`, `weekends`, `sleep`, `detox`, `gentle`, `strict`, `earn`, `fry-time`, `no-shorts`. Up to 4 per setup. Websites aren't tags. They come from the code.

## Validating a published code

`checkPublishable(code)` in `packages/core/src/library.ts`, run by the extension before it sends and by the Worker before it stores:

1. **Only real `SF2-` codes.** The trimmed text must start with `SF2-` and be at most **8,000 characters**. Older `SCREENFRY-1-` codes are refused, because they hold a whole settings file. So are Mac codes (`SFM1-`, one setup per browser) and pasted settings JSON. A real setup is a few hundred characters. Set the limit from the largest setups we can make in testing, with room to spare.
2. **It decodes and passes the same checks as a paste.** `decodeShareCode`, then `checkSettings`. The decoded JSON is capped lower than in the app (64 KB, not 1 MB). Counts are capped: 30 rules, 20 windows, 20 earn goals.
3. **It's rebuilt, never stored as sent.** The server re-encodes the checked settings with `encodeShareCode` and stores that canonical code. Anything in the sent payload besides `r`, `w`, `e`, `f`, `g` and `n` is dropped by construction. That makes "no usage, history or password data" structural: the `SF2-` format has no field for them, and re-encoding throws away anything smuggled in. The duplicate check hashes the canonical code.
4. **It changes something.** A setup identical to a fresh install is refused ("This setup doesn't change anything yet").
5. **Its words pass the filter.** The title, the description, every window and goal name, and every custom website (a domain that isn't in the site registry) go through the same word filter. The list is a small file in `packages/core`, so Sam and Yasser can edit it in a pull request.
6. **The text fields are well-formed.** Title 3–60 characters, description up to 280, tags from the list. Control characters and bidirectional overrides are stripped.

`websites` and `summary` are computed by the server from the canonical code. The extension never sends them.

## Privacy

- **Off by default.** The Library tab first explains the library and shows **Turn on the library**. Until you press it, nothing anywhere in ScreenFry contacts the server. The choice is a core action (`SET_LIBRARY_ENABLED`) stored with your preferences. It isn't password-protected, because it changes no limits. Turning it off stops all requests and offers to delete your install key.
- **Browsing sends only your search.** A search sends the words you typed and the filters you picked. Opening a setup sends its id. Your settings, loadouts, usage and history are never sent. Cloudflare sees your IP address, as any web server does. The Worker doesn't store it.
- **Publishing sends one setup, after you've seen it.** The publish screen lists everything that becomes public: the title, description and tags, every website (custom websites are marked "you added this"), every window and goal name, and the preview slides. Nothing is sent until you press **Publish**. Publishing makes the install key if there isn't one.
- **Applying a setup is local.** The code is decoded, checked and previewed on your Mac. The server doesn't learn which setups you apply. There's no "used by N people" count, deliberately.
- **No network, no problem.** If the server can't be reached, the Library tab says so ("Can't reach the library right now. Your loadouts and settings work as usual."), and nothing else changes. Limits, windows, goals, feed blocking, loadouts and share codes never depend on the library.
- **Leaving.** **Delete my published setups** in the Library tab unpublishes them all, signed with your key. Removing the extension removes the key. Setups you published stay public until you delete them.
- **Docs to update before it ships:** `docs/PRIVACY.md` (a "Setup library" paragraph, and the first bullet no longer says "no backend"), README's **Private** row, the AGENTS.md scope line, `docs/THREAT_MODEL.md` (the server and its abuse cases), and the store listings (below).

## UI flow

The Share page gets two tabs: **Loadouts** (everything that's there today) and **Library**.

**Library tab**

1. *Off:* a short explanation, what's sent and what isn't, and **Turn on the library**.
2. *On:* a search box, website chips (the nine registry websites, with their colors and symbols from `siteDefinitions`), tag chips and **Top** / **New**. Results are cards: the title, website symbols, tags, upvotes and a two-line summary. Results load 20 at a time with **Show more**.
3. *A setup:* the card opens in place. ScreenFry fetches its code, decodes and checks it locally, and shows the **same `ShareSlides` slideshow** that pasted codes use, compared with the loadout picked below. Above the slides is a row of the five loadout tabs (the existing `loadout-tabs`), with the selected loadout as the default. The apply button reads **Use in loadout N** (or the loadout's name). It runs the existing `SET_LOADOUT_FROM_CODE` action with the same password gate and confirmation dialog as a paste. For the loadout in use, that's "Replace your current setup?". There's no separate apply path.
4. Beside the slides: **Upvote**, **Copy code** (so you can paste it elsewhere or into the Mac app) and **Report…** (a reason and an optional note).

**Publishing** (Loadouts tab)

1. Next to **Copy share code**: **Publish to library…**. It shows only while the library is on. Otherwise it reads "Turn on the library to publish".
2. A dialog asks for the title, description and up to 4 tags. Below that is everything that becomes public (see Privacy), with the checkbox "Anyone can find and use this setup."
3. **Publish** runs `checkPublishable` locally first (instant errors), then sends. When it's done, the dialog shows "Published" and the setup's card.
4. **Your published setups** sits at the bottom of the Library tab: each with its state (live, hidden while it's reviewed, removed) and **Delete**.

**Refactors this needs:** move `ShareSlides` and `SettingsSummary` out of `EarnShare.tsx` into `apps/extension/src/ui/`, and split `ShareSettings` into the Loadouts and Library tabs. The slides component already takes an `applyLabel`.

## Permissions and store review

**Chrome.** No new manifest permission. MV3's default extension-page CSP doesn't restrict `connect-src`, and the Worker sends CORS headers, so a `fetch` from the dashboard works with or without `<all_urls>`. There's no new install warning, so existing users aren't asked to re-approve. The Web Store listing ([store/chrome-web-store.md](../store/chrome-web-store.md)) needs:

- **Privacy practices:** declare the user content you publish (title, description and settings), not sold or transferred, used only to run the library. Browsing collects nothing.
- **Remote code:** still **None**. Setups are data, checked by `checkSettings`, never code.
- **Single purpose:** unchanged. Setups are the same settings the extension already has.
- **Description:** a line on the optional library, and the updated privacy policy.

Expect the update to go through review again. It's a data-flow change, not a permission change.

**Safari and the Mac App Store** (PR #63's edition):

- The extension's pages run in Safari's web content process, so `fetch` from the dashboard shouldn't need a network entitlement on the app or the extension. **Confirm this in a sandboxed App Store build before relying on it.** If it fails, add `com.apple.security.network.client` to the extension target only.
- **CORS:** Safari extension origins are `safari-web-extension://<random UUID>`, a different one per install. That's why the Worker allows every origin, not a list of extension ids.
- **App Privacy label** in App Store Connect: *User Content → Other User Content* (published setups), and *Identifiers → User ID* (the install key), both for app functionality, not linked to identity, not used for tracking.
- **Guideline 1.2 (user-generated content)** asks for a filter (the word filter), a way to report (Report…), a way to block abusive users (publisher blocking) and published contact information. Put the contact on the Library tab and the privacy page, and describe all four in the review notes ([store/mac-app-store.md](../store/mac-app-store.md) once #63 merges).
- **Guideline 5.1.1:** the privacy policy URL must describe the library before review.
- The Developer ID download (DMG) needs nothing extra.

## Later: the Mac app

Not in the first version. When it comes:

- A **Library** window in the Mac app with the same search. Applying a setup saves it into one of the app's five loadouts through the existing paste path (`AppLoadouts.codes(from:)`, which already accepts `SF2-` codes for every browser). **Use in All Browsers** then sends it out as today.
- The Mac App Store build would then need `com.apple.security.network.client` on the app and an updated App Privacy label. PR #63 currently says "no network entitlement".
- The Mac app can't decode `SF2-` codes itself (the browsers check codes). Either show the card's server-made `summary` and let the browsers' preview do the rest, or reuse the extension's slides in a web view. Decide then.

## Tests

- **Core unit tests** (`tests/library.test.ts`, part of `npm run check`):
  - `checkPublishable` accepts real codes made by `encodeShareCode` from varied setups.
  - It refuses `SCREENFRY-1-`, `SFM1-` and JSON, oversized, damaged and empty (fresh-install) codes, and setups over the count caps.
  - A hand-built `SF2-` payload with extra keys (`u`, `history`, `password`) comes back canonical without them.
  - The word filter catches window and goal names and custom domains, not only the title.
  - The derived websites are site ids for registry websites and domains for the rest.
- **Worker tests** (`services/library`, `@cloudflare/vitest-pool-workers` with a local D1, run in CI and with `npm --prefix services/library test`):
  - Migrations apply cleanly.
  - Publish, search (text, website, tag, sorting, cursor), get, delete by the owner (refused for others), vote and unvote.
  - Signature checks: a bad signature, a time more than 5 minutes off, a key that doesn't match the signature and a blocked key are all refused.
  - Duplicate publish returns `409` with the existing id.
  - Three reports from different keys hide a setup. Three from one key don't. A reviewed setup stays live.
  - Rate limits return `429`. Responses never include `publisher` or the public key.
- **Extension end-to-end** (`npm run test:e2e`, with a fake library served by the existing fixture server):
  - With the library off, opening every page (dashboard, popup, blocked page) and browsing fixtures makes **no request** to the library host.
  - Turn it on, search, open a setup, see the slides, use it in loadout 3, and loadout 3 holds it.
  - A settings password asks for the password before applying.
  - Publish with title and tags, and the fake server receives only `{ code, title, description, tags }` plus the signature headers.
  - Server down: the Library tab shows its message, and the Loadouts tab, copying codes and pasting codes still work.
- **Build check:** `scripts/verify-build.mjs` fails if the library host appears in `background.js`, `content.js` or the popup bundle. Only the dashboard bundle may have it.
- **Manual, recorded in `docs/TESTING.md`:** Safari (CORS from a `safari-web-extension://` origin, and the sandboxed App Store build), and a real publish, report and admin restore against the staging Worker.

## Build order

Each step is its own `dev/…` branch off `dev/next`, merged by pull request. Nothing reaches `main` until step 10.

1. **Core checks.** `packages/core/src/library.ts` (`checkPublishable`, canonical re-encoding, derived websites, tags, word filter) and its unit tests. No network and nothing user-visible, so it's safe at any time.
2. **Worker and database.** `services/library`: `wrangler.jsonc`, the migrations, the router, signature checks, rate limits, the admin routes and `scripts/admin.mjs`, plus the Worker tests. A CI job runs them.
3. **Staging deploy.** Sam authorizes Cloudflare (the Cloudflare plugin with `/mcp`, or `wrangler login`), and we settle the open questions (address, tags, contact). Create the staging D1 and Worker and set `ADMIN_TOKEN`. A GitHub Actions job deploys staging from `dev/next` and production from `main`, with an API token stored as a repository secret.
4. **Extension plumbing.** The `SET_LIBRARY_ENABLED` core action, the install key (IndexedDB), the API client with the staging address in a build-time constant, and the `ShareSlides` / `SettingsSummary` move.
5. **Library tab.** Off and on states, search, filters, cards, the slides preview, **Use in loadout N**, upvote, report and the offline message.
6. **Publishing.** The publish dialog, **Your published setups**, delete, and **Delete my published setups**.
7. **End-to-end tests and the build check** (above). Then a manual pass in Safari and in a sandboxed App Store build.
8. **Docs and listings.** PRIVACY.md, README, AGENTS.md, THREAT_MODEL.md, both store listings' privacy answers and review notes, and `CHANGELOG.md` under Unreleased.
9. **Production and seeding.** Deploy the production Worker. Sam and Yasser publish a handful of good setups ("YouTube for studying", "No Shorts, 30 minutes of Reddit", "Evenings only") so the library isn't empty on day one.
10. **Ship.** A pull request from `dev/next` into `main` with the extension release, then the Web Store and App Store updates with their review notes.
11. **Afterwards.** The Mac app's Library window, and section 5 (the Earn leaderboard) on the same Worker, database and install keys.
