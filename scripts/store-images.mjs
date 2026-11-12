#!/usr/bin/env node
// Makes the Chrome Web Store images in dist/store from the built extension (dist/chrome, from
// `npm run build`): five 1280×800 screenshots of the dashboard with a sample setup, and the
// 440×280 small promo tile. Runs its own headless Chrome with a throwaway profile; don't run it
// while the Chrome smoke test is using dist/chrome. See store/chrome-web-store.md.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const ext = join(root, "dist/chrome");
const out = join(root, "dist/store");
if (!existsSync(join(ext, "manifest.json"))) {
  console.error("No dist/chrome build. Run `npm run build` first.");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "screenfry-store-"));
const chrome = spawn(
  process.env.CHROME_PATH ??
    (process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "google-chrome"),
  [
    "--headless=new",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--force-color-profile=srgb",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] },
);
let nextId = 0;
let buffer = "";
const pending = new Map();
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    const p = pending.get(msg.id);
    if (!p) continue;
    pending.delete(msg.id);
    msg.error ? p.reject(Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  }
});
const cdp = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(session, expression) {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
async function open(url, width, height) {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp("Emulation.setScrollbarsHidden", { hidden: true }, sessionId);
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }, sessionId);
  await cdp("Page.navigate", { url }, sessionId);
  await sleep(1200);
  return { targetId, sessionId };
}
async function shot(page, name) {
  await cdp("Page.bringToFront", {}, page.sessionId);
  await evaluate(page.sessionId, "document.fonts.ready.then(() => true)");
  const { data } = await cdp("Page.captureScreenshot", { format: "png" }, page.sessionId);
  writeFileSync(join(out, name), Buffer.from(data, "base64"));
  console.log(`Wrote dist/store/${name}`);
}

const DAY = 60;
const weekdays = [1, 2, 3, 4, 5];
const now = Date.now();

try {
  await cdp("Browser.getVersion");
  const { id } = await cdp("Extensions.loadUnpacked", { path: ext });
  const base = `chrome-extension://${id}`;
  const setup = await open(`${base}/dashboard.html`, 1280, 800);
  const send = (req) => evaluate(setup.sessionId, `chrome.runtime.sendMessage(${JSON.stringify(req)})`);
  const must = async (req) => {
    const r = await send(req);
    if (!r?.ok) throw Error(`${req.type}: ${r?.error ?? "no answer"}`);
    return r.data;
  };
  // A sample setup: a few feeds hidden, limits, two windows, one earn goal, named loadouts.
  await must({ type: "COMPLETE_ONBOARDING" });
  await must({ type: "PASSWORD_PROMPT_SEEN" });
  const state = await must({ type: "GET_STATE" });
  const feeds = state.feedSettings;
  const on = (site, keys) => keys.forEach((k) => k in feeds.sites[site] && (feeds.sites[site][k] = true));
  on("youtube", ["home", "recommendations", "endscreen", "shorts", "shortsButton", "exploreButton"]);
  on("instagram", ["home", "explore", "reels", "reelsButton", "suggestions"]);
  on("x", ["home", "explore", "trends", "suggestions"]);
  on("reddit", ["home", "popular", "recommendations"]);
  on("tiktok", ["home", "foryou", "explore"]);
  await must({ type: "SET_FEEDS", feedSettings: feeds });
  for (const r of state.rules) {
    const minutes = { youtube: 45, instagram: 20, x: 15, reddit: 0, tiktok: 10 }[r.id];
    if (minutes !== undefined)
      await must({ type: "SAVE_RULE", rule: { ...r, enabled: true, dailyAllowance: { defaultMinutes: minutes }, updatedAt: now } });
  }
  await must({
    type: "SAVE_WINDOW",
    window: { id: "evenings", label: "Evenings", enabled: true, mode: "allow", days: [0, 1, 2, 3, 4, 5, 6], startMinute: 18 * DAY, endMinute: 22 * DAY, domains: ["instagram.com", "tiktok.com"] },
  });
  await must({
    type: "SAVE_WINDOW",
    window: { id: "work", label: "Deep work", enabled: true, mode: "block", days: weekdays, startMinute: 9 * DAY, endMinute: 12 * DAY, domains: ["youtube.com", "x.com", "reddit.com"] },
  });
  await must({
    type: "SAVE_WINDOW",
    window: { id: "lunch", label: "Lunch break", enabled: true, mode: "free", days: weekdays, startMinute: 12 * DAY + 30, endMinute: 13 * DAY + 30, freeMinutes: 15, domains: ["youtube.com", "x.com"] },
  });
  await must({
    type: "SAVE_EARN_GOAL",
    goal: { id: "duolingo", label: "Spanish first", enabled: true, goalDomains: ["duolingo.com"], minutes: 15, lockedDomains: ["instagram.com", "tiktok.com"], reward: "unlock" },
  });
  await must({
    type: "SAVE_EARN_GOAL",
    goal: { id: "reading", label: "Read to earn", enabled: true, goalDomains: ["wikipedia.org"], minutes: 20, lockedDomains: ["youtube.com"], reward: "fry", repeats: 3, fryMinutes: 10 },
  });
  for (const [index, name] of ["Weekdays", "Weekend", "Exams"].entries())
    await must({ type: "RENAME_LOADOUT", index, name });
  await must({ type: "COPY_TO_LOADOUT", index: 1 });
  await cdp("Target.closeTarget", { targetId: setup.targetId });

  const pages = [
    ["1-websites.png", `${base}/dashboard.html?site=youtube#websites`],
    ["2-windows.png", `${base}/dashboard.html#windows`],
    ["3-earn.png", `${base}/dashboard.html#earn`],
    ["4-share.png", `${base}/dashboard.html#share`],
    ["5-time-up.png", `${base}/blocked.html?url=${encodeURIComponent("https://www.reddit.com/")}`],
  ];
  for (const [name, url] of pages) {
    const page = await open(url, 1280, 800);
    await shot(page, name);
    await cdp("Target.closeTarget", { targetId: page.targetId });
  }
  const tile = await open(
    `${pathToFileURL(join(root, "store/promo-tile.html")).href}?logo=${encodeURIComponent(pathToFileURL(join(ext, "icons/icon-256.png")).href)}`,
    440,
    280,
  );
  await shot(tile, "promo-tile-440x280.png");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await sleep(500);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  for (const pipe of chrome.stdio) pipe?.destroy();
  rmSync(profile, { recursive: true, force: true });
}
