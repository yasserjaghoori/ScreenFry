# Testing

## Automated

```bash
npm test          # 77 unit tests (Vitest, TZ fixed to America/New_York for DST cases)
npm run build     # typecheck + build + build invariants (classic content script, no network calls)
npm run test:e2e  # builds, then drives a real headless Chrome (CHROME_PATH to override)
```

| Area | Where |
|---|---|
| Daily limits, weekday allowances, midnight reset, DST days, zero-minute days | `tests/policy.test.ts` |
| Schedules: same-day, overnight, overlapping, all-day, DST, next access, upcoming windows | `tests/policy.test.ts` |
| Overrides: shared across URLs, exact expiry, clock rollback, strict-mode refusal | `tests/policy.test.ts`, `tests/actions.test.ts` |
| Multiple tabs (single tracked tab), idle/audible/locked, midnight split, gap cap, warnings | `tests/tracking.test.ts` |
| Commitment locking and pending changes (every weakening kind, extensions, queued removal) | `tests/commitments.test.ts`, `tests/actions.test.ts` |
| PIN: verifier, format, cooldowns, no overwrite, change requires current PIN | `tests/security-and-matching.test.ts`, `tests/actions.test.ts` |
| Overrides surviving restarts, restrictions returning after expiry | `tests/actions.test.ts` |
| URL matching, direct YouTube links, alias groups, unrelated Google services | `tests/policy.test.ts`, `tests/security-and-matching.test.ts` |
| Feed blockers: toggles, path scoping, X tabs, Shorts → player | `tests/security-and-matching.test.ts` |
| Storage persistence, schema migration, recovery after a failed write | `tests/storage.test.ts` |
| Real Chrome: install → onboarding, DNR redirect of direct links and subdomains, queued weakening, PIN override, second-tab reuse, countdown overlay, sender checks, re-block on expiry | `tests/e2e/chrome-smoke.mjs` |

## Manual: Chrome and Incognito

1. `npm run build`, open `chrome://extensions`, turn on Developer mode, **Load unpacked** → `dist/chrome`. Onboarding opens.
2. Try a 5-digit PIN and mismatched PINs (both refused), then create a PIN.
3. On the private-browsing step, choose **Check again** without changing anything. It must say *not confirmed*.
4. Open `chrome://extensions/?id=<id>`, turn on **Allow in Incognito**, return, **Check again** → *Sealproof-ready*. Turn it off; Chrome reloads the extension, and the dashboard must show *not confirmed* again.
5. Add YouTube with a 1-minute limit and a 7-day commitment. Keep a YouTube tab active in a focused window. Expect the 1-minute warning, then a redirect to the sealed page within a few seconds of the limit.
6. Check that these redirect: `youtube.com/watch?v=…`, `youtube.com/shorts/…`, `m.youtube.com`, `youtu.be/…` and a page embedding `youtube-nocookie.com/embed/…`. `google.com/search?q=youtube` and Gmail must still work.
7. Enter a wrong PIN three times → 30-second countdown. After it ends, enter the correct PIN → the site opens with a countdown pill. Open YouTube in a second tab: it's open too, with the same countdown.
8. Quit Chrome during the visit and reopen it. The countdown continues from the same end time. When it ends, every YouTube tab returns to the sealed page.
9. Edit the rule to 60 minutes, then remove the site → both appear as *Requested change*, and YouTube stays sealed. **Withdraw request** removes the pending change.
10. Open an Incognito window (with access allowed) and repeat step 6.
11. Leave the computer idle for 2+ minutes on a non-playing YouTube page. Usage should stop growing. Play a video without touching anything: usage keeps growing.

## Manual: Safari Private Browsing

1. `npm run build:safari`, then `cd safari/Screentime && xcodegen generate && open Screentime.xcodeproj`. Pick a signing team for both targets (or use Safari ▸ Develop ▸ *Allow Unsigned Extensions* for local testing) and run the app.
2. Click **Open Safari Extension Settings**, turn on Screentime, allow **All Websites**, and turn on **Allow in Private Browsing**.
3. Complete onboarding. On the private-browsing step, **Check again** must say *not confirmed* until a Private window (⇧⌘N) is open. With one open, it shows *Sealproof-ready* with a timestamp.
4. Repeat Chrome steps 5–9 in a normal and a Private window.
5. Turn off Private Browsing access in Safari. The dashboard keeps the last-observed time (Safari doesn't report the change). Confirm the wording doesn't claim live coverage.
6. Safari has no idle API, so step 11 doesn't apply. Time counts while the window is focused.

## Reliability checks (manual)

- Sleep the Mac for 10 minutes with a limited site focused. On wake, usage grows by at most 90 seconds.
- Change the time zone while a schedule is active. Pages re-evaluate within a minute, and the next-access time uses the new zone.
- Move the clock back an hour during an override. The override is cancelled and the dashboard shows the clock-change notice.
