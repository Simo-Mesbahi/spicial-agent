#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { structuredProviderFailureSummary } from './lib/p1-provider-diagnostics.mjs';

const path = process.argv[2] ?? 'outputs/p1-live/structured.json';

try {
  const report = JSON.parse(await readFile(path, 'utf8'));
  const failures = structuredProviderFailureSummary(report);
  console.error(
    JSON.stringify(
      {
        status: failures.length ? 'structured_provider_failures' : 'no_structured_provider_failure',
        failureCount: failures.length,
        failures,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: 'structured_failure_evidence_unavailable',
        failureCount: null,
        failures: [],
        reason: error?.code === 'ENOENT' ? 'report_not_created' : 'report_unreadable',
      },
      null,
      2,
    ),
  );
}
