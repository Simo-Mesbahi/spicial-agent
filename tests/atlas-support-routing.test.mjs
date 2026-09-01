import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/support-routing.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { supportDecision, supportQuickReplies } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const repair = { kind: 'repair', status: 'waiting_part', quote_cents: null };

test('A first human-contact request starts with guided assistance', () => {
  assert.deepEqual(supportDecision('Je souhaite un conseiller', repair), {
    path: 'assist_first',
    reason: null,
  });
  assert.ok(supportQuickReplies(repair).includes('Continuer avec un conseiller'));
});

test('A confirmed contact choice is never blocked by another triage loop', () => {
  const history = [
    {
      role: 'assistant',
      content: 'Je peux vous aider ici.',
      metadata: JSON.stringify({ supportPath: 'assist_first' }),
    },
  ];
  assert.equal(supportDecision('Oui', repair, history).path, 'human_confirmed');
  assert.equal(supportDecision('Continuer avec un conseiller', repair, []).path, 'human_confirmed');
});

test('Sensitive or write operations route directly to a human', () => {
  for (const message of [
    'Je veux modifier mon adresse de livraison',
    'Annulez ma commande',
    'Mon compte est bloqué',
    'Je conteste le refus de garantie',
  ]) {
    const decision = supportDecision(message, repair);
    assert.equal(decision.path, 'human_required', message);
    assert.ok(decision.reason.length > 20, message);
  }
});

test('Ordinary SAV questions are not mistaken for contact requests', () => {
  for (const message of [
    'Où en est mon dossier SAV ?',
    'Comment préparer un retour ?',
    'Quelle est la prise en charge ?',
  ])
    assert.equal(supportDecision(message, repair), null, message);
});

test('A missing quote amount cannot be approved conversationally', () => {
  const decision = supportDecision('Combien coûte le devis ?', {
    kind: 'repair',
    status: 'quote_pending',
    quote_cents: null,
  });
  assert.equal(decision.path, 'human_required');
  assert.match(decision.reason, /devis/);
});
