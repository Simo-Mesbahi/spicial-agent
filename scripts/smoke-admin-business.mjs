import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as pause } from 'node:timers/promises';

// Real application rendering, synthetic API fixtures only, all external traffic blocked.
const origin = 'http://127.0.0.1:4179';
const output = 'outputs/admin-business';
mkdirSync(output, { recursive: true });
const log = createWriteStream(`${output}/server.log`);
const server = spawn(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4179', '--strictPort'],
  {
    detached: true,
    env: { ...process.env, LLM_PROVIDER: 'demo', LLM_BUDGET_MODE: 'zero', P1_RELEASE_MODE: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const org = uuid(1);
let role = 'super_admin';
let droppedSave = false;
const calls = [];
const checks = [];
const errors = [];
const commands = new Map();
const records = {
  customer: [
    {
      id: uuid(101),
      kind: 'customer',
      revision: 1,
      data: {
        external_id: 'QA-C1',
        first_name: 'Marie',
        last_name: 'Synthétique',
        email: 'marie@example.invalid',
        phone: null,
      },
      updatedAt: '2026-10-14T12:00:00Z',
    },
    {
      id: uuid(102),
      kind: 'customer',
      revision: 1,
      data: {
        external_id: 'QA-C2',
        first_name: 'Autre',
        last_name: 'Client',
        email: 'other@example.invalid',
        phone: null,
      },
      updatedAt: '2026-10-14T12:00:00Z',
    },
  ],
  product: [
    {
      id: uuid(201),
      kind: 'product',
      revision: 1,
      data: {
        external_id: 'QA-P1',
        name: 'Lave-linge synthétique',
        sku: 'QA-SKU',
        category: 'Électroménager',
        serial_number: 'SERIAL-QA',
      },
      updatedAt: '2026-10-14T12:00:00Z',
    },
  ],
  store: [
    {
      id: uuid(301),
      kind: 'store',
      revision: 1,
      data: {
        code: 'QA-STORE',
        name: 'Magasin synthétique',
        city: 'Paris',
        address: 'Adresse fictive',
        active: true,
      },
      updatedAt: '2026-10-14T12:00:00Z',
    },
  ],
};
const rows = [401, 402].map((n, i) => ({
  id: uuid(n),
  reference: `QA-SAV-${String(n).padStart(4, '0')}`,
  version: 1,
  service_type: 'sav',
  kind: 'repair',
  title: 'Dossier synthétique',
  status: 'diagnosis',
  warranty_status: 'unknown',
  customer_id: uuid(101 + i),
  product_id: uuid(201),
  store_id: uuid(301),
  estimated_at: null,
  archived_at: null,
  updated_at: '2026-10-14T12:00:00Z',
}));
const linked = (record) =>
  rows.filter(
    (row) =>
      row[
        `${record.kind === 'customer' ? 'customer' : record.kind === 'product' ? 'product' : 'store'}_id`
      ] === record.id,
  ).length;
const recordView = (record) => ({
  ...record,
  linkedCases: linked(record),
  canEdit: role === 'super_admin' || record.kind !== 'store',
});
const detail = (row) => ({
  ...row,
  description: 'Demande fictive pour le contrôle navigateur.',
  created_at: row.updated_at,
  closed_at: null,
  archive_reason: row.archived_at ? 'Classement synthétique' : null,
  source_system: 'manual',
  source_updated_at: null,
  quote_cents: null,
  refund_cents: null,
  currency: 'EUR',
  warranty_label: null,
  delivery_mode: null,
  events: [],
  customer: {
    id: row.customer_id,
    ...records.customer.find((item) => item.id === row.customer_id)?.data,
  },
  product: {
    id: row.product_id,
    ...records.product.find((item) => item.id === row.product_id)?.data,
  },
  store: { id: row.store_id, ...records.store.find((item) => item.id === row.store_id)?.data },
});
function overview(days = 30) {
  return {
    generated_at: '2026-10-14T12:00:00Z',
    period_days: days,
    cases: {
      total: rows.length,
      open: rows.length,
      overdue: 0,
      without_eta: 2,
      stale: 0,
      resolved: 0,
      avg_resolution_hours: null,
    },
    handoffs: { open: 0, unassigned: 0 },
    assistant: { messages_24h: 3, conversations: 1 },
    by_status: { diagnosis: 2 },
    performance: {
      p95_latency_ms_24h: 30,
      requests_24h: 8,
      error_rate_24h: 0,
      rate_limited_24h: 0,
    },
    routes: [],
    trend: Array.from({ length: days }, (_, i) => ({
      day: new Date(Date.UTC(2026, 9, 14 - i)).toISOString().slice(0, 10),
      opened: i === 0 ? 2 : 0,
      closed: 0,
    })).reverse(),
  };
}
let browser;
let page;
async function check(name, run) {
  await run();
  checks.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'horizontal overflow',
  );
}
async function capture(name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
try {
  for (let attempt = 0; ; attempt++) {
    if (server.exitCode !== null) throw new Error('App server exited');
    try {
      if ((await fetch(`${origin}/admin/records`, { signal: AbortSignal.timeout(1500) })).ok) break;
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
    acceptDownloads: true,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/production/')) return route.continue();
    const path = url.pathname;
    const method = route.request().method();
    const input = route.request().postDataJSON();
    calls.push({ path, method, params: Object.fromEntries(url.searchParams), body: input });
    let body;
    let status = 200;
    if (path.endsWith('/config')) body = { environment: 'LOCAL' };
    else if (path.endsWith('/admin/session'))
      body = {
        admin: {
          userId: uuid(900),
          email: 'synthetic@example.invalid',
          aal: 'aal2',
          memberships: [{ organizationId: org, organizationName: 'Données de test', role }],
        },
      };
    else if (path.endsWith('/deployment')) body = { organizationId: org };
    else if (path.endsWith('/overview'))
      body = { overview: overview(Number(url.searchParams.get('days') || 30)) };
    else if (path.endsWith('/queue')) body = { queue: { priorities: [], handoffs: [] } };
    else if (path.endsWith('/audit')) body = { audit: { items: [], total: 0 } };
    else if (path.endsWith('/admin/cases')) {
      const filtered = rows.filter(
        (row) =>
          (!url.searchParams.get('status') || row.status === url.searchParams.get('status')) &&
          (url.searchParams.get('archive') === 'archived'
            ? !!row.archived_at
            : url.searchParams.get('archive') === 'all'
              ? true
              : !row.archived_at),
      );
      const offset = Number(url.searchParams.get('offset') || 0);
      body = { items: filtered.slice(offset, offset + 30), total: filtered.length };
    } else if (path.endsWith('/case/options'))
      body = { stores: records.store.map((item) => ({ id: item.id, ...item.data })) };
    else if (path.endsWith('/case/entities')) {
      const kind = url.searchParams.get('type');
      const q = url.searchParams.get('q');
      assert.ok(q.length >= 3);
      body = {
        items: records[kind]
          .filter((item) => JSON.stringify(item.data).toLowerCase().includes(q.toLowerCase()))
          .map((item) => ({
            id: item.id,
            ...item.data,
            display_name: [item.data.first_name, item.data.last_name].filter(Boolean).join(' '),
            rank: 1,
          })),
      };
    } else if (path.endsWith('/case/update')) {
      const row = rows.find((item) => item.id === input.caseId);
      assert.equal(input.expectedVersion, row.version);
      Object.assign(row, {
        customer_id: input.customerId,
        product_id: input.productId,
        title: input.title,
        version: row.version + 1,
      });
      body = { ok: true, id: row.id, reference: row.reference, version: row.version };
    } else if (path.endsWith('/case'))
      body = { case: detail(rows.find((item) => item.id === url.searchParams.get('caseId'))) };
    else if (path.endsWith('/business/entities')) {
      const kind = url.searchParams.get('kind');
      const query = url.searchParams.get('search') || '';
      const filtered = records[kind].filter((item) =>
        JSON.stringify(item.data).toLowerCase().includes(query.toLowerCase()),
      );
      body = {
        items: filtered.map(recordView),
        total: filtered.length,
        canCreate: role === 'super_admin' || kind !== 'store',
      };
    } else if (path.endsWith('/business/entity'))
      body = recordView(
        records[url.searchParams.get('kind')].find(
          (item) => item.id === url.searchParams.get('id'),
        ),
      );
    else if (path.endsWith('/business/entity/save')) {
      if (commands.has(input.requestId)) body = commands.get(input.requestId);
      else {
        assert.equal(input.organizationId, org);
        const list = records[input.kind];
        let item = list.find((record) => record.id === input.id);
        if (item) {
          assert.equal(input.expectedRevision, item.revision);
          item.data = input.data;
          item.revision++;
        } else {
          assert.equal(input.expectedRevision, 0);
          item = {
            id: uuid(1000 + calls.length),
            kind: input.kind,
            revision: 1,
            data: input.data,
            updatedAt: '2026-10-14T12:30:00Z',
          };
          list.unshift(item);
        }
        rows.filter((row) => row[`${input.kind}_id`] === item.id).forEach((row) => row.version++);
        body = recordView(item);
        commands.set(input.requestId, structuredClone(body));
      }
      if (droppedSave) {
        droppedSave = false;
        return route.abort('failed');
      }
    } else if (path.endsWith('/business/cases/export'))
      body = {
        csv: '\ufeff"Référence";"État"\r\n"QA-SAV-0401";"Diagnostic"\r\n',
        count: 1,
        generatedAt: '2026-10-14T12:00:00Z',
      };
    else if (path.endsWith('/business/cases/batch')) {
      assert.equal(input.action, 'note');
      assert.equal(input.items.length, 2);
      input.items.forEach((value) => {
        const row = rows.find((item) => item.id === value.id);
        assert.equal(value.version, row.version);
        row.version++;
      });
      body = {
        ok: true,
        count: input.items.length,
        items: input.items.map((item) => ({ id: item.id, version: item.version + 1 })),
      };
    } else if (path.endsWith('/business/case/restore')) {
      const row = rows.find((item) => item.id === input.caseId);
      assert.equal(input.expectedVersion, row.version);
      row.archived_at = null;
      row.version++;
      body = { ok: true, id: row.id, reference: row.reference, version: row.version };
    } else if (path.endsWith('/business/messages'))
      body = url.searchParams.has('beforeId')
        ? {
            items: [
              {
                id: uuid(700),
                role: 'user',
                content: 'Échange précédent synthétique',
                createdAt: '2026-10-13T10:00:00Z',
                conversationId: uuid(600),
              },
            ],
            hasMore: false,
            nextCursor: null,
          }
        : {
            items: [
              {
                id: uuid(701),
                role: 'user',
                content: 'Message client synthétique',
                createdAt: '2026-10-14T10:00:00Z',
                conversationId: uuid(600),
              },
              {
                id: uuid(702),
                role: 'assistant',
                content: '<img src=x onerror="alert(1)"> Texte traité comme du texte.',
                createdAt: '2026-10-14T10:01:00Z',
                conversationId: uuid(600),
              },
            ],
            hasMore: true,
            nextCursor: { id: uuid(701), createdAt: '2026-10-14T10:00:00Z' },
          };
    else throw new Error(`Unexpected synthetic API request: ${path}`);
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(`${origin}/admin/operations`);
  await page.locator('.admin-ops-case-results button').first().click();
  await check(
    'correction client depuis un dossier et conservation de la note en cours',
    async () => {
      await page.locator('.admin-ops-note textarea').fill('Brouillon à conserver');
      await page.getByRole('button', { name: 'Corriger la fiche client', exact: true }).click();
      const editor = page.locator('.admin-business-case .admin-business-form');
      await editor.getByLabel('Email', { exact: true }).fill('corrected@example.invalid');
      await editor.getByRole('checkbox', { name: /Je confirme la correction/ }).check();
      await editor.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
      await page
        .getByText('Marie Synthétique : correction enregistrée et auditée.', { exact: true })
        .waitFor();
      assert.equal(
        await page.locator('.admin-ops-note textarea').inputValue(),
        'Brouillon à conserver',
      );
      assert.equal(records.customer[0].data.email, 'corrected@example.invalid');
      assert.equal(rows[0].version, 2);
      await page.locator('.admin-ops-note textarea').fill('');
    },
  );
  await check(
    'changement de client soumis à confirmation et recherche de fiche existante',
    async () => {
      await page.getByRole('button', { name: 'Modifier', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'Rechercher un autre client', exact: true })
        .fill('Autre');
      await page
        .locator('.admin-business-selector')
        .first()
        .getByRole('button', { name: 'Chercher', exact: true })
        .click();
      await page.getByRole('button', { name: 'Associer Autre Client', exact: true }).click();
      const save = page
        .locator('.admin-ops-edit-form')
        .getByRole('button', { name: 'Enregistrer', exact: true });
      assert.equal(await save.isDisabled(), true);
      await page.getByRole('checkbox', { name: /Je confirme le changement de client/ }).check();
      await save.click();
      await page.getByText(/Les anciens accès client sont révoqués/).waitFor();
      assert.equal(rows[0].customer_id, uuid(102));
    },
  );
  await check(
    'lecture paginée des échanges sans interpréter leur contenu comme du HTML',
    async () => {
      await page.getByText('Historique des échanges enregistrés', { exact: true }).click();
      await page.getByText('Message client synthétique', { exact: true }).waitFor();
      assert.equal(await page.locator('.admin-business-messages img').count(), 0);
      await page
        .getByRole('button', { name: 'Charger les échanges précédents', exact: true })
        .click();
      await page.getByText('Échange précédent synthétique', { exact: true }).waitFor();
      assert.equal(await page.locator('.admin-business-messages article').count(), 3);
    },
  );
  await check('action groupée confirmée sur deux dossiers et versions conservées', async () => {
    const batch = page.locator('.admin-business-batch');
    await batch.getByText('Actions groupées sur cette page', { exact: true }).click();
    await batch.getByRole('checkbox', { name: /QA-SAV-0401/ }).check();
    await batch.getByRole('checkbox', { name: /QA-SAV-0402/ }).check();
    await batch.getByLabel('Note à ajouter', { exact: true }).fill('Note groupée synthétique');
    const apply = batch.getByRole('button', {
      name: 'Appliquer aux dossiers sélectionnés',
      exact: true,
    });
    assert.equal(await apply.isDisabled(), true);
    await batch.getByRole('checkbox', { name: /Je confirme l’action/ }).check();
    await apply.click();
    await page
      .getByText('Action groupée enregistrée. Les dossiers ont été actualisés.', { exact: true })
      .waitFor();
    assert.equal(
      calls.filter((call) => call.path.endsWith('/cases/batch')).at(-1).body.items.length,
      2,
    );
  });
  await check(
    'export CSV téléchargé avec les filtres appliqués et non le brouillon de recherche',
    async () => {
      await page
        .getByRole('textbox', { name: 'Rechercher un dossier', exact: true })
        .fill('brouillon non soumis');
      const download = page.waitForEvent('download');
      await page
        .getByRole('button', { name: 'Exporter les dossiers filtrés', exact: true })
        .click();
      const file = await download;
      await file.saveAs(`${output}/cases.csv`);
      assert.match(readFileSync(`${output}/cases.csv`, 'utf8'), /QA-SAV-0401/);
      assert.equal(
        calls.filter((call) => call.path.endsWith('/cases/export')).at(-1).body.search,
        '',
      );
    },
  );
  await page.goto(`${origin}/admin/records`);
  await check('création et correction d’une fiche client indépendante', async () => {
    await page.getByRole('button', { name: 'Nouvelle fiche', exact: true }).click();
    await page.getByLabel('Prénom', { exact: true }).fill('Nouveau');
    await page.getByLabel('Nom', { exact: true }).fill('Client QA');
    await page.getByLabel('Email', { exact: true }).fill('new@example.invalid');
    await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
    await page
      .locator('.admin-business-list')
      .getByRole('button', { name: /Nouveau Client QA/ })
      .click();
    await page.getByLabel('Téléphone', { exact: true }).fill('0000000000');
    await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
    await page
      .getByText('Client enregistré. Les corrections sont auditées.', { exact: true })
      .waitFor();
    assert.equal(
      records.customer.find((item) => item.data.email === 'new@example.invalid').revision,
      2,
    );
  });
  await check('reprise d’un enregistrement après réponse perdue sans duplication', async () => {
    await page
      .locator('.admin-business-list')
      .getByRole('button', { name: /Nouveau Client QA/ })
      .click();
    await page.getByLabel('Téléphone', { exact: true }).fill('1111111111');
    droppedSave = true;
    const save = page.getByRole('button', { name: 'Enregistrer la fiche', exact: true });
    await save.click();
    await page
      .getByRole('alert')
      .filter({ hasText: /Connexion interrompue/ })
      .waitFor();
    await save.click();
    await page
      .getByText('Client enregistré. Les corrections sont auditées.', { exact: true })
      .waitFor();
    const saves = calls.filter((call) => call.path.endsWith('/entity/save')).slice(-2);
    assert.equal(saves[0].body.requestId, saves[1].body.requestId);
    assert.equal(
      records.customer.find((item) => item.data.email === 'new@example.invalid').revision,
      3,
    );
  });
  await check('création de produit et de magasin depuis les référentiels', async () => {
    await page.getByRole('button', { name: 'Produits', exact: true }).click();
    await page.getByRole('button', { name: 'Nouvelle fiche', exact: true }).click();
    await page.getByLabel('Nom du produit', { exact: true }).fill('Produit QA créé');
    await page.getByLabel('SKU / référence article', { exact: true }).fill('QA-NEW-SKU');
    await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
    await page
      .getByText('Produit enregistré. Les corrections sont auditées.', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: 'Magasins', exact: true }).click();
    await page.getByRole('button', { name: 'Nouvelle fiche', exact: true }).click();
    await page.getByLabel('Code du magasin', { exact: true }).fill('QA-NEW-STORE');
    await page.getByLabel('Nom du magasin', { exact: true }).fill('Nouveau magasin QA');
    await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).click();
    await page
      .getByText('Magasin enregistré. Les corrections sont auditées.', { exact: true })
      .waitFor();
  });
  await check(
    'magasins consultables mais non modifiables pour un responsable de service',
    async () => {
      role = 'sav_manager';
      await page.reload();
      await page.getByRole('button', { name: 'Magasins', exact: true }).click();
      await page
        .locator('.admin-business-list')
        .getByRole('button', { name: /Magasin synthétique/ })
        .click();
      assert.equal(await page.getByLabel('Nom du magasin', { exact: true }).isDisabled(), true);
      assert.equal(
        await page.getByRole('button', { name: 'Enregistrer la fiche', exact: true }).count(),
        0,
      );
      await noOverflow();
    },
  );
  role = 'super_admin';
  await page.goto(`${origin}/admin/records`);
  await page
    .locator('.admin-business-list')
    .getByRole('button', { name: /Nouveau Client QA/ })
    .click();
  await capture('records-desktop');
  await check('référentiels et éditeur utilisables à 320, 390 et 768 pixels', async () => {
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow();
      assert.ok(
        await page
          .getByLabel('Email', { exact: true })
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16),
      );
      for (const link of await page
        .getByRole('navigation', { name: 'Sections de l’administration' })
        .getByRole('link')
        .all())
        assert.ok((await link.boundingBox()).height >= 44);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('records-mobile');
    await page.emulateMedia({ colorScheme: 'dark' });
    await capture('records-dark-mobile');
    await page.emulateMedia({ colorScheme: 'light' });
  });
  await page.goto(`${origin}/admin/reports`);
  await check('rapport sur période, export CSV et commande d’impression', async () => {
    await page.getByLabel('Période d’analyse', { exact: true }).selectOption('7');
    await page.getByText(/historique sur 7 jours/).waitFor();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exporter le rapport CSV', exact: true }).click();
    const file = await download;
    await file.saveAs(`${output}/report.csv`);
    assert.match(readFileSync(`${output}/report.csv`, 'utf8'), /Période \(jours\)";"7/);
    await page.evaluate(() => {
      window.print = () => {
        window.__syntheticPrintCount = (window.__syntheticPrintCount || 0) + 1;
      };
    });
    await page.getByRole('button', { name: 'Imprimer / PDF', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__syntheticPrintCount), 1);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capture('reports-desktop');
    await page.emulateMedia({ media: 'print' });
    await capture('report-print');
    await page.emulateMedia({ media: 'screen' });
  });
  rows[0].archived_at = '2026-10-14T12:00:00Z';
  await page.goto(`${origin}/admin/operations`);
  await check(
    'restauration explicite d’un dossier archivé et consigne de nouveau code',
    async () => {
      await page.getByLabel('Filtrer les archives', { exact: true }).selectOption('archived');
      await page.locator('.admin-ops-case-results button').first().click();
      await page
        .getByLabel('Motif de restauration', { exact: true })
        .fill('Erreur de classement synthétique');
      const restore = page.getByRole('button', { name: 'Restaurer le dossier', exact: true });
      assert.equal(await restore.isDisabled(), true);
      await page.getByRole('checkbox', { name: /Je confirme la restauration/ }).check();
      await restore.click();
      await page
        .getByText('Dossier restauré. Renouvelez le code pour ouvrir un nouvel accès client.', {
          exact: true,
        })
        .waitFor();
      assert.equal(rows[0].archived_at, null);
    },
  );
  assert.deepEqual(errors, []);
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
