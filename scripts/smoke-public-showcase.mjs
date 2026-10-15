import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

const origin = 'http://127.0.0.1:4181';
const output = 'outputs/public-showcase';
const commercialContact = 'Mohammed.elmesbahi@outlook.com';
const htmlBudgetBytes = 128 * 1024;
const responsiveViewports = [
  { name: 'compact', width: 320, height: 720 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'reflow', width: 640, height: 900 },
  { name: 'laptop', width: 1024, height: 768 },
];
mkdirSync(output, { recursive: true });
const log = createWriteStream(`${output}/server.log`);
const server = spawn('npm', ['run', 'start', '--', '--hostname', '127.0.0.1', '--port', '4181'], {
  detached: true,
  env: { ...process.env, LLM_PROVIDER: 'demo', LLM_BUDGET_MODE: 'zero', P1_RELEASE_MODE: 'off' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });

let browser;
let page;
let rootMetrics = null;
let rootHtmlBytes = null;
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

async function navigationMetrics() {
  return page.evaluate(() => {
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
}

async function capture(name) {
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
  await page.screenshot({ path: `${output}/${name}-first-screen.png`, animations: 'disabled' });
}

try {
  await waitForServer();

  await check('public HTML stays within the static payload budget', async () => {
    const response = await fetch(origin, { headers: { accept: 'text/html' } });
    assert.equal(response.ok, true);
    const html = await response.text();
    rootHtmlBytes = Buffer.byteLength(html);
    assert.ok(
      rootHtmlBytes <= htmlBudgetBytes,
      `root HTML ${rootHtmlBytes} B exceeds ${htmlBudgetBytes} B budget`,
    );
  });

  browser = await chromium.launch({
    channel: process.env.SHOWCASE_BROWSER_CHANNEL || 'chrome',
    headless: true,
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
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
    await page.getByRole('heading', { level: 1, name: /Un SAV plus clair/ }).waitFor();
    await page.getByRole('link', { name: 'Explorer la démonstration', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Demander un essai accompagné' }).first().waitFor();
    await noOverflow();
    rootMetrics = await navigationMetrics();
    await capture('showcase-desktop');
  });

  await check('public first view performs no API or third-party request', async () => {
    const publicRequests = requests.filter((value) => value.startsWith(origin));
    const apiRequests = publicRequests.filter((value) =>
      new URL(value).pathname.startsWith('/api/'),
    );
    const externalRequests = requests.filter((value) => !value.startsWith(origin));
    assert.deepEqual(apiRequests, []);
    assert.deepEqual(externalRequests, []);
  });

  await check('keyboard entry exposes the skip link and real CTA routes', async () => {
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('href')),
      '#main-content',
      'first keyboard stop should be the skip link',
    );
    const demo = page.getByRole('link', { name: 'Explorer la démonstration', exact: true });
    const trial = page.getByRole('link', { name: 'Demander un essai accompagné' }).first();
    assert.equal(await demo.getAttribute('href'), '/demo');
    assert.equal(await trial.getAttribute('href'), '/trial');
    await demo.focus();
    assert.equal(await demo.evaluate((element) => document.activeElement === element), true);
  });

  await check(
    'four scenarios work with native keyboard controls and disclose their limits',
    async () => {
      await page.getByRole('radio', { name: 'Réparation', exact: true }).focus();
      assert.equal(
        await page.getByRole('region', { name: 'Exemple réparation' }).isVisible(),
        true,
      );
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.getByRole('radio', { name: 'Devis', exact: true }).isChecked(), true);
      assert.equal(await page.getByRole('region', { name: 'Exemple devis' }).isVisible(), true);
      assert.equal(
        await page.getByRole('region', { name: 'Exemple réparation' }).isVisible(),
        false,
      );
      for (const [label, panel] of [
        ['Livraison', 'Exemple livraison'],
        ['Retour', 'Exemple retour'],
        ['Réparation', 'Exemple réparation'],
      ]) {
        await page.getByText(label, { exact: true }).click();
        const region = page.getByRole('region', { name: panel });
        assert.equal(await region.isVisible(), true);
        assert.equal(await page.locator('.showcase-scenario-panel:visible').count(), 1);
        assert.ok((await region.locator('.showcase-scenario-boundary').innerText()).length > 20);
        await noOverflow();
      }
      assert.deepEqual(
        requests.filter((value) => new URL(value).pathname.startsWith('/api/')),
        [],
      );
    },
  );

  await check('FAQ can be opened and closed with the keyboard', async () => {
    const question = page.getByText('Quand peut-on l’ouvrir à nos vrais clients ?', {
      exact: true,
    });
    await question.focus();
    await page.keyboard.press('Enter');
    const answer = page.getByText(/Les fonctions IA avancées restent soumises à qualification/);
    assert.equal(await answer.isVisible(), true);
    await page.keyboard.press('Enter');
    assert.equal(await answer.isVisible(), false);
  });

  await check('public section links and image dimensions are complete', async () => {
    const anchors = await page
      .locator('a[href^="#"]')
      .evaluateAll((elements) => elements.map((el) => el.getAttribute('href')));
    for (const href of anchors)
      assert.equal(await page.locator(href).count(), 1, `missing or duplicate target ${href}`);
    for (const image of await page.locator('.showcase-product-capture img').all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((element) => element.decode());
      const shape = await image.evaluate((element) => ({
        width: element.naturalWidth,
        height: element.naturalHeight,
        declaredWidth: Number(element.getAttribute('width')),
        declaredHeight: Number(element.getAttribute('height')),
        alt: element.alt,
      }));
      assert.equal(shape.width, shape.declaredWidth);
      assert.equal(shape.height, shape.declaredHeight);
      assert.ok(shape.alt.length > 30);
    }
  });

  await check('all public internal destinations resolve successfully', async () => {
    await page.goto(origin, { waitUntil: 'networkidle' });
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((elements) => [
        ...new Set(elements.map((element) => element.getAttribute('href')).filter(Boolean)),
      ]);
    assert.ok(hrefs.length >= 4, 'expected core internal showcase destinations');
    for (const href of hrefs) {
      const response = await fetch(new URL(href, origin), { redirect: 'manual' });
      assert.ok(
        response.status >= 200 && response.status < 400,
        `${href} returned HTTP ${response.status}`,
      );
    }
  });

  for (const viewport of responsiveViewports) {
    await check(`showcase has no horizontal overflow at ${viewport.width}px`, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(origin, { waitUntil: 'networkidle' });
      await noOverflow();
      assert.equal(
        await page.getByRole('navigation', { name: 'Navigation principale' }).isVisible(),
        true,
        'section navigation should remain available on small screens',
      );
      for (const label of ['Réparation', 'Devis', 'Livraison', 'Retour']) {
        await page.getByText(label, { exact: true }).click();
        await noOverflow();
      }
      await page.getByText('Réparation', { exact: true }).click();
      for (const control of await page
        .locator(
          '.showcase-nav-links a, .showcase-button, .showcase-scenario-option > span, .showcase-faq summary',
        )
        .all()) {
        const bounds = await control.boundingBox();
        assert.ok(
          bounds.height >= 44 && bounds.width >= 24,
          `small control at ${viewport.width}px`,
        );
      }
      assert.equal(
        await page
          .locator('.showcase-button')
          .first()
          .evaluate((element) => getComputedStyle(element).transitionDuration),
        '0s',
      );
      if (['compact', 'mobile', 'tablet', 'laptop'].includes(viewport.name))
        await capture(`showcase-${viewport.name}`);
    });
  }

  await check('guided-trial page exposes only the confirmed commercial recipient', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/trial`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /Préparons une\s*démonstration utile/ }).waitFor();
    await page.getByText(/Contact commercial confirmé/).waitFor();
    const mail = page.getByRole('link', { name: 'Préparer ma demande par email' });
    const href = await mail.getAttribute('href');
    assert.ok(href?.startsWith(`mailto:${commercialContact}?subject=`));
    assert.match(href ?? '', /body=/);
    assert.doesNotMatch(href ?? '', /outloo\.com/i);
    assert.equal(
      await page.getByRole('textbox', { name: /Copiez l’adresse/ }).inputValue(),
      commercialContact,
    );
    await page.getByRole('button', { name: 'Copier' }).waitFor();
    assert.equal(await page.locator('form').count(), 0);
    await noOverflow();
    await capture('trial-mobile');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await noOverflow();
    await capture('trial-desktop');
  });

  await check('scenarios and FAQ also work with JavaScript disabled', async () => {
    const staticPage = await browser.newPage({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    try {
      await staticPage.route('**/*', (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
      );
      await staticPage.goto(origin, { waitUntil: 'networkidle' });
      await staticPage.getByText('Retour', { exact: true }).click();
      assert.equal(
        await staticPage.getByRole('region', { name: 'Exemple retour' }).isVisible(),
        true,
      );
      await staticPage.getByText('Que puis-je essayer dès maintenant ?', { exact: true }).click();
      assert.equal(
        await staticPage.getByText(/La démonstration permet d’explorer le suivi/).isVisible(),
        true,
      );
    } finally {
      await staticPage.close();
    }
  });

  assert.deepEqual(pageErrors, []);
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify(
      {
        passed: true,
        browser: browser.version(),
        checks,
        pageErrors,
        rootPerformance: {
          htmlBytes: rootHtmlBytes,
          htmlBudgetBytes,
          navigation: rootMetrics,
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (page)
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify(
      {
        passed: false,
        checks,
        pageErrors,
        rootPerformance: {
          htmlBytes: rootHtmlBytes,
          htmlBudgetBytes,
          navigation: rootMetrics,
        },
        error: String(error),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  if (server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  }
  log.end();
}
