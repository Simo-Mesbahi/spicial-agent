import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('CI lint scope includes P1 qualification diagnostic scripts', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lint = pkg.scripts?.['lint:app'];

  assert.equal(typeof lint, 'string');
  for (const path of [
    'scripts/lib/p1-provider-diagnostics.mjs',
    'scripts/report-p1-structured-failures.mjs',
  ]) {
    assert.ok(lint.split(/\s+/).includes(path), `lint:app must include ${path}`);
  }
});
