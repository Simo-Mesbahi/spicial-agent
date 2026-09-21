#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import { generationScenarios, generationFixture } from '../evals/generation.mjs';
const args = process.argv.slice(2);
const options = { live: false, maxCases: 5, output: 'outputs/generation-evaluation.json' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--max-cases') options.maxCases = Number(args[++i]);
  else if (args[i] === '--output') options.output = args[++i];
  else throw new Error('Unknown argument');
}
if (
  !Number.isInteger(options.maxCases) ||
  options.maxCases < 1 ||
  options.maxCases > 10 ||
  !options.output
)
  throw new Error('Invalid generation evaluation options');
const selected = generationScenarios.slice(0, options.maxCases);
if (!options.live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        scenarios: selected.map((s) => s.id),
        maxProviderCalls: selected.length,
        note: 'Synthetic evidence only. No requests sent. Structural validity is not factual accuracy.',
      },
      null,
      2,
    ),
  );
} else {
  const built = await build({
    stdin: {
      contents:
        "export {generateNaturalDraft} from './lib/atlas/natural-generation'; export {providerTrace} from './lib/atlas/provider-runtime';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { generateNaturalDraft, providerTrace } = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  const DB = database();
  try {
    const results = [];
    for (const scenario of selected) {
      const trace = providerTrace();
      const fixture = generationFixture(scenario);
      const { draft, diagnostics } = await generateNaturalDraft(
        {
          ...process.env,
          DB,
          SUPABASE_ORGANIZATION_ID: fixture.context.organizationId,
          LLM_GENERATION_MODE: 'shadow',
          LLM_GENERATION_DAILY_LIMIT: String(options.maxCases),
        },
        fixture,
        trace,
      );
      results.push({
        id: scenario.id,
        language: scenario.language,
        rubric: scenario.rubric,
        draft,
        diagnostics,
        providerAttempts: trace.attempts,
        groundedness: null,
        naturalness: null,
        factualValidation: 'not_run',
      });
    }
    const status = results.every((r) => r.draft) ? 'requires_human_review' : 'incomplete';
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(
      options.output,
      JSON.stringify({ status, data: 'synthetic', releaseAllowed: false, results }, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        status,
        output: options.output,
        calls: results.reduce((n, r) => n + r.diagnostics.calls, 0),
        failures: results
          .filter((r) => r.diagnostics.reason !== null)
          .map((r) => ({
            id: r.id,
            reason: r.diagnostics.reason,
            providerAttempts: r.providerAttempts,
          })),
      }),
    );
    if (status === 'incomplete') process.exitCode = 1;
  } finally {
    DB.sql.close();
  }
}
