#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { validateHistoricalRegressionRegistry } from './lib/historical-regression-gate.mjs';

const root = process.cwd();
const registryPath = resolve(root, 'evals/p1-regression-registry.json');

let registry;
try {
  registry = JSON.parse(await readFile(registryPath, 'utf8'));
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'invalid',
      registry: 'evals/p1-regression-registry.json',
      errors: [error instanceof Error ? error.message : String(error)],
    }),
  );
  process.exit(1);
}

const result = await validateHistoricalRegressionRegistry(registry, { root });
const summary = {
  status: result.valid ? 'covered' : 'invalid',
  registry: 'evals/p1-regression-registry.json',
  incidents: result.incidents,
  guardedRuns: result.guardedRuns,
  coverageWindow: registry.coverageWindow,
  errors: result.errors,
};

console.log(JSON.stringify(summary, null, 2));
if (!result.valid) process.exitCode = 1;
