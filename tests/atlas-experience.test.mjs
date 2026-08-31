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
const { caseBrief, briefFreshness } = await load('lib/atlas/case-brief.ts');

const source = {
  id: 'case-1',
  reference: 'SAV-2026-1042',
  product: 'Lave-linge',
  kind: 'repair',
  status: 'waiting_part',
  version: 0,
  updated_at: 1788159600000,
  quote_cents: null,
  refund_cents: null,
  estimate: null,
};

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

test('Case briefs explicitly allowlist facts and do not expose codes or customer data', () => {
  const brief = caseBrief({
    ...source,
    code_hash: 'secret',
    demoCode: '654321',
    customer: 'Private',
    receipt: 'receipt-secret',
    space_id: 'private-space',
  });
  assert.equal(brief.schema, 1);
  assert.equal(brief.caseId, source.id);
  assert.equal(brief.nextLabel, labels.repairing);
  assert.equal(brief.estimate, null);
  assert.equal(brief.amount, null);
  assert.doesNotMatch(JSON.stringify(brief), /secret|654321|Private|private-space/);
});

test('Briefs retain the read version rather than mutating when the case evolves', () => {
  const row = { ...source };
  const brief = caseBrief(row);
  row.status = 'repairing';
  row.version = 1;
  assert.equal(brief.status, 'waiting_part');
  assert.equal(brief.version, 0);
  assert.equal(
    briefFreshness(brief, { id: row.id, version: row.version, verified: true }),
    'outdated',
  );
});

test('Freshness is scoped to a verified case and never treats unknown data as current', () => {
  const brief = caseBrief({ ...source, version: 2 });
  assert.equal(briefFreshness(brief, null), 'unavailable');
  assert.equal(
    briefFreshness(brief, { id: source.id, version: 2, verified: false }),
    'unavailable',
  );
  assert.equal(briefFreshness(brief, { id: 'other', version: 2, verified: true }), 'unavailable');
  assert.equal(briefFreshness(brief, { id: source.id, version: 2, verified: true }), 'current');
  assert.equal(briefFreshness(brief, { id: source.id, version: 1, verified: true }), 'unknown');
});

test('Quote summaries require a decision and never invent a missing amount', () => {
  const brief = caseBrief({ ...source, status: 'quote_pending', quote_cents: 8900 });
  assert.equal(brief.amount.cents, 8900);
  assert.match(brief.nextLabel, /décision/);
  assert.match(brief.customerStep, /explicitement/);
  assert.equal(caseBrief({ ...source, status: 'quote_pending' }).amount, null);
  assert.equal(caseBrief({ ...source, status: 'quote_pending', quote_cents: -1 }).amount, null);
  assert.equal(caseBrief({ ...source, status: 'quote_pending', quote_cents: 0 }).amount.cents, 0);
});

test('Completed cases have no invented next stage and declined quotes are not completed repairs', () => {
  for (const status of ['ready', 'delivered', 'refunded', 'resolved'])
    assert.equal(caseBrief({ ...source, status }).nextLabel, 'Aucune autre étape enregistrée');
  const declined = caseBrief({ ...source, status: 'declined' });
  assert.match(declined.explanation, /Aucune réparation/);
  assert.match(declined.nextLabel, /conseiller/);
});

test('Every initial scenario has a factual brief without an invented delivery or bank deadline', () => {
  for (const c of scenarios) {
    const brief = caseBrief({ ...source, ...c, quote_cents: c.quote, refund_cents: c.refund });
    assert.equal(brief.statusLabel, labels[c.status]);
    assert.equal(brief.estimate, null);
    assert.ok(brief.explanation.length > 20);
    if (c.kind === 'delivery') assert.match(brief.explanation, /Aucune nouvelle date confirmée/);
    if (c.kind === 'refund') {
      assert.equal(brief.amount.cents, 7900);
      assert.match(brief.explanation, /Aucun délai bancaire/);
    }
  }
});
