import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const compiled = await build({
  stdin: {
    contents:
      "export * from './lib/atlas/response-presentation'; export * from './components/atlas/response-content';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  write: false,
});
// A file URL lets Node resolve React from this project's dependencies.
import { writeFileSync, unlinkSync } from 'node:fs';
const moduleUrl = new URL(`../.response-presentation-test-${process.pid}.mjs`, import.meta.url);
writeFileSync(moduleUrl, compiled.outputFiles[0].text);
const { requestedResponseDetails, completeRequestedDetails, responseBlocks, ResponseContent } =
  await import(moduleUrl.href);
unlinkSync(moduleUrl);

const currentCase = {
  id: 'verified',
  reference: 'SAV-2026-1042',
  product: 'Lave-linge',
  kind: 'repair',
  status: 'waiting_part',
  version: 0,
  updated_at: 1791910000000,
  quote_cents: null,
  refund_cents: null,
  estimate: null,
};

test('formatting and capability requests coexist with multilingual case questions', () => {
  for (const message of [
    'La prochaine étape, tes langues et un tableau des étapes de mon dossier',
    'What is the next step for my case? Which languages can you use? Give me a table.',
    'Mein Vorgang: nächster Schritt, welche Sprachen und eine Tabelle?',
    'Mi expediente: los siguientes pasos, idiomas y una tabla',
    'ما مراحل ملفي وما اللغات؟ أريد جدول',
  ])
    assert.deepEqual(requestedResponseDetails(message), { languages: true, table: true });
  assert.deepEqual(requestedResponseDetails('Bonjour'), { languages: false, table: false });
  for (const language of ['fr', 'en', 'de', 'es', 'ar']) {
    const content = completeRequestedDetails(
      'langues tableau',
      'Verified status.',
      currentCase,
      language,
    );
    const table = responseBlocks(content).find((block) => block.kind === 'table');
    assert.ok(table);
    assert.equal(table.rows.length, 5); // Current status and four possible next stages.
    assert.notEqual(table.rows[0][1], table.rows[1][1]);
    assert.equal(table.rows.flat().includes('waiting_part'), false);
  }
});

test('tables do not assume past stages, confirmed dates, decisions or future completion', () => {
  const output = completeRequestedDetails('un tableau', 'État vérifié.', currentCase, 'fr');
  assert.doesNotMatch(output, /Reçu au SAV|Diagnostic en cours/);
  assert.match(output, /pas encore réalisée|pas encore réalisées/);
  assert.match(output, /Aucun délai confirmé/);
  for (const status of ['quote_pending', 'declined', 'ready', 'unknown_status']) {
    const text = completeRequestedDetails(
      'tableau',
      'État vérifié.',
      { ...currentCase, status },
      'fr',
    );
    const table = responseBlocks(text).find((block) => block.kind === 'table');
    assert.equal(table.rows.length, 1, status);
    assert.doesNotMatch(text, /\| En réparation \|/);
    if (status === 'quote_pending') assert.match(text, /décision explicite/);
    if (status === 'declined') assert.match(text, /conseiller/);
  }
  assert.equal(
    completeRequestedDetails('tableau', 'Vérifiez votre dossier.', null, 'fr'),
    'Vérifiez votre dossier.',
  );
});

test('table rendering uses semantic HTML and escapes HTML, scripts and links as text', () => {
  const html = renderToStaticMarkup(
    createElement(ResponseContent, {
      content:
        'Bonjour\n\n| Étape | Information |\n| --- | --- |\n| Pièce | <script>alert(1)</script> |\n| Réparation | [clic](javascript:alert(1)) |',
    }),
  );
  assert.match(html, /<table>/);
  assert.match(html, /<th scope="col">Étape/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<a\b/);
  assert.match(html, /tabindex="0"/);
});

test('malformed or oversized tables remain readable text, and escaped pipes stay in their cell', () => {
  assert.equal(
    responseBlocks('| A | B |\n| --- | --- |\n| only one |').every(
      (block) => block.kind === 'text',
    ),
    true,
  );
  const oversized =
    '| A | B |\n| --- | --- |\n' + Array.from({ length: 61 }, () => '| 1 | 2 |').join('\n');
  assert.equal(
    responseBlocks(oversized).every((block) => block.kind === 'text'),
    true,
  );
  const blocks = responseBlocks('| A | B |\n| :--- | ---: |\n| a\\|b | c |');
  assert.deepEqual(blocks[0].rows, [['a|b', 'c']]);
});
