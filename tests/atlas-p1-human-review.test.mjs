import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

test('human review template is generated fail-closed and preserves review context', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-p1-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const generation = join(dir, 'generation.json');
  const output = join(dir, 'review.json');
  await writeFile(
    generation,
    JSON.stringify({
      status: 'requires_human_review',
      results: [
        candidate('waiting-part-fr', 'fr', 'Votre dossier est en attente.'),
        candidate('waiting-part-en', 'en', 'Your case is waiting.'),
      ],
    }),
  );

  const run = spawnSync(
    process.execPath,
    [
      'scripts/create-p1-human-review.mjs',
      '--generation',
      generation,
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
  assert.equal(review.items.length, 2);
  assert.match(review.source.generationSha256, /^[a-f0-9]{64}$/);

  for (const item of review.items) {
    assert.equal(item.approved, false);
    assert.equal(item.naturalness, 'pending');
    assert.equal(item.language, 'pending');
    assert.equal(item.conciseness, 'pending');
    assert.equal(item.business_tone, 'pending');
    assert.equal(item.notes, '');
    assert.ok(['fr', 'en'].includes(item.expectedLanguage));
    assert.ok(item.candidate.length > 0);
    assert.ok(item.rubric.length > 0);
  }

  const summary = JSON.parse(run.stdout);
  assert.equal(summary.releaseAllowed, false);
  assert.equal(summary.scenarios, 2);
});

test('human review template refuses missing or failed generation candidates', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-p1-review-invalid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const generation = join(dir, 'generation.json');
  const output = join(dir, 'review.json');
  await writeFile(
    generation,
    JSON.stringify({
      results: [
        {
          ...candidate('waiting-part-fr', 'fr', 'Texte'),
          draft: null,
          diagnostics: { outcome: 'failed', reason: 'upstream_timeout' },
        },
      ],
    }),
  );

  const run = spawnSync(
    process.execPath,
    [
      'scripts/create-p1-human-review.mjs',
      '--generation',
      generation,
      '--output',
      output,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /no valid generated candidate/i);
});


test('release finalizer is explicitly no-spend and binds review to the generation artifact', async () => {
  const source = await readFile('scripts/evaluate-p1-release.mjs', 'utf8');

  assert.match(source, /const finalizeExisting = args\.includes\('--finalize-existing'\)/);
  assert.match(source, /if \(live\) \{[\s\S]*evaluate-structured-ai\.mjs/);
  assert.match(
    source,
    /review\.source\?\.generationSha256 === \(await fileSha256\(paths\.generation\)\)/,
  );
  assert.match(
    source,
    /--finalize-existing requires --human-review and reuses existing qualification reports without provider calls/,
  );
});
