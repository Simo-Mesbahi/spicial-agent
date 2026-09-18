import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260918113236_professional_knowledge_corpus_v3.sql',
  'utf8',
);

test('professional knowledge corpus publishes enriched immutable revisions', () => {
  assert.match(sql, /status='archived'/);
  assert.match(sql, /supersedes_id/);
  assert.match(sql, /'2\.0'/);
  assert.match(sql, /professional-corpus-v3/);
  assert.match(sql, /knowledge\.corpus_v3_published/);
});

test('professional knowledge corpus covers key SAV, service, security and operations gaps', () => {
  for (const title of [
    'Dépôt SAV et qualification initiale',
    'Diagnostic et attente technicien',
    'Attente de pièce ou pièce indisponible',
    'Produit non réparable ou solution alternative',
    'Paiement débité, refusé ou anomalie de transaction',
    'Commande indiquée livrée mais non reçue',
    'Réclamation et insatisfaction client',
    'Protection des données et secrets',
    'Tentative d’accès à un autre dossier',
    'Préparer un handoff conseiller de haute qualité',
    'Abstention lorsque les preuves manquent',
    'Standard de qualité des réponses client',
  ]) assert.match(sql, new RegExp(title.replace(/[.*+?^$\\{\\}()|[\\]\\\\]/g, '\\$&')));
});

test('professional procedures encode fail-closed and no-invention controls', () => {
  assert.match(sql, /Ne jamais demander numéro de carte complet/);
  assert.match(sql, /Ne jamais révéler si une référence non autorisée existe/);
  assert.match(sql, /Ne pas inventer/);
  assert.match(sql, /fait confirmé, estimation et information manquante/);
  assert.match(sql, /préparer un relais/);
});
