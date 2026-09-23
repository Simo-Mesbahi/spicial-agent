import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { liveCompletionPacer } from '../scripts/lib/live-eval-pacing.mjs';

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
    },
    hybrid: {
      scope: 'supabase_published',
      recallAtK: 1,
      precisionAtK: 1 / 3,
      retrieval: {
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
    lexical: { ...base.lexical, ...(changes.lexical ?? {}) },
    hybrid: {
      ...base.hybrid,
      ...(changes.hybrid ?? {}),
      retrieval: {
        ...base.hybrid.retrieval,
        ...(changes.hybrid?.retrieval ?? {}),
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
