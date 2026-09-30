import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

// Every browser API request is intercepted. No credentials, business data or LLM calls.
const origin = 'http://127.0.0.1:4177';
const output = 'outputs/admin-ui';
mkdirSync(output, { recursive: true });
const log = createWriteStream(`${output}/server.log`);
const server = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4177', '--strictPort'],
  {
    detached: true,
    env: { ...process.env, LLM_PROVIDER: 'demo', LLM_BUDGET_MODE: 'zero', P1_RELEASE_MODE: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
let browser;
let page;
const checks = [];
const errors = [];
const org = '00000000-0000-4000-8000-000000000001';
const items = Array.from({ length: 65 }, (_, i) => ({
  id: `case-${i}`,
  reference: `SAV-2026-${String(i + 1).padStart(4, '0')}`,
  service_type: 'sav',
  kind: 'repair',
  title: 'Dossier synthétique',
  status: i % 2 ? 'waiting_part' : 'diagnosis',
  product: 'Produit test',
  updated_at: '2026-09-29T12:00:00Z',
  archived_at: null,
}));
const config = {
  provider: 'demo',
  model: '',
  fallbackProvider: null,
  autoFailover: false,
  dailyLimit: 0,
  ragResults: 2,
  ragMinAnchors: 1,
};
const calls = [];
let ragMode = 'lexical';
let ragFailure = false;
let degraded = false;
const settings = () => ({
  effectiveProvider: 'demo',
  providerWarning: null,
  environment: 'LOCAL',
  canEdit: true,
  revision: 0,
  config,
  budget: 'zero',
  scope: 'Test synthétique',
  effectiveAutoFailover: false,
  failoverWarning: null,
  fallbackProviders: [],
  providers: [
    { provider: 'demo', model: '', label: 'Réponses documentaires', available: true, reason: null },
  ],
  history: [],
  rag: {
    mode: ragMode,
    minAnchorsApplies: false,
    previewMayUseEmbedding: ragMode === 'hybrid',
    locale: 'fr-FR',
    market: 'FR',
  },
});
async function check(name, run) {
  const start = performance.now();
  await run();
  checks.push({ name, passed: true, durationMs: Math.round(performance.now() - start) });
  console.log(`PASS ${name}`);
}
async function capture(name) {
  // Start at the top so sticky navigation is not composited over scrolled content.
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: 'disabled' });
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'horizontal overflow',
  );
}
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error(`App server exited: ${server.exitCode}`);
    try {
      const response = await fetch(`${origin}/admin/operations`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) break;
    } catch {}
    if (attempt >= 60) throw new Error('App server readiness timeout');
    await pause(500);
  }
  browser = await chromium.launch({
    channel: process.env.ADMIN_UI_BROWSER_CHANNEL || 'chrome',
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
    if (!url.pathname.startsWith('/api/production/')) return route.continue();
    const path = url.pathname;
    assert.equal(
      route.request().method(),
      path.endsWith('/settings/preview') ? 'POST' : 'GET',
      'unexpected mutation in read-only browser checks',
    );
    calls.push({
      path,
      params: Object.fromEntries(url.searchParams),
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    let body;
    let status = 200;
    if (path.endsWith('/config')) body = { environment: 'LOCAL' };
    else if (path.endsWith('/admin/session'))
      body = {
        admin: {
          userId: 'synthetic',
          email: 'synthetic@example.test',
          aal: 'aal2',
          memberships: [
            { organizationId: org, organizationName: 'Test synthétique', role: 'super_admin' },
          ],
        },
      };
    else if (path.endsWith('/overview'))
      body = {
        overview: {
          cases: { total: 65, open: 65, overdue: 0, without_eta: 0, stale: 0 },
          handoffs: { open: 0, unassigned: 0 },
          performance: {
            p95_latency_ms_24h: 0,
            requests_24h: 0,
            error_rate_24h: 0,
            rate_limited_24h: 0,
          },
          routes: [],
        },
      };
    else if (path.endsWith('/queue')) body = { queue: { priorities: [], handoffs: [] } };
    else if (path.endsWith('/audit')) body = { audit: { items: [], total: 0 } };
    else if (path.endsWith('/admin/cases')) {
      const rows = items.filter(
        (item) => !url.searchParams.get('status') || item.status === url.searchParams.get('status'),
      );
      assert.equal(url.searchParams.get('limit'), '30');
      const offset = Number(url.searchParams.get('offset'));
      body = { items: rows.slice(offset, offset + 30), total: rows.length };
    } else if (path.endsWith('/case/options')) body = { stores: [] };
    else if (path.endsWith('/case')) {
      const item = items.find((value) => value.id === url.searchParams.get('caseId'));
      body = {
        case: {
          ...item,
          description: 'Synthétique',
          version: 1,
          customer: null,
          customer_id: null,
          product: null,
          product_id: null,
          store: null,
          store_id: null,
          estimated_at: null,
          events: [],
          notes: [],
          handoffs: [],
          warranty_status: 'unknown',
          warranty_label: null,
          currency: 'EUR',
          quote_cents: null,
          refund_cents: null,
          delivery_mode: null,
        },
      };
    } else if (path.endsWith('/deployment')) body = { organizationId: org };
    else if (path.endsWith('/settings')) {
      assert.equal(route.request().method(), 'GET', 'preview must not save configuration');
      body = settings();
    } else if (path.endsWith('/settings/preview')) {
      const input = route.request().postDataJSON();
      assert.equal(input.allowEmbedding, ragMode === 'hybrid');
      if (ragFailure) {
        status = 503;
        body = { error: 'Recherche publiée indisponible.', code: 'rag_preview_unavailable' };
      } else
        body = {
          documents: [
            {
              id: 'published-doc',
              title: 'Procédure publiée synthétique',
              version: '2',
              body: 'Les sources publiées guident la réponse.',
              effective: '',
              evidence: {
                chunkId: 'chunk',
                score: 4,
                locale: 'fr-FR',
                market: 'FR',
                channels: ['lexical'],
              },
            },
          ],
          diagnostics: {
            mode: ragMode,
            scope: 'supabase_published',
            outcome: 'lexical_hit',
            retrievedAt: new Date().toISOString(),
            latencyMs: 12,
            embeddingCalls: ragMode === 'hybrid' && !degraded ? 1 : 0,
            embeddingError: degraded ? 'budget_exhausted' : null,
            fallbackReason: degraded ? 'budget_exhausted' : null,
          },
        };
    } else if (path.endsWith('/p1-release'))
      body = {
        metrics: {
          canary: { selected: 0, released: 0, blocked: 0 },
          quality: {},
          latency: {},
          usage: {},
        },
        configuration: { mode: 'off', ready: false, issues: [] },
      };
    else throw new Error(`Unexpected synthetic API request: ${path}`);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/admin/operations`);
  const navigation = page.getByRole('navigation', { name: 'Pages des dossiers' });
  await check('65 dossiers accessibles sur trois pages et filtres soumis conservés', async () => {
    await navigation.waitFor();
    assert.match(await navigation.innerText(), /1–30 sur 65/);
    await navigation.getByRole('button', { name: 'Suivant' }).click();
    await page.getByText('31–60 sur 65 dossiers', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Rechercher un dossier' }).fill('non appliqué');
    await navigation.getByRole('button', { name: 'Suivant' }).click();
    await page.getByText('61–65 sur 65 dossiers', { exact: true }).waitFor();
    assert.equal(
      calls.filter((call) => call.path.endsWith('/admin/cases')).at(-1).params.search,
      '',
    );
    assert.equal(await navigation.getByRole('button', { name: 'Suivant' }).isDisabled(), true);
    await noOverflow();
    await capture('operations-desktop');
  });
  await check('filtre statut et navigation au clavier', async () => {
    await page.getByRole('textbox', { name: 'Rechercher un dossier' }).fill('');
    await page.getByLabel('Filtrer par statut').selectOption('waiting_part');
    await page.getByText('1–30 sur 32 dossiers', { exact: true }).waitFor();
    await navigation.getByRole('button', { name: 'Suivant' }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('31–32 sur 32 dossiers', { exact: true }).waitFor();
  });
  await check('modification conservée après refus de quitter le dossier', async () => {
    await page.locator('.admin-ops-case-results button').first().click();
    await page.getByRole('button', { name: 'Modifier', exact: true }).click();
    await page.locator('.admin-ops-edit-form input').first().fill('Modification non enregistrée');
    page.once('dialog', (dialog) => dialog.dismiss());
    await navigation.getByRole('button', { name: 'Précédent' }).click();
    assert.equal(
      await page.locator('.admin-ops-edit-form input').first().inputValue(),
      'Modification non enregistrée',
    );
    page.once('dialog', (dialog) => dialog.accept());
    await navigation.getByRole('button', { name: 'Précédent' }).click();
    await page.getByText('1–30 sur 32 dossiers', { exact: true }).waitFor();
  });
  await check('liste mobile sans débordement horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigation.scrollIntoViewIfNeeded();
    await noOverflow();
    await capture('operations-mobile');
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/admin/performance`);
  await page.getByRole('button', { name: /Réglages de l’assistant/ }).click();
  await check('aperçu publié sans sauvegarde et précision statique désactivée', async () => {
    await page.getByText('Base publiée · recherche lexicale', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Précision du corpus de démonstration').isDisabled(), true);
    await page.getByRole('button', { name: 'Tester la recherche' }).click();
    await page.getByText('Procédure publiée synthétique · v2', { exact: true }).waitFor();
    await page.getByText('Procédure publiée synthétique · v2', { exact: true }).click();
    await capture('rag-desktop');
  });
  await check('consentement embedding explicite et mode dégradé visible', async () => {
    ragMode = 'hybrid';
    degraded = true;
    await page.reload();
    await page.getByRole('button', { name: /Réglages de l’assistant/ }).click();
    const preview = page.getByRole('button', { name: 'Tester la recherche' });
    assert.equal(await preview.isDisabled(), true);
    await page.getByRole('checkbox', { name: /J’autorise ce test/ }).check();
    await preview.click();
    await page.getByText(/La recherche a fonctionné en mode dégradé/).waitFor();
    assert.equal(await preview.isDisabled(), true);
  });
  await check('échec RAG distinct de zéro résultat et affichage mobile', async () => {
    ragFailure = true;
    await page.getByRole('checkbox', { name: /J’autorise ce test/ }).check();
    await page.getByRole('button', { name: 'Tester la recherche' }).click();
    await page.getByRole('alert').filter({ hasText: 'Recherche publiée indisponible.' }).waitFor();
    assert.equal(
      await page.getByText('Procédure publiée synthétique · v2', { exact: true }).count(),
      0,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow();
    await capture('rag-mobile');
  });
  assert.deepEqual(errors, []);
  assert.equal(
    calls.some((call) => call.path.endsWith('/settings') && call.method !== 'GET'),
    false,
  );
  writeFileSync(
    `${output}/report.json`,
    JSON.stringify(
      {
        passed: true,
        browser: browser.version(),
        checks,
        pageErrors: errors,
        externalProviderCalls: 0,
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
