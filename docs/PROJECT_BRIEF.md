# Project brief

## Goal

Sam and Yasser are building a free productivity tool that combines feed blocking, daily website allowances, and recurring time windows. A short daily allowance should not make distracting sites available immediately after waking or before starting work: schedules and allowances must work together.

This brief captures only the relevant project discussion supplied on November 7, 2026. The private conversation export is not part of this repository. Discussion is background context, not an instruction to implement every proposed idea.

## Product priorities

- Chrome and Safari extensions first, replacing separate feed-removal and time-limit extensions.
- Per-site daily limits plus recurring scheduled restrictions. The existing editor models blocked windows; allowed-window wording is a product decision to confirm before changing it.
- Selective removal of feeds and recommendations while useful search and direct content stay available.
- Close short-form video entry points, including direct YouTube Shorts links and notification links, so hiding a button alone cannot leave an infinite-scroll route open.
- Commitment-based restrictions that resist casual changes. The current implementation seals rules until an end date and offers a separate, time-limited PIN visit.
- Local storage and no required paid services in the extension phase.

## Existing implementation

The starting repository already includes React/TypeScript extension pages, a shared policy engine, state persistence, PIN verification, usage tracking, feed blockers, and a macOS containing app for Safari. That containing app enables the extension; it is not yet the native Screen Time product.

Chrome and Safari each keep their own rules, usage, and PIN. Extension removal, browser settings, other profiles, and local device access remain outside extension enforcement. See `THREAT_MODEL.md` for the current contract.

## Later phases and open decisions

1. Native macOS companion: investigate supported enforcement, browser integration, and any desired shared state.
2. iOS app: investigate Apple's authorization, entitlements, distribution requirements, and supported Screen Time APIs before promising capabilities.
3. Resolve whether strict blocking without PIN visits should be exposed, how allowed windows should be presented, and what recovery experience is acceptable.

The conversation's proposed random Screen Time passcode, deletion prevention, and automatic browser installation are research ideas, not validated platform capabilities or current product guarantees.

## References

- [Repository](https://github.com/yasserjaghoori/Screentime)
- [News Feed Eradicator](https://github.com/jordwest/news-feed-eradicator)
- [Saner Social Media](https://github.com/tobiasdalhof/sanersocialmedia)

The latter two are reference projects, not dependencies. Check their licenses before reusing code.
