# Screentime

Read `docs/PROJECT_BRIEF.md`, `README.md`, and the relevant architecture/testing docs before changing behavior.

- This is Sam and Yasser's productivity project. Start with Chrome and Safari extensions; a native macOS companion and iOS app are later phases.
- Preserve local-first operation: Phase 1 has no backend, accounts, analytics, or API keys.
- Keep policy decisions in `packages/policy-engine` and state changes in `packages/core`; UI controls alone must not enforce limits or authorize edits.
- Scope: YouTube, Instagram, X, Reddit, Substack and TikTok (added at the user's request), defined in the single site registry (`siteDefinitions`; see `docs/ADDING_A_SITE.md`). No general browsing history: measure time only on sites with a rule; optional settings password, no mandatory PINs/overrides/commitments. Windows live on their own page: allow windows (sites usable only inside) and block windows (sites blocked inside, user-requested); block wins when both apply.
- Count focused usage plus actual background playback; deduplicate simultaneous tabs per website.
- Keep feed blocking scoped to distraction surfaces, preserving useful search and direct links. Shorts entry points must not reopen the infinite-scroll loop.
- Never claim the extension can prevent removal or share state between browsers. Native Screen Time capabilities need separate investigation.
- Use Node from `.nvmrc` and `npm ci`. Run `npm run check` after code changes and `npm run test:e2e` for extension integration changes.
- Builds share `dist/chrome`; do not run a build while the Chrome smoke test is using it. Run `npm run build:safari` before regenerating or building the Safari project.
- Do not commit personal message exports, browsing data, passwords, signing identities, or generated build output. Work on a `codex/` branch and preserve collaborators' changes.
