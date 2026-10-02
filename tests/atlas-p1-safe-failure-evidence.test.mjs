import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('P1.7 emits redacted structured diagnostics only on a failed gate', async () => {
  const source = await readFile('.github/workflows/p1-live-qualification.yml', 'utf8');
  const verify = source.indexOf('      - name: Verify automated qualification gate');
  const diagnostic = source.indexOf(
    '      - name: Emit redacted structured provider failure evidence',
  );
  const review = source.indexOf('      - name: Generate fail-closed human review template');

  assert.ok(verify >= 0);
  assert.ok(diagnostic > verify);
  assert.ok(review > diagnostic);

  const block = source.slice(diagnostic, review);
  assert.match(block, /if: failure\(\)/);
  assert.match(
    block,
    /node scripts\/report-p1-structured-failures\.mjs outputs\/p1-live\/structured\.json/,
  );
  assert.doesNotMatch(block, /cat\s+outputs\/p1-live\/structured\.json/);
  assert.doesNotMatch(block, /response|message|prompt|API_KEY/);
});

test('P1.7 redacted failure reporter never prints arbitrary provider or customer text', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'p1-redacted-evidence-'));
  const reportPath = join(directory, 'structured.json');
  try {
    await writeFile(
      reportPath,
      JSON.stringify({
        rows: [
          {
            id: 'pre-p1-correction-understanding-ar/3',
            status: 200,
            fallback: 'provider_unavailable',
            fallbackReason: 'upstream_request_rejected',
            checks: { intent: null },
            response: 'PRIVATE-CUSTOMER answer body',
            providerDiagnostic: {
              reason: 'upstream_request_rejected',
              httpStatus: 400,
              code: 'invalid_request_error',
              parameter: null,
              retryAfterMs: null,
              rateLimitScope: null,
              groqFailureKind: 'schema_generation',
              message: 'PRIVATE-PROVIDER generated JSON',
              secret: 'PRIVATE-KEY',
            },
          },
        ],
      }),
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      ['scripts/report-p1-structured-failures.mjs', reportPath],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /structured_provider_failures/);
    assert.match(result.stderr, /pre-p1-correction-understanding-ar\/3/);
    assert.match(result.stderr, /invalid_request_error/);
    assert.match(result.stderr, /schema_generation/);
    assert.doesNotMatch(result.stderr, /PRIVATE|answer body|generated JSON/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
