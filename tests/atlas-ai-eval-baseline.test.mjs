import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({
  entryPoints: ['lib/atlas/conversation-intelligence.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const intelligence = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const routeCases = [
  ['cc cv ?', [], 'small_talk'],
  ['Merci beaucoup !', [], 'small_talk'],
  ['non pas ce dossier', [], 'switch_case'],
  ["je veux me renseigner sur un autre dossier", [], 'switch_case'],
  ['Comment fonctionne un retour ?', [], 'business'],
  ['Mon paiement a été débité deux fois', [], 'business'],
  ['Ma réparation attend une pièce', [], 'business'],
  ['Raconte-moi une blague courte', [], 'open'],
  ['I had a difficult day today', [], 'open'],
  ['et ça prend combien de temps ?', ['Comment fonctionne un retour ?'], 'business'],
];

const languageCases = [
  ['Bonjour, où est mon dossier ?', 'fr'],
  ['How can I track my repair?', 'en'],
  ['Wo ist meine Reparatur?', 'de'],
  ['¿Dónde está mi pedido?', 'es'],
  ['أين طلبي؟', 'ar'],
];

const retrievalCases = [
  ['How do I return an item?', 'retour échange'],
  ['My package is incomplete', 'colis incomplet endommagé'],
  ['Meine Karte wurde doppelt belastet', 'paiement débit anomalie transaction'],
  ['Quiero un reembolso', 'remboursement'],
  ['أنتظر قطعة غيار', 'attente pièce indisponible'],
];

test('AI evaluation baseline: routing, language and multilingual retrieval remain stable', () => {
  const failures = [];

  for (const [message, history, expected] of routeCases) {
    const actual = intelligence.conversationRoute(message, history);
    if (actual !== expected) failures.push({ kind: 'route', message, expected, actual });
  }

  for (const [message, expected] of languageCases) {
    const actual = intelligence.detectConversationLanguage(message);
    if (actual !== expected) failures.push({ kind: 'language', message, expected, actual });
  }

  for (const [message, expected] of retrievalCases) {
    const actual = intelligence.retrievalQuery(message);
    if (actual !== expected) failures.push({ kind: 'retrieval', message, expected, actual });
  }

  const total = routeCases.length + languageCases.length + retrievalCases.length;
  const passed = total - failures.length;
  assert.equal(
    failures.length,
    0,
    'Baseline score ' + passed + '/' + total + ': ' + JSON.stringify(failures),
  );
});

test('AI evaluation baseline: contextual follow-up preserves the prior service topic', () => {
  const query = intelligence.contextualRetrievalQuery('et ça prend combien de temps ?', [
    'Bonjour',
    'Comment fonctionne un retour ?',
  ]);
  assert.match(query, /^retour échange /);
  assert.match(query, /combien de temps/);
  assert.equal(
    intelligence.conversationRoute('et ça prend combien de temps ?', [
      'Comment fonctionne un retour ?',
    ]),
    'business',
  );
});
