import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function candidate(id, language, text) {
  return {
    id,
    language,
    rubric: ['Natural concise reply', 'No invented business fact'],
    draft: {
      language,
      sentences: [{ text, evidenceRefs: ['case.status'] }],
    },
    diagnostics: {
      outcome: 'candidate_generated',
      reason: null,
      calls: 1,
    },
  };
}

async function writeQualification(path, generationRaw, overrides = {}) {
  const qualificationId = overrides.qualificationId ?? 'a'.repeat(64);
  await writeFile(
    path,
    JSON.stringify({
      schema: 1,
      kind: 'p1-live-release-qualification',
      runMode: 'live',
      automatedPassed: true,
      qualificationId,
      artifacts: {
        generationSha256: sha256(generationRaw),
      },
      ...overrides,
    }),
  );
  return qualificationId;
}

test('human review template is fail-closed and bound to the full qualification source', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-p1-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const generation = join(dir, 'generation.json');
  const qualification = join(dir, 'qualification.json');
  const output = join(dir, 'review.json');
  const generationRaw = JSON.stringify({
    status: 'requires_human_review',
    results: [
      candidate('waiting-part-fr', 'fr', 'Votre dossier est en attente.'),
      candidate('waiting-part-en', 'en', 'Your case is waiting.'),
    ],
  });
  await writeFile(generation, generationRaw);
  const qualificationId = await writeQualification(qualification, generationRaw);

  const run = spawnSync(
    process.execPath,
    [
      'scripts/create-p1-human-review.mjs',
      '--generation',
      generation,
      '--qualification-report',
      qualification,
      '--output',
      output,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  assert.equal(run.status, 0, run.stderr);
  const review = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(review.schema, 1);
  assert.equal(review.reviewer, '');
  assert.equal(review.reviewedAt, '');
  assert.equal(review.source.qualificationId, qualificationId);
  assert.equal(review.source.generationSha256, sha256(generationRaw));
  assert.equal(review.items.length, 2);

  for (const item of review.items) {
    assert.equal(item.approved, false);
    assert.equal(item.naturalness, 'pending');
    assert.equal(item.language, 'pending');
    assert.equal(item.conciseness, 'pending');
    assert.equal(item.business_tone, 'pending');
    assert.equal(item.notes, '');
    assert.ok(['fr', 'en'].includes(item.expectedLanguage));
    assert.ok(item.candidate.length > 0);
    assert.equal(item.candidateSha256, sha256(item.candidate));
    assert.ok(item.rubric.length > 0);
  }

  const summary = JSON.parse(run.stdout);
  assert.equal(summary.releaseAllowed, false);
  assert.equal(summary.scenarios, 2);
  assert.equal(summary.qualificationId, qualificationId);
});

test('human review template rejects qualification mismatch and failed generation candidates', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-p1-review-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const generation = join(dir, 'generation.json');
  const qualification = join(dir, 'qualification.json');
  const output = join(dir, 'review.json');

  const validRaw = JSON.stringify({
    results: [candidate('waiting-part-fr', 'fr', 'Texte')],
  });
  await writeFile(generation, validRaw);
  await writeQualification(qualification, validRaw, {
    artifacts: { generationSha256: 'b'.repeat(64) },
  });

  const mismatched = spawnSync(
    process.execPath,
    [
      'scripts/create-p1-human-review.mjs',
      '--generation',
      generation,
      '--qualification-report',
      qualification,
      '--output',
      output,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /not a valid automated-passed source/i);

  const failedRaw = JSON.stringify({
    results: [
      {
        ...candidate('waiting-part-fr', 'fr', 'Texte'),
        draft: null,
        diagnostics: { outcome: 'failed', reason: 'upstream_timeout' },
      },
    ],
  });
  await writeFile(generation, failedRaw);
  await writeQualification(qualification, failedRaw);

  const failed = spawnSync(
    process.execPath,
    [
      'scripts/create-p1-human-review.mjs',
      '--generation',
      generation,
      '--qualification-report',
      qualification,
      '--output',
      output,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /no valid generated candidate/i);
});

test('release finalizer is no-spend, preserves the live report and verifies exact artifacts and prose', async () => {
  const source = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(source, /const finalizeExisting = args\.includes\('--finalize-existing'\)/);
  assert.match(source, /if \(live\) \{[\s\S]*evaluate-structured-ai\.mjs/);
  assert.match(
    source,
    /Finalization output must not overwrite the original live qualification report/,
  );
  assert.match(
    source,
    /qualificationArtifactIntegrity: qualificationAnchor\.valid/,
  );
  assert.match(
    source,
    /review\.source\?\.qualificationId === qualificationId/,
  );
  assert.match(
    source,
    /item\.candidate === expected\.candidate/,
  );
  assert.match(
    source,
    /item\.candidateSha256 === expected\.candidateSha256/,
  );
  assert.match(
    source,
    /--finalize-existing requires --human-review and reuses existing qualification reports without provider calls/,
  );
});
