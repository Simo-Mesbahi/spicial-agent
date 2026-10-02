import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function p1Scripts(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.mjs') &&
        entry.name.toLowerCase().includes('p1'),
    )
    .map((entry) => join(directory, entry.name).replaceAll('\\', '/'));
}

test('CI lint scope includes every P1 release script and helper', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lint = pkg.scripts?.['lint:app'];

  assert.equal(typeof lint, 'string');
  const lintPaths = new Set(lint.split(/\s+/));
  const requiredPaths = [
    ...(await p1Scripts('scripts')),
    ...(await p1Scripts('scripts/lib')),
  ].sort();

  assert.ok(requiredPaths.length >= 6, 'Expected the P1 release toolchain to contain multiple scripts.');
  for (const path of requiredPaths) {
    assert.ok(lintPaths.has(path), `lint:app must include ${path}`);
  }
});
