import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  appType: 'custom',
  configFile: false,
  cacheDir: 'node_modules/.vite-atlas-receipt-tests',
  root,
  resolve: { alias: { '@': root } },
  server: { middlewareMode: true },
});
after(async () => {
  await vite.close();
});
const { CaseReceipt } = await vite.ssrLoadModule('/components/atlas/case-receipt.tsx');
const { caseBrief } = await vite.ssrLoadModule('/lib/atlas/case-brief.ts');
const brief = caseBrief({
  id: 'case-1',
  reference: 'SAV-2026-1048',
  product: 'Machine à café',
  kind: 'repair',
  status: 'quote_pending',
  version: 0,
  updated_at: 1788159600000,
  quote_cents: 8900,
  refund_cents: null,
  estimate: null,
});
const current = { id: 'case-1', verified: true, version: 0 };
const render = (props = {}) =>
  renderToStaticMarkup(
    React.createElement(CaseReceipt, {
      brief,
      current,
      onRefresh() {},
      onQuote() {},
      ...props,
    }),
  );

test('Current receipt shows recorded facts, amount and the explicit review action', () => {
  const html = render();
  assert.match(html, /LE DOSSIER EN CLAIR/);
  assert.match(html, /La suite prévue/);
  assert.match(html, /De votre côté/);
  assert.match(html, /89,00/);
  assert.match(html, /Examiner/);
  assert.match(html, /Aucun délai confirmé/);
  assert.match(html, /Dossier fictif/);
  assert.doesNotMatch(html, /a évolué/);
});

test('Outdated receipt explains the update and removes stale quote actions', () => {
  const html = render({ current: { ...current, version: 1 } });
  assert.match(html, /ÉTAT LORS DE CETTE RÉPONSE/);
  assert.match(html, /a évolué depuis cette réponse/);
  assert.match(html, /Actualiser le suivi/);
  assert.doesNotMatch(html, />Examiner/);
});

test('Receipt never renders for an unverified or different dossier', () => {
  assert.equal(render({ current: { ...current, verified: false } }), '');
  assert.equal(render({ current: { ...current, id: 'another-case' } }), '');
  assert.equal(render({ current: null }), '');
});

test('Historic receipts stay compact and never expose an old action', () => {
  const html = render({ compact: true, current: { ...current, version: 1 } });
  assert.match(html, /État consulté/);
  assert.match(html, /Historique/);
  assert.doesNotMatch(html, /<button|La suite prévue/);
});

test('Final-state receipt does not suggest that a completed pickup is still waiting for a date', () => {
  const html = render({
    brief: { ...brief, status: 'ready', statusLabel: 'Disponible au retrait', amount: null },
  });
  assert.doesNotMatch(html, /Aucun délai confirmé|Examiner/);
  assert.match(html, /Disponible au retrait/);
});
