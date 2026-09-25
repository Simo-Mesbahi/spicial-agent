import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { validateHistoricalRegressionRegistry } from '../scripts/lib/historical-regression-gate.mjs';

const registryPath = new URL('../evals/p1-regression-registry.json', import.meta.url);

async function loadRegistry() {
  return JSON.parse(await readFile(registryPath, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('historical regression registry covers every P1.7 failure run in the declared window', async () => {
  const registry = await loadRegistry();
  const result = await validateHistoricalRegressionRegistry(registry);

  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.guardedRuns, [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);
  assert.equal(result.incidents, 11);
});

test('historical regression gate fails closed when one old P1.7 run loses coverage', async () => {
  const registry = clone(await loadRegistry());
  registry.incidents = registry.incidents.filter(
    (incident) => incident.source.runNumber !== 19,
  );

  const result = await validateHistoricalRegressionRegistry(registry);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.includes(
      'historical coverage gap: P1.7 run #19 is not registered',
    ),
  );
});

test('historical regression gate rejects a stale or renamed regression test guard', async () => {
  const registry = clone(await loadRegistry());
  registry.incidents[0].guards[0].title = 'This regression guard no longer exists';

  const result = await validateHistoricalRegressionRegistry(registry);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) =>
      error.includes('references a missing static test title'),
    ),
  );
});

test('historical regression gate rejects duplicate source-run registration', async () => {
  const registry = clone(await loadRegistry());
  registry.incidents[1].source.runNumber = 16;
  registry.incidents[1].id = 'INC-P1-016';

  const result = await validateHistoricalRegressionRegistry(registry);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes('registered more than once')),
  );
  assert.ok(
    result.errors.some((error) => error.includes('duplicate incident id')),
  );
});

test('historical regression gate rejects untrusted guard paths', async () => {
  const registry = clone(await loadRegistry());
  registry.incidents[0].guards[0].path = '../tests/atlas-hybrid-runtime.test.mjs';

  const result = await validateHistoricalRegressionRegistry(registry);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes('must be an atlas test file')),
  );
});

test('historical regression gate rejects incidents that are no longer marked covered', async () => {
  const registry = clone(await loadRegistry());
  registry.incidents[4].status = 'open';

  const result = await validateHistoricalRegressionRegistry(registry);

  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes('.status must be covered')),
  );
});

test('CI and P1.7 execute the historical regression gate before live provider spend', async () => {
  const [ci, workflow, pkg] = await Promise.all([
    readFile('.github/workflows/ci.yml', 'utf8'),
    readFile('.github/workflows/p1-live-qualification.yml', 'utf8'),
    readFile('package.json', 'utf8'),
  ]);

  const scripts = JSON.parse(pkg).scripts;
  assert.equal(
    scripts['check:regressions'],
    'node scripts/check-historical-regressions.mjs',
  );
  assert.match(ci, /npm run check:regressions/);
  assert.match(workflow, /npm run check:regressions/);

  const verifyStart = workflow.indexOf('Verify source before spending provider budget');
  const regressionGate = workflow.indexOf('npm run check:regressions', verifyStart);
  const liveRetrieval = workflow.indexOf('Prepare bounded hybrid retrieval corpus');

  assert.ok(verifyStart >= 0);
  assert.ok(regressionGate > verifyStart);
  assert.ok(liveRetrieval > regressionGate);
});
