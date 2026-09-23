#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import {
  groundingScenarios,
  groundingFixture,
  validateGroundingCorpus,
} from '../evals/grounding.mjs';
import { liveCompletionPacer } from './lib/live-eval-pacing.mjs';
const args = process.argv.slice(2);
const options = {
  live: false,
  maxCases: 5,
  offset: 0,
  output: 'outputs/grounding-evaluation.json',
};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--max-cases') options.maxCases = Number(args[++i]);
  else if (args[i] === '--offset') options.offset = Number(args[++i]);
  else if (args[i] === '--output') options.output = args[++i];
  else throw new Error('Unknown argument');
}
if (
  !Number.isInteger(options.maxCases) ||
  options.maxCases < 1 ||
  options.maxCases > 20 ||
  !Number.isInteger(options.offset) ||
  options.offset < 0 ||
  options.offset >= groundingScenarios.length ||
  !options.output
)
  throw new Error('Invalid grounding evaluation options');
const coverage = validateGroundingCorpus();
// Interleave families/languages so the default small sample includes both positive and negative controls.
const ordered = Array.from({ length: 5 }, (_, i) =>
  Array.from({ length: 14 }, (_, family) => groundingScenarios[family * 5 + ((family + i) % 5)]),
).flat();
const selected = ordered.slice(options.offset, options.offset + options.maxCases);
if (!options.live)
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        coverage,
        scenarios: selected.map((s) => s.id),
        maxProviderCalls: selected.length,
        releaseAllowed: false,
        note: 'Corpus validation only, no model-quality measurement or provider request.',
      },
      null,
      2,
    ),
  );
else {
  const built = await build({
    stdin: {
      contents:
        "export {validateNaturalDraft} from './lib/atlas/factual-validation'; export {providerTrace} from './lib/atlas/provider-runtime';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { validateNaturalDraft, providerTrace } = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  const DB = database(),
    pacing = liveCompletionPacer();
  try {
    const results = [];
    let rejectedStreak = 0;
    let systemicTransportFailure = null;
    for (const scenario of selected) {
      await pacing.beforeCall();
      const trace = providerTrace();
      const fixture = groundingFixture(scenario);
      const diagnostics = await validateNaturalDraft(
        {
          ...process.env,
          DB,
          SUPABASE_ORGANIZATION_ID: fixture.context.organizationId,
          LLM_VALIDATION_MODE: 'shadow',
          LLM_VALIDATION_DAILY_LIMIT: String(options.maxCases),
        },
        fixture,
        trace,
      );
      results.push({
        id: scenario.id,
        language: scenario.language,
        expectedSupported: scenario.expectedSupported,
        expectedIssue: scenario.expectedIssue,
        diagnostics,
        providerAttempts: trace.attempts,
      });

      if (diagnostics.reason === 'upstream_request_rejected') rejectedStreak++;
      else rejectedStreak = 0;

      if (['upstream_auth', 'configuration'].includes(diagnostics.reason)) {
        systemicTransportFailure = diagnostics.reason;
        break;
      }
      if (rejectedStreak >= 3) {
        systemicTransportFailure = 'repeated_upstream_request_rejected';
        break;
      }
    }
    const negatives = results.filter((r) => !r.expectedSupported),
      positives = results.filter((r) => r.expectedSupported);
    const falseSupport = negatives.filter(
      (r) => r.diagnostics.outcome === 'supported_candidate',
    ).length;
    const abstained = results.filter((r) =>
      ['abstained', 'skipped'].includes(r.diagnostics.outcome),
    ).length;
    const status = abstained
      ? 'incomplete'
      : falseSupport
        ? 'unsafe_candidate'
        : 'requires_human_review';
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(
      options.output,
      JSON.stringify(
        {
          status,
          data: 'synthetic',
          releaseAllowed: false,
          coverage,
          pacingIntervalMs: pacing.intervalMs,
          requestedScenarios: selected.length,
          measuredScenarios: results.length,
          systemicTransportFailure,
          metrics: {
            falseSupportRate: negatives.length ? falseSupport / negatives.length : null,
            supportedRecall: positives.length
              ? positives.filter((r) => r.diagnostics.outcome === 'supported_candidate').length /
                positives.length
              : null,
            abstentionRate: abstained / results.length,
          },
          results,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      JSON.stringify({
        status,
        output: options.output,
        calls: results.reduce((n, r) => n + r.diagnostics.calls, 0),
        systemicTransportFailure,
        failures: results
          .filter((r) => r.diagnostics.reason !== null)
          .map((r) => ({
            id: r.id,
            reason: r.diagnostics.reason,
            providerAttempts: r.providerAttempts,
          })),
      }),
    );
    if (status !== 'requires_human_review') process.exitCode = 1;
  } finally {
    DB.sql.close();
  }
}
