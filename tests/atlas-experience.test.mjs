import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64')
  );
}
const { guideStage, suggestedQuestions, discoveryScenarios } =
  await load('lib/atlas/experience.ts');
const { scenarios, nextStep, labels, normalized } = await load('lib/atlas/domain.ts');

test('Discovery scenarios point to seeded cases and real simulated transitions', () => {
  for (const preview of discoveryScenarios) {
    const row = scenarios.find((s) => s.reference === preview.reference);
    assert.ok(row);
    const next = nextStep(row.kind, row.status);
    if (row.status === 'quote_pending') assert.equal(next, null);
    else assert.equal(preview.nextStatus, labels[next]);
  }
});

test('Guided experience requires verification and a dossier answer', () => {
  assert.equal(guideStage(false, 0, undefined, false), 'verify');
  assert.equal(guideStage(false, 1, 1, true), 'verify');
  assert.equal(guideStage(true, 0, undefined, false), 'ask');
  assert.equal(guideStage(true, 2, undefined, false), 'ask');
});

test('Guided experience compares persisted dossier versions', () => {
  assert.equal(guideStage(true, 0, 0, true), 'advance');
  assert.equal(guideStage(true, 1, 0, true), 'refresh');
  assert.equal(guideStage(true, 1, 1, true), 'done');
  assert.equal(guideStage(true, 2, 1, true), 'refresh');
});

test('Old conversations without a version do not falsely complete the guide', () => {
  assert.equal(guideStage(true, 2, undefined, true), 'advance');
  assert.equal(guideStage(true, 2, null, true), 'advance');
});

test('Suggested questions reflect delivery, refunds and pending decisions', () => {
  assert.match(suggestedQuestions({ kind: 'delivery', status: 'delayed' }).join(' '), /date/);
  assert.match(
    suggestedQuestions({ kind: 'refund', status: 'refund_pending' }).join(' '),
    /montant/,
  );
  assert.match(suggestedQuestions({ kind: 'repair', status: 'quote_pending' })[0], /devis/);
  assert.equal(suggestedQuestions(null).length, 3);
});

test('Search accepts case and accent differences without removing useful identifiers', () => {
  assert.equal(normalized('RÉPARATION'), normalized('reparation'));
  assert.ok(normalized('SAV-2026-1042 Lave-linge').includes(normalized('sav-2026-1042')));
});
