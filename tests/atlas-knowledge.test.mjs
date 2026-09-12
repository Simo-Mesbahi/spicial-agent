import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['lib/atlas/domain.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { retrieve } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

test('Knowledge retrieval handles accents and common customer vocabulary', () => {
  assert.equal(retrieve('Je souhaite me faire rembourser')[0]?.id, 'sc-remboursement');
  assert.equal(retrieve('Quelles garanties ?')[0]?.id, 'sav-garantie');
  assert.equal(retrieve('Je souhaite rendre cet achat')[0]?.id, 'sc-retour');
});
test('Knowledge retrieval abstains for greetings, unrelated questions and substring collisions', () => {
  for (const question of ['Bonjour merci', 'astronomie quantique', 'savonnette', ''])
    assert.deepEqual(retrieve(question), [], question);
});
test('Knowledge retrieval bounds source count and rejects invalid limits', () => {
  assert.ok(retrieve('garantie remboursement retour', 100).length <= 3);
  assert.deepEqual(retrieve('garantie', -1), []);
  assert.deepEqual(retrieve('garantie', NaN), []);
  assert.equal(new Set(retrieve('garantie garantie').map(doc => doc.id)).size, retrieve('garantie').length);
});
