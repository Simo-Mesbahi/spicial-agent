import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  liveCompletionPacer,
  boundedExponentialRetryDelay,
} from '../scripts/lib/live-eval-pacing.mjs';
import { searchLexicalWithTransientRetries } from '../scripts/lib/live-retrieval-resilience.mjs';

const qualificationEnv = {
  ...process.env,
  EMBEDDING_PROVIDER: 'gemini',
  EMBEDDING_MODEL: 'gemini-embedding-2',
  EMBEDDING_REVISION: '1',
  RAG_CORPUS_LOCALE: 'fr-FR',
  RAG_MARKET: 'GLOBAL',
  RAG_MIN_SIMILARITY: '0.7',
  RAG_MIN_LEXICAL_SCORE: '3',
};

function retrievalRow(index, changes = {}) {
  const languages = ['fr', 'en', 'de', 'es', 'ar'];
  const base = {
    id: `retrieval-contract-${index}`,
    language: languages[index % languages.length],
    lexical: {
      scope: 'supabase_published',
      recallAtK: 1,
      precisionAtK: 1 / 3,
      retrieval: {
        backend: {
          calls: 1,
          retries: 0,
          timeoutMs: 5000,
          error: null,
        },
      },
    },
    hybrid: {
      scope: 'supabase_published',
      recallAtK: 1,
      precisionAtK: 1 / 3,
      retrieval: {
        backend: {
          calls: 1,
          retries: 0,
          timeoutMs: 5000,
          error: null,
        },
        embedding: {
          calls: 1,
          error: null,
        },
      },
    },
  };
  return {
    ...base,
    ...changes,
    lexical: {
      ...base.lexical,
      ...(changes.lexical ?? {}),
      retrieval: {
        ...base.lexical.retrieval,
        ...(changes.lexical?.retrieval ?? {}),
        backend: {
          ...base.lexical.retrieval.backend,
          ...(changes.lexical?.retrieval?.backend ?? {}),
        },
      },
    },
    hybrid: {
      ...base.hybrid,
      ...(changes.hybrid ?? {}),
      retrieval: {
        ...base.hybrid.retrieval,
        ...(changes.hybrid?.retrieval ?? {}),
        backend: {
          ...base.hybrid.retrieval.backend,
          ...(changes.hybrid?.retrieval?.backend ?? {}),
        },
        embedding: {
          ...base.hybrid.retrieval.embedding,
          ...(changes.hybrid?.retrieval?.embedding ?? {}),
        },
      },
    },
  };
}

function report(rows) {
  return {
    createdAt: new Date().toISOString(),
    configuration: {
      queryContract: 'canonical_fr_from_multilingual_source',
      corpusLocale: 'fr-FR',
      market: 'GLOBAL',
      minSimilarity: 0.7,
      minLexicalScore: 3,
      embeddingProvider: 'gemini',
      embeddingModel: 'gemini-embedding-2',
      embeddingRevision: '1',
    },
    status: 'completed',
    completionCalls: 0,
    operational: {
      transientRetriesUsed: 0,
      maximumTransientRetries: 2,
      backendRetriesUsed: 0,
    },
    results: rows,
  };
}

test('P1.7 retrieval preflight accepts only a fresh report satisfying every query contract', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-retrieval-gate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'retrieval.json');

  await writeFile(path, JSON.stringify(report(Array.from({ length: 20 }, (_, i) => retrievalRow(i)))));
  const passed = spawnSync(
    process.execPath,
    ['scripts/check-retrieval-qualification.mjs', path],
    { encoding: 'utf8', env: qualificationEnv },
  );
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(JSON.parse(passed.stdout).status, 'retrieval_qualified');

  const recoveredTransient = report(
    Array.from({ length: 20 }, (_, i) =>
      retrievalRow(i, i === 0
        ? { hybrid: { retrieval: { backend: { calls: 2, retries: 1 } } } }
        : {}),
    ),
  );
  recoveredTransient.operational.backendRetriesUsed = 1;
  await writeFile(path, JSON.stringify(recoveredTransient));
  const acceptedRecoveredTransient = spawnSync(
    process.execPath,
    ['scripts/check-retrieval-qualification.mjs', path],
    { encoding: 'utf8', env: qualificationEnv },
  );
  assert.equal(acceptedRecoveredTransient.status, 0, acceptedRecoveredTransient.stderr);

  const staleContract = report(Array.from({ length: 20 }, (_, i) => retrievalRow(i)));
  staleContract.configuration.queryContract = 'raw_multilingual_query';
  await writeFile(path, JSON.stringify(staleContract));
  const rejectedContract = spawnSync(
    process.execPath,
    ['scripts/check-retrieval-qualification.mjs', path],
    { encoding: 'utf8', env: qualificationEnv },
  );
  assert.notEqual(rejectedContract.status, 0);
  assert.equal(
    JSON.parse(rejectedContract.stdout).configurationMatchesEnvironment,
    false,
  );

  const excessiveRetries = report(Array.from({ length: 20 }, (_, i) => retrievalRow(i)));
  excessiveRetries.operational.maximumTransientRetries = 3;
  await writeFile(path, JSON.stringify(excessiveRetries));
  const rejectedRetryBudget = spawnSync(
    process.execPath,
    ['scripts/check-retrieval-qualification.mjs', path],
    { encoding: 'utf8', env: qualificationEnv },
  );
  assert.notEqual(rejectedRetryBudget.status, 0);
  assert.equal(JSON.parse(rejectedRetryBudget.stdout).operational.maximumTransientRetries, 3);

  const excessiveBackendRetries = report(
    Array.from({ length: 20 }, (_, i) =>
      retrievalRow(i, i === 0
        ? { hybrid: { retrieval: { backend: { calls: 3, retries: 2 } } } }
        : {}),
    ),
  );
  excessiveBackendRetries.operational.backendRetriesUsed = 2;
  await writeFile(path, JSON.stringify(excessiveBackendRetries));
  const rejectedBackendRetry = spawnSync(
    process.execPath,
    ['scripts/check-retrieval-qualification.mjs', path],
    { encoding: 'utf8', env: qualificationEnv },
  );
  assert.notEqual(rejectedBackendRetry.status, 0);

  const excessiveBackendTotal = report(Array.from({ length: 20 }, (_, i) => retrievalRow(i)));
  excessiveBackendTotal.operational.backendRetriesUsed = 5;
  await writeFile(path, JSON.stringify(excessiveBackendTotal));
  const rejectedBackendTotal = spawnSync(
    process.execPath,
    ['scripts/check-retrieval-qualification.mjs', path],
    { encoding: 'utf8', env: qualificationEnv },
  );
  assert.notEqual(rejectedBackendTotal.status, 0);

  const unsafe = Array.from({ length: 20 }, (_, i) =>
    retrievalRow(i, i === 7 ? { hybrid: { recallAtK: 0 } } : {}),
  );
  await writeFile(path, JSON.stringify(report(unsafe)));
  const failed = spawnSync(
    process.execPath,
    ['scripts/check-retrieval-qualification.mjs', path],
    { encoding: 'utf8', env: qualificationEnv },
  );
  assert.notEqual(failed.status, 0);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.status, 'retrieval_not_qualified');
  assert.equal(failure.failures.length, 1);
  assert.equal(failure.failures[0].id, 'retrieval-contract-7');
});

test('P1.7 lexical retrieval retries one transient Supabase outage without embedding spend', async () => {
  let calls = 0;
  const waits = [];
  const recovered = await searchLexicalWithTransientRetries(
    async () => {
      calls++;
      return calls === 1
        ? { scope: 'supabase_unavailable', articles: [] }
        : { scope: 'supabase_published', articles: [{ title: 'verified' }] };
    },
    2,
    { wait: async (attempt) => waits.push(attempt) },
  );
  assert.equal(calls, 2);
  assert.equal(recovered.retries, 1);
  assert.equal(recovered.result.scope, 'supabase_published');
  assert.deepEqual(waits, [0]);

  calls = 0;
  const exhausted = await searchLexicalWithTransientRetries(
    async () => {
      calls++;
      return { scope: 'supabase_unavailable', articles: [] };
    },
    2,
    { wait: async () => {} },
  );
  assert.equal(calls, 3);
  assert.equal(exhausted.retries, 2);
  assert.equal(exhausted.result.scope, 'supabase_unavailable');
});

test('P1.7 transient retry backoff is bounded and exponential', () => {
  assert.equal(boundedExponentialRetryDelay(15000, 0), 15000);
  assert.equal(boundedExponentialRetryDelay(15000, 1), 30000);
  assert.equal(boundedExponentialRetryDelay(15000, 2), 30000);
  assert.equal(boundedExponentialRetryDelay(0, 4), 0);
  assert.throws(() => boundedExponentialRetryDelay(-1, 0));
  assert.throws(() => boundedExponentialRetryDelay(15000, -1));
  assert.throws(() => boundedExponentialRetryDelay(15000, 17));
});

test('P1.7 completion pacing is bounded, deterministic and does not issue provider calls', async () => {
  const pacer = liveCompletionPacer({ P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0' });
  assert.equal(pacer.intervalMs, 0);
  await pacer.beforeCall();
  await pacer.beforeCall();
  assert.throws(
    () => liveCompletionPacer({ P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '30001' }),
    /Invalid live evaluation pacing interval/,
  );
  assert.throws(
    () => liveCompletionPacer({ P1_LIVE_COMPLETION_MIN_INTERVAL_MS: 'NaN' }),
    /Invalid live evaluation pacing interval/,
  );
});
