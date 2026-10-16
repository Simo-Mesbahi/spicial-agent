import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { prepareP1Knowledge } from '../scripts/lib/p1-knowledge-preparation.mjs';

const space = 'a'.repeat(64);
const row = (indexed, remainingAfterBatch, changes = {}) => ({
  indexed, remainingAfterBatch, embeddingSpace: space,
  trace: { calls: indexed ? 1 : 0, error: null }, ...changes,
});

test('P1 preparation covers the 110-chunk corpus in four paced, sequential batches', async () => {
  const sizes = [32, 32, 32, 14];
  const events = [];
  const result = await prepareP1Knowledge({
    beforeBatch: async () => { events.push('paced'); },
    indexBatch: async (limit) => {
      assert.equal(limit, 32);
      events.push('indexed');
      return row(sizes.shift(), sizes.length > 0);
    },
  });
  assert.deepEqual(result, {
    status: 'ready', ready: true, batches: 4, indexed: 110,
    embeddingCalls: 4, embeddingSpace: space,
  });
  assert.deepEqual(events, Array.from({ length: 4 }, () => ['paced', 'indexed']).flat());
});

test('P1 preparation reuses an already-current index without embedding calls', async () => {
  let batches = 0;
  const result = await prepareP1Knowledge({
    beforeBatch: async () => {},
    indexBatch: async () => { batches++; return row(0, false); },
  });
  assert.equal(batches, 1);
  assert.equal(result.ready, true);
  assert.equal(result.embeddingCalls, 0);
});

test('P1 preparation refuses a larger unfinished corpus after 128 chunks, without a fifth call', async () => {
  let calls = 0;
  const result = await prepareP1Knowledge({
    beforeBatch: async () => {},
    indexBatch: async () => { calls++; return row(32, true); },
  });
  assert.equal(calls, 4);
  assert.equal(result.indexed, 128);
  assert.equal(result.embeddingCalls, 4);
  assert.equal(result.ready, false);
  assert.equal(result.status, 'incomplete');
});

test('P1 preparation stops on a failed provider batch, with no retry or later write', async () => {
  let calls = 0;
  const failure = Object.assign(new Error('PRIVATE upstream text'), { reason: 'upstream_rate_limited' });
  await assert.rejects(prepareP1Knowledge({
    beforeBatch: async () => {},
    indexBatch: async () => {
      calls++;
      if (calls === 2) throw failure;
      return row(32, true);
    },
  }), (error) => error === failure);
  assert.equal(calls, 2);
});

test('P1 preparation refuses a changed embedding space between batches', async () => {
  let calls = 0;
  await assert.rejects(prepareP1Knowledge({
    beforeBatch: async () => {},
    indexBatch: async () => row(32, ++calls === 1, {
      embeddingSpace: calls === 1 ? space : 'b'.repeat(64),
    }),
  }), /embedding_space_changed/);
  assert.equal(calls, 2);
});

for (const [name, result] of [
  ['missing completion signal', row(1, undefined)],
  ['stalled corpus', row(0, true)],
  ['oversized batch', row(33, false)],
  ['multiple provider calls', row(1, false, { trace: { calls: 2, error: null } })],
  ['hidden provider failure', row(1, false, { trace: { calls: 1, error: 'upstream_auth' } })],
  ['missing space identity', row(1, false, { embeddingSpace: null })],
]) test(`P1 preparation fails closed: ${name}`, async () => {
  let calls = 0;
  await assert.rejects(prepareP1Knowledge({
    beforeBatch: async () => {},
    indexBatch: async () => { calls++; return result; },
  }), /invalid_preparation_result/);
  assert.equal(calls, 1);
});

test('P1 preparation CLI is dry by default and refuses arbitrary limits', () => {
  const dry = spawnSync(process.execPath, ['scripts/prepare-p1-knowledge.mjs'], { encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  const report = JSON.parse(dry.stdout);
  assert.equal(report.status, 'dry_run');
  assert.equal(report.maximumEmbeddingCalls, 4);
  assert.equal(report.maximumChunks, 128);
  assert.equal(report.completionCalls, 0);
  const invalid = spawnSync(process.execPath, ['scripts/prepare-p1-knowledge.mjs', '--max-batches', '999'], { encoding: 'utf8' });
  assert.equal(invalid.status, 2);
  assert.deepEqual(JSON.parse(invalid.stderr), { status: 'failed', reason: 'invalid_arguments' });
});

test('P1 preparation refuses invalid live pacing without exposing configuration or raw errors', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-p1-knowledge.mjs', '--live'], {
    encoding: 'utf8',
    env: { ...process.env, P1_LIVE_EMBEDDING_MIN_INTERVAL_MS: '-1', GEMINI_API_KEY: 'PRIVATE_fixture_key' },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { status: 'failed', ready: false, reason: 'preparation_failed' });
  assert.doesNotMatch(result.stderr, /PRIVATE|Invalid live evaluation|data:text|stack|API_KEY/);
});

test('P1 workflow requires complete corpus preparation before retrieval or completions', async () => {
  const source = await readFile('.github/workflows/p1-live-qualification.yml', 'utf8');
  const preparation = source.indexOf('scripts/prepare-p1-knowledge.mjs --live');
  assert.ok(preparation > source.indexOf('Verify source before spending provider budget'));
  assert.ok(preparation < source.indexOf('Qualify live hybrid retrieval before completion spend'));
  assert.match(source, /result\.status !== 'ready' \|\| result\.ready !== true/);
  assert.match(source, /result\.embeddingCalls > 4/);
  assert.match(source, /result\.indexed > 128/);
  assert.doesNotMatch(source, /scripts\/index-knowledge\.mjs --live --max-chunks 32/);
});
