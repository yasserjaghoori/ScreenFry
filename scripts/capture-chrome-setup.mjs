/** Capture Chrome's real Developer mode switch using an isolated, temporary test profile. */
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const profile = mkdtempSync(join(tmpdir(), "screenfry-setup-capture-"));
const output = resolve(import.meta.dirname, "../safari/ScreenFry/ScreenFry/SetupImages");
const browser = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb", "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
let id = 0, buffer = "";
const pending = new Map();
browser.stdio[4].on("data", chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\0")) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const item = pending.get(message.id);
    if (!item) continue;
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error ? item.reject(Error(JSON.stringify(message.error))) : item.resolve(message.result);
  }
});
function cdp(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`Timeout: ${method}`)); }, 20000);
    pending.set(requestId, { resolve, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id: requestId, method, params, sessionId }) + "\0");
  });
}
try {
  await cdp("Browser.getVersion");
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1100, height: 600, deviceScaleFactor: 2, mobile: false }, sessionId);
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] }, sessionId);
  await cdp("Page.navigate", { url: "chrome://extensions" }, sessionId);
  const toggle = "document.querySelector('extensions-manager')?.shadowRoot?.querySelector('extensions-toolbar')?.shadowRoot?.querySelector('#devMode')";
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(`!!(${toggle})`)) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw Error("Chrome Developer mode toggle not found; update selector for this Chrome version.");
  mkdirSync(output, { recursive: true });
  for (const [name, enabled] of [["ChromeDeveloperModeOff", false], ["ChromeDeveloperModeOn", true]]) {
    await evaluate(`{ const toggle = ${toggle}; if (toggle.checked !== ${enabled}) toggle.click(); }`);
    await new Promise(resolve => setTimeout(resolve, 300));
    const checked = await evaluate(`(${toggle}).checked`);
    if (checked !== enabled) throw Error("Developer mode did not reach the expected state");
    const clip = await evaluate(`{ const r = (${toggle}).getBoundingClientRect(); ({x: Math.max(0, r.right - 160), y: Math.max(0, r.top - 16), width: 170, height: 56, scale: 1}); }`);
    const { data } = await cdp("Page.captureScreenshot", { format: "png", clip }, sessionId);
    writeFileSync(join(output, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`Captured ${name}: Developer mode ${checked ? "on" : "off"}`);
  }
} finally {
  const exited = new Promise(resolve => browser.once("exit", resolve));
  browser.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true });
}
