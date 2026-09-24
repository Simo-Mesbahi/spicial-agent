import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const compiled = await build({
  stdin: {
    contents:
      "export {createReleaseAttestation,verifyReleaseAttestation} from './lib/atlas/p1-release-attestation';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { createReleaseAttestation, verifyReleaseAttestation } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

const organizationId = '00000000-0000-4000-8000-000000000001';
const sourceTreeSha = 'a'.repeat(40);
const secret = 'release-attestation-test-key-with-strong-length-2026';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function payload(now) {
  return {
    schema: 1,
    qualificationId: 'b'.repeat(64),
    sourceTreeSha,
    organizationId,
    approvedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 60 * 60_000).toISOString(),
  };
}

test('signed P1.7 release attestation verifies only for its exact source tree and organization', async () => {
  const now = Date.now();
  const token = await createReleaseAttestation(payload(now), secret, now);
  assert.match(token, /^p1a1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const valid = await verifyReleaseAttestation(
    {
      token,
      secret,
      deployedSourceTreeSha: sourceTreeSha,
      organizationId,
    },
    now,
  );
  assert.equal(valid.valid, true);
  assert.equal(valid.payload.qualificationId, 'b'.repeat(64));

  const wrongTree = await verifyReleaseAttestation(
    {
      token,
      secret,
      deployedSourceTreeSha: 'c'.repeat(40),
      organizationId,
    },
    now,
  );
  assert.deepEqual(wrongTree, {
    valid: false,
    payload: null,
    reason: 'source_mismatch',
  });

  const wrongOrganization = await verifyReleaseAttestation(
    {
      token,
      secret,
      deployedSourceTreeSha: sourceTreeSha,
      organizationId: '00000000-0000-4000-8000-000000000002',
    },
    now,
  );
  assert.deepEqual(wrongOrganization, {
    valid: false,
    payload: null,
    reason: 'organization_mismatch',
  });
});

test('release attestation rejects signature tampering, expiry and weak keys', async () => {
  const now = Date.now();
  const token = await createReleaseAttestation(payload(now), secret, now);
  const parts = token.split('.');
  const last = parts[2].at(-1);
  parts[2] = parts[2].slice(0, -1) + (last === 'A' ? 'B' : 'A');

  const tampered = await verifyReleaseAttestation(
    {
      token: parts.join('.'),
      secret,
      deployedSourceTreeSha: sourceTreeSha,
      organizationId,
    },
    now,
  );
  assert.equal(tampered.valid, false);
  assert.equal(tampered.reason, 'invalid_signature');

  const expired = await verifyReleaseAttestation(
    {
      token,
      secret,
      deployedSourceTreeSha: sourceTreeSha,
      organizationId,
    },
    now + 2 * 60 * 60_000,
  );
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'expired');

  await assert.rejects(
    () => createReleaseAttestation(payload(now), 'short-key', now),
    /invalid_release_attestation_key/,
  );
});

test('attestation generator signs only a fully approved final qualification and never writes its key', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-p1-attestation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const reportPath = join(dir, 'release-final.json');
  const outputPath = join(dir, 'release-attestation.json');
  const scope = { organizationId };
  const artifacts = {
    sourceTreeSha,
    contractSha256: 'c'.repeat(64),
    knowledgeIndexSha256: '9'.repeat(64),
    structuredSha256: 'd'.repeat(64),
    retrievalSha256: 'e'.repeat(64),
    generationSha256: 'f'.repeat(64),
    groundingSha256: [
      '1'.repeat(64),
      '2'.repeat(64),
      '3'.repeat(64),
      '4'.repeat(64),
      '5'.repeat(64),
    ],
  };
  const qualificationId = sha256(JSON.stringify({ scope, artifacts }));
  const report = {
    schema: 1,
    kind: 'p1-live-release-qualification',
    runMode: 'finalize_existing',
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    qualificationId,
    parentQualificationId: qualificationId,
    releaseAllowed: true,
    automatedPassed: true,
    scope,
    source: { treeSha: sourceTreeSha },
    artifacts,
    qualificationAnchor: {
      valid: true,
      sourceQualificationId: qualificationId,
    },
    gates: {
      subprocesses: true,
      reportsReadable: true,
      qualificationArtifactIntegrity: true,
      knowledgeIndex: true,
      structured: true,
      retrieval: true,
      generation: true,
      grounding: true,
    },
    humanReview: {
      valid: true,
      approved: true,
      qualificationId,
    },
  };
  await writeFile(reportPath, JSON.stringify(report));

  const run = spawnSync(
    process.execPath,
    [
      'scripts/create-p1-release-attestation.mjs',
      '--final-report',
      reportPath,
      '--output',
      outputPath,
      '--expires-hours',
      '24',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, P1_RELEASE_ATTESTATION_KEY: secret },
    },
  );
  assert.equal(run.status, 0, run.stderr);

  const artifact = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(artifact.kind, 'p1-release-attestation');
  assert.equal(artifact.payload.qualificationId, qualificationId);
  assert.equal(artifact.payload.organizationId, organizationId);
  assert.equal(artifact.payload.sourceTreeSha, sourceTreeSha);
  assert.equal(artifact.deployment.P1_DEPLOYED_SOURCE_TREE_SHA, sourceTreeSha);
  assert.equal(artifact.deployment.P1_RELEASE_ATTESTATION, artifact.token);
  assert.doesNotMatch(JSON.stringify(artifact), new RegExp(secret));

  const verified = await verifyReleaseAttestation(
    {
      token: artifact.token,
      secret,
      deployedSourceTreeSha: sourceTreeSha,
      organizationId,
    },
    Date.now(),
  );
  assert.equal(verified.valid, true);
});

test('attestation generator fails closed for incomplete human approval', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-p1-attestation-fail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const reportPath = join(dir, 'release-final.json');
  const scope = { organizationId };
  const artifacts = {
    sourceTreeSha,
    contractSha256: 'c'.repeat(64),
    knowledgeIndexSha256: '9'.repeat(64),
    structuredSha256: 'd'.repeat(64),
    retrievalSha256: 'e'.repeat(64),
    generationSha256: 'f'.repeat(64),
    groundingSha256: [
      '1'.repeat(64),
      '2'.repeat(64),
      '3'.repeat(64),
      '4'.repeat(64),
      '5'.repeat(64),
    ],
  };
  const qualificationId = sha256(JSON.stringify({ scope, artifacts }));
  await writeFile(
    reportPath,
    JSON.stringify({
      schema: 1,
      kind: 'p1-live-release-qualification',
      runMode: 'finalize_existing',
      createdAt: new Date().toISOString(),
      qualificationId,
      parentQualificationId: qualificationId,
      releaseAllowed: true,
      automatedPassed: true,
      scope,
      source: { treeSha: sourceTreeSha },
      artifacts,
      qualificationAnchor: { valid: true, sourceQualificationId: qualificationId },
      gates: {
        subprocesses: true,
        reportsReadable: true,
        qualificationArtifactIntegrity: true,
        structured: true,
        retrieval: true,
        generation: true,
        grounding: true,
      },
      humanReview: { valid: true, approved: false, qualificationId },
    }),
  );

  const run = spawnSync(
    process.execPath,
    ['scripts/create-p1-release-attestation.mjs', '--final-report', reportPath],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, P1_RELEASE_ATTESTATION_KEY: secret },
    },
  );

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /not an approved, artifact-bound P1\.7 qualification/i);
});
