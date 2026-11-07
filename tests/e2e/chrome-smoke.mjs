/** Isolated Chrome integration test. All website fixtures are served through the test protocol locally; no user profile is touched. */
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const profile = mkdtempSync(join(tmpdir(), "screentime-e2e-"));
const fixture = readFileSync(join(root, "tests/fixtures/playing.webm"));
const fixtureHtml = `<!doctype html><html><head><title>Local website fixture</title></head><body>
    <h1>Useful content</h1><a href="/shorts/fixture" id="notification">Shorts notification</a>
    <button id="spa">Open Shorts without reloading</button><button id="modal">Open short-form modal</button>
    <div id="regular-player"><video id="media" width="64" height="64" loop muted playsinline src="/playing.webm"></video></div>
    <script>
      document.querySelector('#spa').onclick=()=>{history.pushState({},'', '/shorts/fixture');document.dispatchEvent(new Event('yt-navigate-finish'));};
      document.querySelector('#modal').onclick=()=>{const box=document.createElement('div');box.dataset.testid='shorts-player';document.body.append(box);box.append(document.querySelector('#media'));};
    </script></body></html>`;
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
    "--autoplay-policy=no-user-gesture-required",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let nextId = 0,
  buffer = "",
  chromeErrors = "";
const pending = new Map(),
  contexts = [];
chrome.stderr.on("data", (d) => {
  chromeErrors = (chromeErrors + d).slice(-2000);
});
function rejectPending(error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(error);
  }
  pending.clear();
}
chrome.on("error", rejectPending);
chrome.on("exit", () => rejectPending(Error("Chrome exited")));
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    if (msg.method === "Fetch.requestPaused") {
      const video =
        new URL(msg.params.request.url).pathname === "/playing.webm";
      void cdp(
        "Fetch.fulfillRequest",
        {
          requestId: msg.params.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: video ? "video/webm" : "text/html" },
          ],
          body: (video ? fixture : Buffer.from(fixtureHtml)).toString("base64"),
        },
        msg.sessionId,
      ).catch(() => {});
    }
    if (msg.method === "Runtime.executionContextCreated")
      contexts.push({ sessionId: msg.sessionId, ...msg.params.context });
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.error
        ? p.reject(Error(JSON.stringify(msg.error)))
        : p.resolve(msg.result);
    }
  }
});
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(Error(`Timed out: ${method}`));
      },
      method === "Extensions.loadUnpacked" || method === "Browser.getVersion"
        ? 60_000
        : 20_000,
    );
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(name, ok, detail = "") {
  checks.push(ok);
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " — " + detail : ""}`,
  );
}
async function evaluate(sessionId, expression) {
  const r = await cdp(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
  );
  if (r.exceptionDetails)
    throw Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}
const attach = async (id) =>
  (await cdp("Target.attachToTarget", { targetId: id, flatten: true }))
    .sessionId;
async function urlOf(id) {
  return (
    (await cdp("Target.getTargets")).targetInfos.find((t) => t.targetId === id)
      ?.url ?? ""
  );
}
async function open(url) {
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const session = await attach(targetId);
  await cdp(
    "Fetch.enable",
    {
      patterns: [
        "youtube.com",
        "instagram.com",
        "example.com",
        "x.com",
        "reddit.com",
        "substack.com",
      ].map((host) => ({
        urlPattern: `https://${host}/*`,
        requestStage: "Request",
      })),
    },
    session,
  );
  await cdp("Page.navigate", { url }, session);
  await sleep(700);
  return { id: targetId, session };
}
async function waitFor(fn, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  throw Error(`Timed out waiting for ${label}`);
}
const site = (path = "/watch?v=fixture") => `https://youtube.com${path}`;
const shots = join(root, "dist/screenshots");
mkdirSync(shots, { recursive: true });
async function screenshot(page, name, width = 1280, height = 1000) {
  if (process.env.CI && !process.env.CAPTURE_E2E_SCREENSHOTS) return;
  await cdp("Page.bringToFront", {}, page.session);
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: 1, mobile: false },
    page.session,
  );
  const shot = await cdp(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true },
    page.session,
  );
  writeFileSync(join(shots, name), Buffer.from(shot.data, "base64"));
}
let controller;
try {
  await cdp("Browser.getVersion");
  const { id: extId } = await cdp("Extensions.loadUnpacked", {
    path: join(root, "dist/chrome"),
  });
  check("extension loads", !!extId);
  await sleep(800);
  const targets = (await cdp("Target.getTargets")).targetInfos;
  check(
    "welcome page opens on install",
    targets.some((t) => t.url.includes("onboarding.html")),
  );
  controller = await open(`chrome-extension://${extId}/dashboard.html`);
  const send = (req) =>
    evaluate(
      controller.session,
      `chrome.runtime.sendMessage(${JSON.stringify(req)})`,
    );
  const getState = async () => (await send({ type: "GET_STATE" })).data;
  const body = () => evaluate(controller.session, "document.body.innerText");
  check(
    "website controls work without mandatory onboarding or PIN",
    /Websites/.test(await body()) &&
      !/Create.*PIN|sealproof|commitment/i.test(await body()),
  );
  check(
    "five requested launch sites",
    (await getState()).rules.map((r) => r.id).join() ===
      "youtube,instagram,x,reddit,substack",
  );
  check(
    "onboarding can complete without a password",
    (await send({ type: "COMPLETE_ONBOARDING" })).ok,
  );
  // Drive actual React controls, rather than only its message API.
  await evaluate(
    controller.session,
    `document.querySelector('#daily-limit').value='5';document.querySelector('#daily-limit').dispatchEvent(new Event('change',{bubbles:true}))`,
  );
  await waitFor(
    async () =>
      (await getState()).rules.find((r) => r.id === "youtube").dailyAllowance
        ?.defaultMinutes === 5,
    "daily limit control",
  );
  check("daily limit selector persists five minutes", true);
  await screenshot(controller, "websites.png");
  await evaluate(
    controller.session,
    `[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Windows').click()`,
  );
  await sleep(150);
  check(
    "separate Windows page explains whitelist semantics",
    /Whitelist websites inside a window/.test(await body()),
  );
  await evaluate(
    controller.session,
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Add window')).click()`,
  );
  await sleep(100);
  check(
    "window form has day/time and website whitelist controls",
    await evaluate(
      controller.session,
      `!!document.querySelector('#window-start')&&document.querySelectorAll('.whitelist input').length===5`,
    ),
  );
  await screenshot(controller, "window-editor.png");
  await evaluate(
    controller.session,
    `(()=>{const input=document.querySelector('#window-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Evening break');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.whitelist input').click();})()`,
  );
  await sleep(100);
  await evaluate(
    controller.session,
    `document.querySelector('[role=dialog] form').requestSubmit()`,
  );
  await waitFor(
    async () =>
      (await getState()).windows.some((w) => w.label === "Evening break"),
    "window form save",
  );
  check(
    "window form saves its website whitelist with alias coverage",
    (await getState()).windows
      .find((w) => w.label === "Evening break")
      .domains.includes("youtu.be"),
  );
  const formWindow = (await getState()).windows.find(
    (w) => w.label === "Evening break",
  );
  await send({ type: "DELETE_WINDOW", windowId: formWindow.id });
  const rule = (id, domain, minutes) => ({
    id,
    label: id,
    domains: [domain],
    enabled: true,
    blocked: false,
    showTimer: false,
    dailyAllowance:
      minutes === undefined ? undefined : { defaultMinutes: minutes },
    createdAt: 0,
    updatedAt: 0,
  });
  check(
    "daily restriction saves with no PIN",
    (await send({ type: "SAVE_RULE", rule: rule("example", "example.com", 0) }))
      .ok,
  );
  const blocked = await open("https://example.com/direct");
  await waitFor(
    async () => (await urlOf(blocked.id)).includes("blocked.html"),
    "daily limit redirect",
  );
  check("zero allowance redirects a direct URL to blocked page", true);
  const blockedText = await evaluate(
    blocked.session,
    "document.body.innerText",
  );
  check(
    "blocked page offers no PIN, temporary visit or bypass",
    !/PIN|temporary visit|unlock|10.minute/i.test(blockedText),
  );
  check(
    "old override message is rejected",
    !(await send({ type: "VERIFY_AND_OVERRIDE", url: site(), pin: "123456" }))
      .ok,
  );
  const now = new Date(),
    day = now.getDay(),
    minute = now.getHours() * 60 + now.getMinutes();
  // Use a window tomorrow so this remains stable around midnight and DST.
  const w = {
    id: "fixture-window",
    label: "Tomorrow break",
    enabled: true,
    domains: ["youtube.com"],
    days: [(day + 1) % 7],
    startMinute: 0,
    endMinute: 0,
  };
  check(
    "window can be saved independently of an allowance",
    (await send({ type: "SAVE_WINDOW", window: w })).ok,
  );
  const outside = await open(site());
  await waitFor(
    async () => (await urlOf(outside.id)).includes("blocked.html"),
    "outside window redirect",
  );
  check("outside-window block applies with daily time remaining", true);
  await screenshot(controller, "windows.png");
  check(
    "another allowed window can open the site without resetting its limit",
    (
      await send({
        type: "SAVE_WINDOW",
        window: { ...w, id: "today", days: [day] },
      })
    ).ok,
  );
  const normal = await open(site());
  check(
    "normal content is available inside any matching window",
    await evaluate(normal.session, `!!document.querySelector('#spa')`),
  );
  await send({ type: "DELETE_WINDOW", windowId: w.id });
  await send({ type: "DELETE_WINDOW", windowId: "today" });
  let feeds = (await getState()).feedSettings;
  feeds.sites.youtube.shorts = true;
  feeds.sites.instagram.reels = true;
  check(
    "Shorts and Reels controls save",
    (await send({ type: "SET_FEEDS", feedSettings: feeds })).ok,
  );
  for (const [name, url] of [
    ["Shorts notification", site("/shorts/fixture?feature=notification")],
    ["individual Reel", "https://instagram.com/reel/fixture"],
    ["Reels feed", "https://instagram.com/reels/"],
  ]) {
    const tab = await open(url);
    await waitFor(
      async () => (await urlOf(tab.id)).includes("blocked.html"),
      name,
    );
    check(`${name} is blocked entirely`, true);
  }
  const spa = await open(site());
  if (process.env.DEBUG_E2E)
    console.log(
      "SPA PAGE",
      await urlOf(spa.id),
      await evaluate(spa.session, "document.body.innerText"),
    );
  await evaluate(spa.session, `document.querySelector('#spa').click()`);
  await waitFor(
    async () => (await urlOf(spa.id)).includes("blocked.html"),
    "SPA short-form route",
  );
  check("SPA navigation into Shorts is blocked", true);
  const modal = await open(site());
  await evaluate(modal.session, `document.querySelector('#modal').click()`);
  await waitFor(
    async () => (await urlOf(modal.id)).includes("blocked.html"),
    "short-form modal",
  );
  check("short-form player modal is blocked even without a Shorts URL", true);
  feeds = (await getState()).feedSettings;
  feeds.sites.youtube.shorts = false;
  await send({ type: "SET_FEEDS", feedSettings: feeds });
  const off = await open(site("/shorts/fixture"));
  check(
    "disabling Shorts setting restores ordinary access",
    !(await urlOf(off.id)).includes("blocked.html"),
  );
  // Actual muted video: playback is invisible to tabs.audible and must use media-state reporting.
  const mediaUrl = site("/watch?v=background-media");
  const media = await open(mediaUrl);
  await evaluate(media.session, `document.querySelector('#media').play()`);
  await sleep(500);
  await cdp("Target.activateTarget", { targetId: controller.id });
  await waitFor(async () => {
    const s = await evaluate(
      controller.session,
      `chrome.storage.session.get('trackingSessionsV3')`,
    );
    return s.trackingSessionsV3?.some((t) => t.url === mediaUrl);
  }, "background video session");
  check(
    "muted video continues counting after its tab goes into the background",
    true,
  );
  await evaluate(media.session, `document.querySelector('#media').pause()`);
  await sleep(600);
  const tracked = await evaluate(
    controller.session,
    `chrome.storage.session.get('trackingSessionsV3')`,
  );
  check(
    "paused background tabs stop counting",
    !tracked.trackingSessionsV3.some((t) => t.url === mediaUrl),
  );
  for (const host of ["x.com", "reddit.com", "substack.com"]) {
    const key = host.split(".")[0];
    let controls = (await getState()).feedSettings;
    controls.sites[key].videos = true;
    await send({ type: "SET_FEEDS", feedSettings: controls });
    const videoPage = await open(`https://${host}/watch?fixture=video`);
    await evaluate(
      videoPage.session,
      `document.querySelector('#media').play().catch(()=>{})`,
    );
    await sleep(150);
    check(
      `${key} video control suppresses actual playback`,
      await evaluate(
        videoPage.session,
        `document.querySelector('#media').paused`,
      ),
    );
    controls = (await getState()).feedSettings;
    controls.sites[key].videos = false;
    await send({ type: "SET_FEEDS", feedSettings: controls });
    await evaluate(
      videoPage.session,
      `document.querySelector('#media').play()`,
    );
    check(
      `${key} playback is available when its control is off`,
      await evaluate(
        videoPage.session,
        `!document.querySelector('#media').paused`,
      ),
    );
    await cdp("Target.closeTarget", { targetId: videoPage.id });
  }
  // Content scripts cannot make privileged settings changes, even when password protection is off.
  await cdp("Runtime.enable", {}, media.session);
  await sleep(100);
  const iso = contexts.find(
    (c) =>
      c.sessionId === media.session &&
      c.auxData?.type === "isolated" &&
      c.origin === `chrome-extension://${extId}`,
  );
  if (!iso) throw new Error("Screentime content-script world not found");
  const forbidden = await cdp(
    "Runtime.evaluate",
    {
      expression: `chrome.runtime.sendMessage({type:'DELETE_RULE',ruleId:'youtube'})`,
      contextId: iso.id,
      awaitPromise: true,
      returnByValue: true,
    },
    media.session,
  );
  check(
    "web-page content scripts cannot edit settings",
    forbidden.result.value?.ok === false,
  );
  const pass = "isolated test password";
  check(
    "optional settings password can be enabled",
    (await send({ type: "SET_SETTINGS_PASSWORD", newPassword: pass })).ok,
  );
  check(
    "password protects site changes",
    !(
      await send({
        type: "SAVE_RULE",
        rule: rule("youtube", "youtube.com", 60),
      })
    ).ok,
  );
  check(
    "password protects window changes",
    !(await send({ type: "SAVE_WINDOW", window: w })).ok,
  );
  check(
    "wrong settings password is rejected",
    !(await send({ type: "UNLOCK_SETTINGS", password: "wrong" })).ok,
  );
  check(
    "correct settings password authorizes changes",
    (
      await send({
        type: "SAVE_RULE",
        rule: rule("youtube", "youtube.com", 30),
        password: pass,
      })
    ).ok,
  );
  await cdp("Page.reload", {}, controller.session);
  await sleep(500);
  check(
    "reloading the dashboard shows the password gate",
    /Settings are protected/.test(await body()),
  );
  check(
    "protection never stores the plaintext password",
    !JSON.stringify(await getState()).includes(pass),
  );
  check(
    "authenticated user can turn password protection off",
    (
      await send({
        type: "SET_SETTINGS_PASSWORD",
        newPassword: "",
        password: pass,
      })
    ).ok,
  );
  await sleep(150);
  await evaluate(
    controller.session,
    `[...document.querySelectorAll('nav button')].find(b=>b.textContent==='Settings').click()`,
  );
  await sleep(150);
  await screenshot(controller, "settings.png");
  const popup = await open(`chrome-extension://${extId}/popup.html`);
  await screenshot(popup, "popup.png", 400, 900);
  check(
    "popup offers the same five website controls",
    await evaluate(
      popup.session,
      `document.querySelectorAll('#site-picker [role=radio]').length===5`,
    ),
  );
  const x = await send({
    type: "SAVE_RULE",
    rule: rule("youtube", "youtube.com", 0),
  });
  check(
    "limit exhaustion immediately reblocks already open tabs",
    x.ok &&
      (await waitFor(
        async () => (await urlOf(media.id)).includes("blocked.html"),
        "open tab reblock",
      )),
  );
} catch (error) {
  check("script error", false, error.message);
  if (chromeErrors) console.error("Isolated Chrome diagnostics:", chromeErrors);
} finally {
  console.log(
    `\n${checks.filter(Boolean).length} passed, ${checks.filter((x) => !x).length} failed`,
  );
  chrome.kill();
  await sleep(500);
  if (chrome.exitCode === null) chrome.kill("SIGKILL");
  for (const pipe of chrome.stdio) pipe?.destroy();
  rejectPending(Error("Test finished"));
  rmSync(profile, { recursive: true, force: true });
  process.exitCode = checks.every(Boolean) ? 0 : 1;
}
