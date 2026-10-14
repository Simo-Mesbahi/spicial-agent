import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

// Browser regression of the actual client UI. Every API response is synthetic.
const origin = 'http://127.0.0.1:4183';
const output = 'outputs/client-ui';
mkdirSync(output, { recursive: true });
const log = createWriteStream(`${output}/server.log`);
const server = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4183', '--strictPort'],
  {
    detached: true,
    env: { ...process.env, LLM_PROVIDER: 'demo', LLM_BUDGET_MODE: 'zero', P1_RELEASE_MODE: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
const now = Date.UTC(2026, 9, 14, 14);
const row = {
  id: 'synthetic-repair',
  reference: 'SAV-2026-1042',
  kind: 'repair',
  title: 'Réparation synthétique',
  description: 'Une pièce moteur est attendue.',
  status: 'waiting_part',
  status_label: 'En attente de pièce',
  product: 'Lave-linge Atlas Wash 8',
  category: 'Électroménager',
  customer: 'Client fictif',
  city: 'Ville fictive',
  store: 'Maison Atlas',
  warranty: 'Prise en charge validée',
  quote_cents: null,
  refund_cents: null,
  delivery_mode: 'Retrait au magasin',
  estimate: null,
  version: 0,
  updated_at: now,
  created_at: now,
  demoCode: '123456',
  verified: false,
};
const brief = {
  schema: 1,
  caseId: row.id,
  reference: row.reference,
  product: row.product,
  status: row.status,
  statusLabel: row.status_label,
  version: 0,
  updatedAt: now,
  explanation: row.description,
  nextLabel: 'En réparation',
  customerStep: 'Aucune action client supplémentaire.',
  estimate: null,
  amount: null,
};
const snapshot = {
  space: {
    id: 'synthetic-space',
    csrf: 'synthetic-csrf',
    expiresAt: now + 86400000,
    running: false,
    tick: 0,
  },
  cases: [row],
  events: [],
  messages: [],
  handoffs: [],
  logs: [],
  articles: [],
  serverTime: now,
  config: { provider: 'demo', ready: true, budgetMode: 'zero', edition: 'client' },
};
const french =
  'Votre dossier est en attente de pièce.\n\nJe peux répondre en français, anglais, allemand, espagnol et arabe.\n\n| Étape | Situation |\n| --- | --- |\n| En attente de pièce | État actuel enregistré |\n| En réparation | Suite prévue, pas encore réalisée |\n\nAucun délai confirmé enregistré.';
const arabic =
  'ملفك في انتظار قطعة الغيار.\n\n| المرحلة | الحالة |\n| --- | --- |\n| انتظار قطعة الغيار | الحالة المسجلة |\n| الإصلاح | مرحلة متوقعة لم تتم بعد |';
let started = false;
let browser;
let page;
const errors = [];
const checks = [];
async function check(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'page overflow',
  );
}
async function capture(name) {
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
}
try {
  for (let i = 0; ; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${server.exitCode}`);
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(1500) })).ok) break;
    } catch {}
    if (i >= 60) throw new Error('Server readiness timeout');
    await pause(500);
  }
  browser = await chromium.launch({
    channel: process.env.CLIENT_UI_BROWSER_CHANNEL || 'chrome',
    headless: true,
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let body;
    let status = 200;
    if (url.pathname === '/api/snapshot') {
      status = started ? 200 : 401;
      body = started ? snapshot : { error: 'Espace fictif requis.' };
    } else if (url.pathname === '/api/session' && route.request().method() === 'POST') {
      started = true;
      status = 201;
      body = snapshot;
    } else if (url.pathname === '/api/verify') {
      row.verified = true;
      body = { case: row };
    } else if (url.pathname === '/api/chat') {
      const input = route.request().postDataJSON();
      const content = /[\u0600-\u06ff]/u.test(input.message)
        ? arabic
        : /tableau/i.test(input.message)
          ? french
          : 'Votre dossier est en attente de pièce.';
      const reply = {
        id: `reply-${snapshot.messages.length}`,
        case_id: row.id,
        role: 'assistant',
        content,
        metadata: {
          mode: 'demo',
          providerCalls: 0,
          fallback: null,
          presentation: content.includes('|') ? 'text' : 'case_brief',
          caseBrief: brief,
        },
        created_at: now,
      };
      snapshot.messages.push(
        {
          id: `user-${snapshot.messages.length}`,
          case_id: row.id,
          role: 'user',
          content: input.message,
          metadata: {},
          created_at: now,
        },
        reply,
      );
      body = { ...reply, messages: snapshot.messages.slice(-2) };
    } else throw new Error(`Unexpected API request: ${url.pathname}`);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/demo`);
  await check('guided access and verification form remain usable', async () => {
    await page.getByRole('button', { name: 'Essayer ce scénario' }).click();
    await page.getByRole('button', { name: 'Utiliser ce code' }).click();
    await page.getByRole('button', { name: 'Vérifier et consulter le dossier' }).click();
    await page.getByRole('heading', { name: 'En attente de pièce', exact: true }).waitFor();
  });
  await page.getByRole('button', { name: 'Masquer le guide' }).click();
  await check('complete response uses a semantic table with readable prose', async () => {
    await page
      .getByRole('textbox', { name: 'Votre message' })
      .fill('Les langues et un tableau des étapes de mon dossier');
    await page.getByRole('button', { name: 'Envoyer le message' }).click();
    await page.getByRole('table').waitFor();
    assert.equal(await page.locator('.response-table-wrap th[scope="col"]').count(), 2);
    assert.ok(
      (await page
        .locator('.response-prose')
        .first()
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 15,
    );
    await noOverflow();
    await capture('client-desktop');
  });
  for (const width of [320, 390, 768]) {
    await check(`client layout and table remain bounded at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow();
      const wrap = page.getByRole('region', { name: 'Tableau de la réponse' });
      assert.ok((await wrap.boundingBox()).width <= width);
      assert.ok(
        (await page
          .getByRole('textbox', { name: 'Votre message' })
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))) >= 16,
      );
      assert.ok(
        (await page.getByRole('button', { name: 'Envoyer le message' }).boundingBox()).height >= 44,
      );
      if (width === 390) await capture('client-mobile');
    });
  }
  await check('table is keyboard focusable with a visible focus ring', async () => {
    const wrap = page.getByRole('region', { name: 'Tableau de la réponse' });
    await wrap.focus();
    assert.ok((await wrap.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))) >= 2);
  });
  await check('Arabic paragraphs and table cells select their own reading direction', async () => {
    await page.getByRole('textbox', { name: 'Votre message' }).fill('أريد جدول مراحل ملفي');
    await page.getByRole('button', { name: 'Envoyer le message' }).click();
    await page.getByText('ملفك في انتظار قطعة الغيار.', { exact: true }).waitFor();
    assert.equal(
      await page
        .locator('.response-prose')
        .last()
        .evaluate((el) => getComputedStyle(el).direction),
      'rtl',
    );
    assert.equal(
      await page.locator('.response-table-wrap').last().locator('td').first().getAttribute('dir'),
      'auto',
    );
    await noOverflow();
    await capture('client-arabic-mobile');
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify({ passed: true, checks, pageErrors: errors, externalProviderCalls: 0 }, null, 2),
  );
} catch (error) {
  await page?.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify({ passed: false, checks, pageErrors: errors, error: String(error) }, null, 2),
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
