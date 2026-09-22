import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowPath = '.github/workflows/p1-live-qualification.yml';

test('P1.7 live qualification workflow is manual-only and explicitly acknowledged', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^\s*push:/m);
  assert.doesNotMatch(source, /^\s*pull_request:/m);
  assert.match(source, /Type P1_RELEASE/);
  assert.match(source, /inputs\.confirm/);
  assert.match(source, /"P1_RELEASE"/);
  assert.match(source, /refs\/heads\/main/);
  assert.match(source, /qualification_environment:/);
  assert.match(source, /type: environment/);
  assert.match(source, /environment: \$\{\{ inputs\.qualification_environment \}\}/);
  assert.match(source, /cancel-in-progress: false/);
});

test('P1.7 live qualification verifies the complete no-spend gate before provider calls', async () => {
  const source = await readFile(workflowPath, 'utf8');
  const verifyIndex = source.indexOf('Verify source before spending provider budget');
  const liveIndex = source.indexOf('Run bounded live qualification');

  assert.ok(verifyIndex >= 0);
  assert.ok(liveIndex > verifyIndex);

  const verification = source.slice(verifyIndex, liveIndex);
  for (const command of [
    'npm run typecheck',
    'npm run lint:app',
    'npm test',
    'npm run test:origin-runtime',
    'npm run eval:ai',
    'npm run eval:rag',
    'npm run eval:generation',
    'npm run eval:grounding',
    'npm run eval:p1:release',
    'npm run build',
    'npm run test:starter',
  ]) {
    assert.ok(verification.includes(command), `missing pre-spend gate: ${command}`);
  }

  assert.match(
    source,
    /npm run eval:p1:release -- --live --confirm P1_RELEASE/,
  );
});

test('P1.7 live workflow remains fail-closed until human review', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /P1_RELEASE_MODE: off/);
  assert.doesNotMatch(source, /P1_RELEASE_MODE:\s*(?:canary|on)/);
  assert.match(source, /continue-on-error: true/);
  assert.match(source, /report\.automatedPassed !== true/);
  assert.match(source, /report\.releaseAllowed !== false/);
  assert.match(source, /human_review_required/);
  assert.match(source, /eval:p1:review-template/);
  assert.match(source, /human-review\.json/);
});

test('P1.7 workflow exports only bounded qualification artifacts and no automatic rollout', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /actions\/upload-artifact@v4/);
  assert.match(source, /path: outputs\/p1-live\//);
  assert.match(source, /retention-days: 7/);
  assert.doesNotMatch(source, /P1_CANARY_PERCENT/);
  assert.doesNotMatch(source, /eval:p1:finalize/);
  assert.doesNotMatch(source, /workflow_run:/);
});

test('P1.7 workflow supports separate embedding credentials with same-provider fallback', async () => {
  const source = await readFile(workflowPath, 'utf8');

  assert.match(source, /EMBEDDING_API_KEY: \$\{\{ secrets\.EMBEDDING_API_KEY \}\}/);
  assert.match(source, /EMBEDDING_PROVIDER/);
  assert.match(source, /GEMINI_API_KEY/);
  assert.match(source, /OPENAI_API_KEY/);
  assert.match(source, /GITHUB_ENV/);
  assert.match(source, /gemini-embedding-2/);
  assert.match(source, /Gemini P1\.7 qualification requires EMBEDDING_MODEL=gemini-embedding-2/);
  assert.match(source, /OpenAI embeddings require budget_mode=approved/);
});
