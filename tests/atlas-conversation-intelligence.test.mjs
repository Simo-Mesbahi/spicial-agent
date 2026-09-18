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

const {
  detectConversationLanguage,
  casualIntent,
  casualReply,
  retrievalQuery,
  asksAboutCurrentCase,
  wantsAnotherCase,
  serviceIntentQuery,
  contextualRetrievalQuery,
  conversationRoute,
} = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

test('detects common customer languages and keeps French abbreviations conversational', () => {
  assert.equal(detectConversationLanguage('cv ?'), 'fr');
  assert.equal(detectConversationLanguage('How can I track my repair?'), 'en');
  assert.equal(detectConversationLanguage('Wo ist meine Reparatur?'), 'de');
  assert.equal(detectConversationLanguage('¿Dónde está mi pedido?'), 'es');
  assert.equal(detectConversationLanguage('أين طلبي؟'), 'ar');
});

test('recognizes natural small talk without forcing document retrieval', () => {
  assert.equal(casualIntent('cv ?'), 'wellbeing');
  assert.equal(casualIntent('cc cv ?'), 'wellbeing');
  assert.equal(casualIntent('coucou ça va ?'), 'wellbeing');
  assert.equal(casualIntent('how are you?'), 'wellbeing');
  assert.equal(casualIntent('Danke!'), 'thanks');
  assert.equal(casualIntent('مرحبا'), 'greeting');
  assert.match(casualReply('fr', 'wellbeing', null), /Et vous/);
  assert.doesNotMatch(
    casualReply('fr', 'wellbeing', { reference: 'RET-2026-3012' }),
    /RET-2026-3012/,
  );
  assert.match(casualReply('en', 'greeting', null), /How can I help/i);
});

test('normalizes multilingual service intents to the French knowledge corpus', () => {
  assert.equal(retrievalQuery('How do I return an item?'), 'retour échange');
  assert.equal(retrievalQuery('My package is incomplete'), 'colis incomplet endommagé');
  assert.equal(retrievalQuery('Meine Karte wurde doppelt belastet'), 'paiement débit anomalie transaction');
  assert.equal(retrievalQuery('Quiero un reembolso'), 'remboursement');
  assert.equal(retrievalQuery('أنتظر قطعة غيار'), 'attente pièce indisponible');
});

test('detects questions that must refresh the verified case', () => {
  assert.equal(asksAboutCurrentCase('Where is my repair?'), true);
  assert.equal(asksAboutCurrentCase('Wo ist meine Reparatur?'), true);
  assert.equal(asksAboutCurrentCase('¿Dónde está mi pedido?'), true);
  assert.equal(asksAboutCurrentCase('أين طلبي؟'), true);
  assert.equal(asksAboutCurrentCase('How does a return work?'), false);
});


test('explicitly asking for another case never means the currently selected case', () => {
  for (const message of [
    "non d'autre dossier",
    'non pas ce dossier',
    "je veux me renseigner sur un autre dossier",
    'I mean another case',
    'nicht diesen Vorgang, einen anderen',
    'quiero otro expediente',
    'أريد ملف آخر',
  ]) assert.equal(wantsAnotherCase(message), true, message);

  assert.equal(wantsAnotherCase('Où en est mon dossier ?'), false);
});


test('routes open conversation separately from business retrieval', () => {
  assert.equal(conversationRoute('cc cv ?'), 'small_talk');
  assert.equal(conversationRoute('non pas ce dossier'), 'switch_case');
  assert.equal(conversationRoute('Comment fonctionne un retour ?'), 'business');
  assert.equal(conversationRoute('Raconte-moi une blague courte'), 'open');
  assert.equal(conversationRoute('I had a difficult day today'), 'open');
});

test('understands French service intent and contextual follow-ups', () => {
  assert.equal(serviceIntentQuery('Comment fonctionne un retour ?'), 'retour échange');
  assert.equal(serviceIntentQuery('Mon paiement a été débité deux fois'), 'paiement débit anomalie transaction');
  assert.equal(serviceIntentQuery('Ma réparation attend une pièce'), 'attente pièce indisponible');

  const query = contextualRetrievalQuery('et ça prend combien de temps ?', [
    'Bonjour',
    'Comment fonctionne un retour ?',
  ]);
  assert.match(query, /^retour échange /);
  assert.match(query, /combien de temps/);

  assert.equal(
    conversationRoute('et ça prend combien de temps ?', ['Comment fonctionne un retour ?']),
    'business',
  );
});
