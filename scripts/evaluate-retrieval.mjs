#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { database } from '../tests/helpers/atlas-fixture.mjs';
import { retrievalScenarios } from '../evals/retrieval.mjs';
const args = process.argv.slice(2);
const options = { live: false, maxQueries: 5, output: 'outputs/retrieval-evaluation.json' };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--live') options.live = true;
  else if (args[i] === '--max-queries') options.maxQueries = Number(args[++i]);
  else if (args[i] === '--output') options.output = args[++i];
  else throw new Error('Unknown argument');
}
if (
  !Number.isInteger(options.maxQueries) ||
  options.maxQueries < 1 ||
  options.maxQueries > 20 ||
  !options.output
)
  throw new Error('Invalid evaluation options');
const scenarios = retrievalScenarios.slice(0, options.maxQueries);
if (!options.live) {
  console.log(
    JSON.stringify(
      {
        status: 'dry_run',
        scenarios: scenarios.map((s) => s.id),
        maxEmbeddingCalls: scenarios.length,
        maxCompletionCalls: 0,
        note: 'No requests sent. Labels refer to the published repository seed corpus.',
      },
      null,
      2,
    ),
  );
} else {
  const built = await build({
    entryPoints: ['lib/atlas/knowledge-runtime.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  });
  const { searchKnowledge } = await import(
    'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64')
  );
  const DB = database(),
    results = [];
  try {
    const cfg = {
      ...process.env,
      DB,
      RAG_MODE: 'hybrid',
      RAG_RESULTS: 3,
      EMBEDDING_DAILY_LIMIT: String(scenarios.length),
    };
    for (const scenario of scenarios) {
      const turns = {};
      for (const [mode, limit] of [
        ['lexical', '0'],
        ['hybrid', String(scenarios.length)],
      ]) {
        const start = performance.now();
        const result = await searchKnowledge(
          { ...cfg, EMBEDDING_DAILY_LIMIT: limit },
          scenario.query,
        );
        const hits = result.articles.filter((a) =>
          scenario.expectedTitles.includes(a.title),
        ).length;
        turns[mode] = {
          scope: result.scope,
          precisionAtK: result.articles.length ? hits / result.articles.length : 0,
          recallAtK: hits ? 1 : 0,
          latencyMs: Math.round(performance.now() - start),
          retrieval: result.retrieval,
          evidence: result.evidence,
          returnedTitles: result.articles.map((a) => a.title),
        };
      }
      results.push({ id: scenario.id, language: scenario.language, ...turns });
    }
    const report = {
      status: results.every(
        (r) =>
          r.lexical.scope === 'supabase_published' &&
          r.hybrid.scope === 'supabase_published' &&
          r.hybrid.retrieval?.embedding.calls === 1 &&
          r.hybrid.retrieval.embedding.error === null,
      )
        ? 'completed'
        : 'incomplete',
      completionCalls: 0,
      results,
      note: 'Transport and retrieval relevance only. Review the corpus labels; no claim about conversation naturalness or semantic factual consistency.',
    };
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
    console.log(
      JSON.stringify({ status: report.status, queries: results.length, output: options.output }),
    );
    if (report.status !== 'completed') process.exitCode = 1;
  } finally {
    DB.sql.close();
  }
}
