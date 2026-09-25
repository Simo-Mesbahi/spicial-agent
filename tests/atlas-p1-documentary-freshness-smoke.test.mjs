import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const organizationId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000101';
const chunkId = '00000000-0000-4000-8000-000000000102';
const policyContent = 'Politique de retour vérifiée et actuellement publiée.';
const contentHash = createHash('sha256').update(policyContent).digest('hex');

function retrievalReport(overrides = {}) {
  const createdAt = overrides.createdAt ?? new Date().toISOString();
  return {
    status: 'completed',
    createdAt,
    configuration: {
      queryContract: 'canonical_fr_from_multilingual_source',
    },
    results: [
      {
        hybrid: {
          scope: 'supabase_published',
          evidence: [
            {
              documentId,
              chunkId,
              version: '1.0',
              locale: 'fr-FR',
              market: 'GLOBAL',
              contentHash,
              effectiveFrom: '2026-09-01',
              effectiveUntil: null,
            },
          ],
        },
      },
    ],
    ...overrides,
  };
}

function env() {
  return {
    ...process.env,
    SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    SUPABASE_ORGANIZATION_ID: organizationId,
  };
}

function providerPreload(dir, mode = 'normal') {
  const preload = join(dir, 'freshness-provider.mjs');
  const source = [
    "const mode = " + JSON.stringify(mode) + ";",
    "const documentId = " + JSON.stringify(documentId) + ";",
    "const chunkId = " + JSON.stringify(chunkId) + ";",
    "const policyContent = " + JSON.stringify(policyContent) + ";",
    "globalThis.fetch = async (_url, init = {}) => {",
    "  const headers = new Headers(init.headers);",
    "  const key = headers.get('apikey');",
    "  const body = JSON.parse(init.body);",
    "  if (key === 'sb_publishable_test') {",
    "    if (mode === 'publishable_allowed') return Response.json([], {status: 200});",
    "    return Response.json({code:'42501'}, {status:403});",
    "  }",
    "  if (key !== 'sb_secret_test') throw new Error('Unexpected API key');",
    "  const version = body.p_sources?.[0]?.version;",
    "  if (typeof version === 'string' && version.includes('__stale_probe__')) return Response.json([]);",
    "  const row = {",
    "    document_id: documentId,",
    "    chunk_id: chunkId,",
    "    version: '1.0',",
    "    revision: 3,",
    "    locale: 'fr-FR',",
    "    market: 'GLOBAL',",
    "    effective_from: '2026-09-01',",
    "    effective_until: null,",
    "    content: policyContent,",
    "  };",
    "  if (mode === 'changed_content') row.content = 'Changed policy text.';",
    "  return Response.json([row]);",
    "};",
  ].join('\n');
  writeFileSync(preload, source);
  return preload;
}

test('P1.7B freshness smoke proves exact evidence, changed-version blocking and client denial', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-p1-freshness-'));
  try {
    const retrieval = join(dir, 'retrieval.json');
    const output = join(dir, 'freshness-smoke.json');
    const preload = providerPreload(dir);
    writeFileSync(retrieval, JSON.stringify(retrievalReport()));

    const stdout = execFileSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        'scripts/check-documentary-freshness.mjs',
        '--live',
        '--retrieval',
        retrieval,
        '--output',
        output,
      ],
      { encoding: 'utf8', env: env() },
    );

    const summary = JSON.parse(stdout);
    const report = JSON.parse(readFileSync(output, 'utf8'));

    assert.equal(summary.status, 'passed');
    assert.equal(summary.providerCalls, 0);
    assert.equal(summary.embeddingCalls, 0);
    assert.equal(report.schema, 1);
    assert.equal(report.kind, 'p1-documentary-freshness-smoke');
    assert.equal(report.status, 'passed');
    assert.equal(
      report.retrieval.queryContract,
      'canonical_fr_from_multilingual_source',
    );
    assert.equal(report.retrieval.sourceCount, 1);
    assert.deepEqual(report.checks, {
      exactCurrentEvidence: true,
      changedVersionBlocked: true,
      publishableExecutionBlocked: true,
    });
    assert.deepEqual(report.operational, {
      databaseRpcCalls: 3,
      providerCalls: 0,
      embeddingCalls: 0,
    });
    assert.deepEqual(report.privacy, {
      documentContentIncluded: false,
      documentIdentifiersIncluded: false,
      credentialsIncluded: false,
      rawUpstreamPayloadIncluded: false,
    });

    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, new RegExp(documentId, 'i'));
    assert.doesNotMatch(serialized, new RegExp(chunkId, 'i'));
    assert.doesNotMatch(serialized, /Politique de retour/);
    assert.doesNotMatch(serialized, /sb_secret_test|sb_publishable_test/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P1.7B freshness smoke fails closed when live content changes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-p1-freshness-changed-'));
  try {
    const retrieval = join(dir, 'retrieval.json');
    const preload = providerPreload(dir, 'changed_content');
    writeFileSync(retrieval, JSON.stringify(retrievalReport()));

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            '--import',
            pathToFileURL(preload).href,
            'scripts/check-documentary-freshness.mjs',
            '--live',
            '--retrieval',
            retrieval,
            '--output',
            join(dir, 'freshness-smoke.json'),
          ],
          {
            encoding: 'utf8',
            env: env(),
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /does not match retrieval evidence/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P1.7B freshness smoke fails closed if publishable clients can execute privileged RPC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-p1-freshness-public-'));
  try {
    const retrieval = join(dir, 'retrieval.json');
    const preload = providerPreload(dir, 'publishable_allowed');
    writeFileSync(retrieval, JSON.stringify(retrievalReport()));

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            '--import',
            pathToFileURL(preload).href,
            'scripts/check-documentary-freshness.mjs',
            '--live',
            '--retrieval',
            retrieval,
            '--output',
            join(dir, 'freshness-smoke.json'),
          ],
          {
            encoding: 'utf8',
            env: env(),
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /executable by publishable clients/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P1.7B freshness smoke rejects stale retrieval before any network request', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-p1-freshness-stale-'));
  try {
    const retrieval = join(dir, 'retrieval.json');
    const preload = join(dir, 'no-network.mjs');
    writeFileSync(
      retrieval,
      JSON.stringify(
        retrievalReport({
          createdAt: new Date(Date.now() - 31 * 60_000).toISOString(),
        }),
      ),
    );
    writeFileSync(
      preload,
      "globalThis.fetch = async () => { throw new Error('network_must_not_be_called'); };",
    );

    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            '--import',
            pathToFileURL(preload).href,
            'scripts/check-documentary-freshness.mjs',
            '--live',
            '--retrieval',
            retrieval,
            '--output',
            join(dir, 'freshness-smoke.json'),
          ],
          {
            encoding: 'utf8',
            env: env(),
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      (error) => {
        assert.equal(error.status, 1);
        assert.match(error.stderr, /stale or has an invalid timestamp/);
        assert.doesNotMatch(error.stderr, /network_must_not_be_called/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('P1.7B dry run spends no network or provider budget', () => {
  const stdout = execFileSync(
    process.execPath,
    ['scripts/check-documentary-freshness.mjs'],
    { encoding: 'utf8' },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.providerCalls, 0);
  assert.equal(result.embeddingCalls, 0);
  assert.equal(result.maximumDatabaseRpcCalls, 3);
});

test('P1.7 release evaluator binds freshness smoke before completion-heavy qualification', () => {
  const source = readFileSync('scripts/evaluate-p1-release.mjs', 'utf8');
  const contractSource = readFileSync('evals/p1-release-contract.mjs', 'utf8');

  assert.match(
    source,
    /freshness: resolve\('outputs\/p1-live\/freshness-smoke\.json'\)/,
  );
  assert.match(source, /scripts\/check-documentary-freshness\.mjs/);
  assert.match(
    source,
    /documentaryFreshnessSha256: await fileSha256\(paths\.freshness\)/,
  );
  assert.match(source, /documentaryFreshness: documentaryFreshnessGate/);
  assert.match(source, /freshness\.checks\?\.exactCurrentEvidence === true/);
  assert.match(source, /freshness\.checks\?\.changedVersionBlocked === true/);
  assert.match(
    source,
    /freshness\.checks\?\.publishableExecutionBlocked === true/,
  );

  const freshnessIndex = source.indexOf('scripts/check-documentary-freshness.mjs');
  const groundingIndex = source.indexOf(
    'scripts/evaluate-grounding.mjs',
    freshnessIndex,
  );
  const structuredIndex = source.indexOf(
    'scripts/evaluate-structured-ai.mjs',
    freshnessIndex,
  );
  assert.ok(freshnessIndex >= 0);
  assert.ok(groundingIndex > freshnessIndex);
  assert.ok(structuredIndex > freshnessIndex);

  assert.match(contractSource, /documentaryFreshness:/);
  assert.match(contractSource, /maximumDatabaseRpcCalls: 3/);
  assert.match(contractSource, /providerCalls: 0/);
  assert.match(contractSource, /embeddingCalls: 0/);
});
