import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:4181';
const output = 'outputs/public-showcase';
const commercialContact = 'Mohammed.elmesbahi@outlook.com';
mkdirSync(output, { recursive: true });
const log = createWriteStream(`${output}/server.log`);
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4181', '--strictPort'], {
  detached: true,
  env: { ...process.env, LLM_PROVIDER: 'demo', LLM_BUDGET_MODE: 'zero', P1_RELEASE_MODE: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });

let browser;
let page;
const checks = [];
const requests = [];
const pageErrors = [];

async function check(name, run) {
  const start = performance.now();
  await run();
  checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) });
  console.log(`PASS ${name}`);
}

async function waitForServer() {
  for (let attempt = 0; attempt <= 60; attempt++) {
    if (server.exitCode !== null) throw new Error(`App server exited: ${server.exitCode}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {}
    if (attempt === 60) throw new Error('Showcase server readiness timeout');
    await pause(500);
  }
}

async function noOverflow() {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'horizontal overflow',
  );
}

async function capture(name) {
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
}

try {
  await waitForServer();
  browser = await chromium.launch({ channel: process.env.SHOWCASE_BROWSER_CHANNEL || 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    return route.continue();
  });

  await check('desktop showcase renders with commercial navigation', async () => {
    const response = await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(response?.ok(), true);
    await page.getByRole('heading', { level: 1, name: /Des demandes client plus claires/ }).waitFor();
    await page.getByRole('link', { name: 'Découvrir la démonstration' }).waitFor();
    await page.getByRole('link', { name: 'Demander un essai accompagné' }).first().waitFor();
    await noOverflow();
    await capture('showcase-desktop');
  });

  await check('public first view performs no API or third-party request', async () => {
    const publicRequests = requests.filter((value) => value.startsWith(origin));
    const apiRequests = publicRequests.filter((value) => new URL(value).pathname.startsWith('/api/'));
    const externalRequests = requests.filter((value) => !value.startsWith(origin));
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(externalRequests, []);
  });

  await check('keyboard-visible destinations remain real routes', async () => {
    const demo = page.getByRole('link', { name: 'Découvrir la démonstration' });
    const trial = page.getByRole('link', { name: 'Demander un essai accompagné' }).first();
    assert.equal(await demo.getAttribute('href'), '/demo');
    assert.equal(await trial.getAttribute('href'), '/trial');
    await demo.focus();
    assert.equal(await demo.evaluate((element) => document.activeElement === element), true);
  });

  await check('mobile showcase has no horizontal overflow', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await noOverflow();
    await capture('showcase-mobile');
  });

  await check('guided-trial page exposes only the confirmed commercial recipient', async () => {
    await page.goto(`${origin}/trial`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Préparons une démonstration utile/ }).waitFor();
    await page.getByText(/Contact commercial confirmé/).waitFor();
    const mail = page.getByRole('link', { name: 'Préparer ma demande par email' });
    const href = await mail.getAttribute('href');
    assert.ok(href?.startsWith(`mailto:${commercialContact}?subject=`));
    assert.match(href ?? '', /body=/);
    assert.equal(await page.locator('form').count(), 0);
    await noOverflow();
    await capture('trial-mobile');
  });

  const metrics = await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (!(navigation instanceof PerformanceNavigationTiming)) return null;
    return {
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      loadMs: Math.round(navigation.loadEventEnd),
      transferSize: navigation.transferSize,
      encodedBodySize: navigation.encodedBodySize,
      decodedBodySize: navigation.decodedBodySize,
    };
  });

  assert.deepEqual(pageErrors, []);
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify({ passed: true, browser: browser.version(), checks, pageErrors, metrics }, null, 2),
  );
} catch (error) {
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify({ passed: false, checks, pageErrors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  if (server.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  }
  log.end();
}
