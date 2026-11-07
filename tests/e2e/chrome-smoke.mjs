/**
 * End-to-end smoke test against a real Chrome. Loads dist/chrome into a throwaway headless
 * profile through the DevTools protocol (branded Chrome no longer accepts --load-extension),
 * then drives onboarding, blocking, commitment locking and a PIN override.
 *
 *   npm run test:e2e            (CHROME_PATH overrides the browser binary)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extPath = resolve(fileURLToPath(new URL('../../dist/chrome', import.meta.url)));
const chromePath = process.env.CHROME_PATH ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const profile = mkdtempSync(join(tmpdir(), 'screentime-e2e-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const out = chrome.stdio[3], inp = chrome.stdio[4];
let id = 0, buf = '';
const pending = new Map();
const contexts = [];
inp.on('data', (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.method === 'Runtime.executionContextCreated') contexts.push({ sessionId: msg.sessionId, ...msg.params.context });
    if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
  }
});
const cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const mid = ++id; pending.set(mid, { resolve, reject }); out.write(JSON.stringify({ id: mid, method, params, sessionId }) + '\0'); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

async function attach(targetId) { return (await cdp('Target.attachToTarget', { targetId, flatten: true })).sessionId; }
async function evaluate(sessionId, expression) {
  const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
async function urlOf(targetId) { return (await cdp('Target.getTargets')).targetInfos.find((t) => t.targetId === targetId)?.url; }

try {
  const { id: extId } = await cdp('Extensions.loadUnpacked', { path: extPath });
  check('extension loads', Boolean(extId), extId);
  await sleep(1500);
  const targets = (await cdp('Target.getTargets')).targetInfos;
  check('service worker running', targets.some((t) => t.type === 'service_worker' && t.url.includes(extId)));
  const onboarding = targets.find((t) => t.url.includes('onboarding.html'));
  check('onboarding opens on install', Boolean(onboarding));

  const { targetId: pageId } = await cdp('Target.createTarget', { url: `chrome-extension://${extId}/dashboard.html` });
  await sleep(800);
  const page = await attach(pageId);
  check('dashboard redirects to onboarding before setup', (await urlOf(pageId)).includes('onboarding.html'));
  const send = (req) => evaluate(page, `chrome.runtime.sendMessage(${JSON.stringify(req)})`);

  check('rule refused before PIN', !(await send({ type: 'SAVE_RULE', rule: { id: 'r1', label: 'Example', domains: ['example.com'], enabled: true, dailyAllowance: { defaultMinutes: 0 }, schedules: [], enforcementMode: 'pin', createdAt: 0, updatedAt: 0 } })).ok);
  check('PIN created', (await send({ type: 'CREATE_PIN', pin: '482915' })).ok);
  check('onboarding completes', (await send({ type: 'COMPLETE_ONBOARDING' })).ok);
  check('PIN cannot be overwritten', !(await send({ type: 'CREATE_PIN', pin: '000000' })).ok);
  const saved = await send({ type: 'SAVE_RULE', rule: { id: 'r1', label: 'Example', domains: ['example.com'], enabled: true, dailyAllowance: { defaultMinutes: 0 }, schedules: [], commitmentEndsAt: Date.now() + 7 * 864e5, enforcementMode: 'pin', createdAt: 0, updatedAt: 0 } });
  check('sealed 0-minute rule saved', saved.ok && saved.data.outcome === 'created');
  await sleep(500);
  const dnr = await evaluate(page, 'chrome.declarativeNetRequest.getDynamicRules()');
  check('network rule installed', dnr.length === 1, dnr[0]?.condition?.regexFilter);

  const { targetId: siteId } = await cdp('Target.createTarget', { url: 'https://www.example.com/some/path?q=1' });
  await sleep(1500);
  const blockedUrl = await urlOf(siteId);
  check('direct link redirected to blocked page', blockedUrl.includes('blocked.html'), blockedUrl);
  check('original URL preserved', blockedUrl.includes('www.example.com/some/path?q=1'));
  const blockedSession = await attach(siteId);
  await sleep(800);
  const text = await evaluate(blockedSession, 'document.body.innerText');
  check('blocked page renders', /Example is sealed/.test(text), text.split('\n').slice(0, 4).join(' | '));
  check('blocked page has no disable button', !/disable|turn off/i.test(text));

  const { targetId: subId } = await cdp('Target.createTarget', { url: 'http://sub.example.com/' });
  await sleep(1200);
  check('subdomain redirected', (await urlOf(subId)).includes('blocked.html'));

  const weaken = await send({ type: 'SAVE_RULE', rule: { ...saved.data.state.rules[0], dailyAllowance: { defaultMinutes: 600 } } });
  check('weakening queued, not applied', weaken.ok && weaken.data.outcome === 'pending' && weaken.data.state.rules[0].dailyAllowance.defaultMinutes === 0);
  const del = await send({ type: 'DELETE_RULE', ruleId: 'r1' });
  check('deletion queued, rule kept', del.ok && del.data.outcome === 'pending' && del.data.state.rules.length === 1);
  check('reset refused while committed', !(await send({ type: 'RESET_ALL', pin: '482915' })).ok);

  const blockedSend = (req) => evaluate(blockedSession, `chrome.runtime.sendMessage(${JSON.stringify(req)})`);
  const wrong = await blockedSend({ type: 'VERIFY_AND_OVERRIDE', pin: '000000', url: 'https://www.example.com/' });
  check('wrong PIN rejected', !wrong.ok);
  const ov = await blockedSend({ type: 'VERIFY_AND_OVERRIDE', pin: '482915', url: 'https://www.example.com/' });
  check('override granted for 10 minutes', ov.ok && ov.data.expiresAt - ov.data.startedAt === 600000);
  await sleep(500);
  check('network rule removed during override', (await evaluate(page, 'chrome.declarativeNetRequest.getDynamicRules()')).length === 0);
  const { targetId: site2 } = await cdp('Target.createTarget', { url: 'https://example.com/' });
  await sleep(2000);
  const u2 = await urlOf(site2);
  check('site reachable during override', !u2.includes('blocked.html'), u2);
  const again = await blockedSend({ type: 'VERIFY_AND_OVERRIDE', pin: '482915', url: 'https://example.com/' });
  check('second tab does not extend override', again.ok && again.data.alreadyActive && again.data.expiresAt === ov.data.expiresAt);
  const s2 = await attach(site2);
  await sleep(1500);
  const pill = await evaluate(s2, `!!document.querySelector('screentime-overlay')`);
  check('override countdown overlay shown', pill);
  await cdp('Runtime.enable', {}, s2);
  await sleep(500);
  const iso = contexts.find((c) => c.sessionId === s2 && c.auxData?.type === 'isolated');
  const r = await cdp('Runtime.evaluate', { expression: `chrome.runtime.sendMessage({type:'DELETE_RULE', ruleId:'r1'})`, contextId: iso.id, awaitPromise: true, returnByValue: true }, s2);
  const fromPage = r.result.value;
  check('content script cannot call privileged actions', !fromPage.ok, fromPage.error);

  // Expire the override by editing storage (simulates 10 minutes passing) and confirm re-blocking.
  await evaluate(page, `chrome.storage.local.get('screentimeState').then(({screentimeState:s}) => { for (const o of Object.values(s.overrides)) { o.startedAt -= 600000; o.expiresAt -= 600000; } return chrome.storage.local.set({screentimeState:s}); })`);
  await sleep(2500);
  const u3 = await urlOf(site2);
  check('restriction reapplies when override ends', u3.includes('blocked.html'), u3);
} catch (error) {
  check('script error', false, error.message);
} finally {
  console.log(results.join('\n'));
  chrome.kill();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  const failed = results.filter((line) => line.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}
