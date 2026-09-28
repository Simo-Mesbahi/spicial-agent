import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/p1-provider-smoke.yml', 'utf8');

test('provider smoke is manual, protected, single-call and cannot release responses', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
  assert.match(workflow, /environment: \$\{\{ inputs\.qualification_environment \}\}/);
  assert.match(workflow, /GEMINI_API_KEY: \$\{\{ secrets\.GEMINI_API_KEY \}\}/);
  assert.match(workflow, /SMOKE_CONFIRM: \$\{\{ inputs\.confirm \}\}/);
  assert.match(workflow, /\$\{SMOKE_CONFIRM\}[^\n]*P1_SMOKE[^\n]*refs\/heads\/main/);
  assert.doesNotMatch(workflow, /run:[^]*\$\{\{ inputs\.confirm \}\}/);
  assert.match(workflow, /group: p1-live-qualification/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /P1_RELEASE_MODE: off/);
  assert.match(workflow, /LLM_VALIDATION_MODE: shadow/);
  assert.match(workflow, /LLM_VALIDATION_TIMEOUT_MS: '20000'/);
  assert.match(
    workflow,
    /node scripts\/evaluate-grounding\.mjs --live --offset 0 --max-cases 1 --max-retries 0 --output outputs\/p1-provider-smoke\/grounding\.json/,
  );
  assert.equal((workflow.match(/scripts\/evaluate-grounding\.mjs --live/g) ?? []).length, 1);
});
