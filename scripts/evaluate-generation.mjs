#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import { generationScenarios, generationFixture } from '../evals/generation.mjs';
import { liveCompletionPacer } from './lib/live-eval-pacing.mjs';
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
        maxGenerationCalls: selected.length,
        maxValidationCalls: selected.length,
        maxProviderCalls: selected.length * 2,
        note: 'Synthetic evidence only. No requests sent. Live qualification validates every generated candidate factually before human review.',
      },
      null,
      2,
    ),
  );
} else {
  const built = await build({
    stdin: {
      contents:
        "export {generateNaturalDraft} from './lib/atlas/natural-generation'; export {validateNaturalDraft} from './lib/atlas/factual-validation'; export {providerTrace} from './lib/atlas/provider-runtime';",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { generateNaturalDraft, validateNaturalDraft, providerTrace } = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  const DB = database(),
    pacing = liveCompletionPacer();
  try {
    const results = [];
    for (const scenario of selected) {
      await pacing.beforeCall();
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
      let factualValidation = null;
      let validationAttempts = [];
      if (draft) {
        await pacing.beforeCall();
        const validationTrace = providerTrace();
        factualValidation = await validateNaturalDraft(
          {
            ...process.env,
            DB,
            SUPABASE_ORGANIZATION_ID: fixture.context.organizationId,
            LLM_VALIDATION_MODE: 'shadow',
            LLM_VALIDATION_DAILY_LIMIT: String(options.maxCases),
          },
          {
            draft,
            pack: fixture.pack,
            currentPack: structuredClone(fixture.pack),
            context: fixture.context,
          },
          validationTrace,
        );
        validationAttempts = validationTrace.attempts;
      }
      results.push({
        id: scenario.id,
        language: scenario.language,
        rubric: scenario.rubric,
        draft,
        diagnostics,
        providerAttempts: trace.attempts,
        groundedness:
          factualValidation?.outcome === 'supported_candidate' &&
          factualValidation?.reason === null,
        naturalness: null,
        factualValidation,
        factualValidationAttempts: validationAttempts,
      });
    }
    const status = results.every(
      (r) =>
        r.draft &&
        r.diagnostics.outcome === 'candidate_generated' &&
        r.diagnostics.reason === null &&
        r.factualValidation?.outcome === 'supported_candidate' &&
        r.factualValidation?.reason === null &&
        r.factualValidation?.issues?.length === 0,
    )
      ? 'requires_human_review'
      : 'incomplete';
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(
      options.output,
      JSON.stringify({ status, data: 'synthetic', releaseAllowed: false, pacingIntervalMs: pacing.intervalMs, results }, null, 2) + '\n',
    );
    console.log(
      JSON.stringify({
        status,
        output: options.output,
        generationCalls: results.reduce((n, r) => n + r.diagnostics.calls, 0),
        validationCalls: results.reduce(
          (n, r) => n + (r.factualValidation?.calls ?? 0),
          0,
        ),
        failures: results
          .filter(
            (r) =>
              r.diagnostics.reason !== null ||
              !r.factualValidation ||
              r.factualValidation.reason !== null ||
              r.factualValidation.outcome !== 'supported_candidate',
          )
          .map((r) => ({
            id: r.id,
            generationReason: r.diagnostics.reason,
            validationOutcome: r.factualValidation?.outcome ?? null,
            validationReason: r.factualValidation?.reason ?? null,
            validationIssues: r.factualValidation?.issues ?? [],
            providerAttempts: r.providerAttempts,
            factualValidationAttempts: r.factualValidationAttempts,
          })),
      }),
    );
    if (status === 'incomplete') process.exitCode = 1;
  } finally {
    DB.sql.close();
  }
}
