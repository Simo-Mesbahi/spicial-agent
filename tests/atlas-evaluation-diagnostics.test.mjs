import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

for (const script of ['generation', 'grounding'])
  test(`${script} live runner reports the actual provider and safe rejection without a second call`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-diagnostic-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const preload = join(dir, 'provider.mjs'),
      output = join(dir, 'report.json');
    writeFileSync(
      preload,
      `
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      if (++calls > 1) throw new Error('Unexpected retry');
      if (!url.startsWith('https://generativelanguage.googleapis.com/')) throw new Error('Wrong provider');
      if (JSON.parse(init.body).model !== 'gemini-2.5-flash') throw new Error('Wrong model');
      return Response.json([{error:{code:404,status:'NOT_FOUND',message:'PRIVATE-KEY PRIVATE-CUSTOMER'}}],{status:404});
    };
  `,
    );
    let stdout;
    try {
      execFileSync(
        process.execPath,
        [
          '--import',
          pathToFileURL(preload).href,
          `scripts/evaluate-${script}.mjs`,
          '--live',
          '--max-cases',
          '1',
          '--output',
          output,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            LLM_PROVIDER: 'gemini',
            LLM_MODEL: '',
            LLM_BUDGET_MODE: 'free',
            GEMINI_MODEL: 'gemini-2.5-flash',
            GEMINI_API_KEY: 'PRIVATE-KEY',
            LLM_STRUCTURED_OUTPUT: '',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      assert.fail('Expected incomplete evaluation');
    } catch (error) {
      assert.equal(error.status, 1);
      stdout = error.stdout;
    }
    const summary = JSON.parse(stdout),
      report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(summary.status, 'incomplete');
    if (script === 'generation') {
      assert.equal(summary.generationCalls, 1);
      assert.equal(summary.validationCalls, 0);
    } else {
      assert.equal(summary.calls, 1);
    }
    assert.equal(summary.failures.length, 1);
    const attempt = summary.failures[0].providerAttempts[0];
    assert.equal(attempt.provider, 'gemini');
    assert.equal(attempt.model, 'gemini-2.5-flash');
    assert.equal(attempt.httpStatus, 404);
    assert.equal(attempt.diagnostic.code, 'NOT_FOUND');
    assert.deepEqual(report.results[0].providerAttempts, summary.failures[0].providerAttempts);
    assert.equal(attempt.inputTokens, null);
    assert.equal(attempt.outputTokens, null);
    assert.doesNotMatch(stdout + JSON.stringify(report), /PRIVATE-KEY|PRIVATE-CUSTOMER/);
  });


test('generation live qualification retries one transient 503 then factually validates the clean candidate', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-generation-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'provider.mjs');
  const output = join(dir, 'report.json');
  writeFileSync(
    preload,
    `
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls++;
      const payload = JSON.parse(init.body);
      if (calls === 1)
        return Response.json({error:{code:503,status:'UNAVAILABLE',message:'temporary'}},{status:503});
      const name = payload.response_format?.json_schema?.name;
      if (name === 'natural_response_draft') {
        return Response.json({
          choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({
            language:'fr',
            sentences:[{text:'Aucune date de retour n’est confirmée.',evidenceRefs:['case.confirmedEta']}]
          })}}],
          usage:{prompt_tokens:20,completion_tokens:8}
        });
      }
      if (name === 'factual_validation') {
        return Response.json({
          choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({
            language:'fr',
            sentences:[{verdict:'supported',issues:[]}]
          })}}],
          usage:{prompt_tokens:20,completion_tokens:8}
        });
      }
      throw new Error('Unexpected schema ' + name);
    };
  `,
  );
  const stdout = execFileSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      'scripts/evaluate-generation.mjs',
      '--live',
      '--max-cases',
      '1',
      '--output',
      output,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        LLM_PROVIDER: 'gemini',
        LLM_BUDGET_MODE: 'free',
        GEMINI_MODEL: 'gemini-3.5-flash-lite',
        GEMINI_API_KEY: 'PRIVATE-KEY',
        LLM_STRUCTURED_OUTPUT: 'json_schema',
        P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
        P1_GENERATION_MAX_RETRIES: '1',
        P1_GENERATION_VALIDATION_MAX_RETRIES: '0',
        P1_GENERATION_RETRY_BACKOFF_MS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const summary = JSON.parse(stdout);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(summary.status, 'requires_human_review');
  assert.equal(summary.generationCalls, 2);
  assert.equal(summary.validationCalls, 1);
  assert.equal(summary.generationRetries, 1);
  assert.equal(summary.validationRetries, 0);
  assert.equal(summary.systemicTransportFailure, null);
  assert.equal(report.operational.discardedGenerationCalls, 1);
  assert.equal(report.results[0].groundedness, true);
  assert.equal(report.results[0].factualValidation.outcome, 'supported_candidate');
});

test('grounding live qualification retries one transient 503 but never retries 429', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-grounding-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const successPreload = join(dir, 'success-provider.mjs');
  const successOutput = join(dir, 'success.json');
  writeFileSync(
    successPreload,
    `
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1)
        return Response.json({error:{code:503,status:'UNAVAILABLE',message:'temporary'}},{status:503});
      return Response.json({
        choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({
          language:'fr',
          sentences:[{verdict:'supported',issues:[]}]
        })}}],
        usage:{prompt_tokens:20,completion_tokens:8}
      });
    };
  `,
  );
  const successStdout = execFileSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(successPreload).href,
      'scripts/evaluate-grounding.mjs',
      '--live',
      '--max-cases',
      '1',
      '--max-retries',
      '1',
      '--output',
      successOutput,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        LLM_PROVIDER: 'gemini',
        LLM_BUDGET_MODE: 'free',
        GEMINI_MODEL: 'gemini-3.5-flash-lite',
        GEMINI_API_KEY: 'PRIVATE-KEY',
        LLM_STRUCTURED_OUTPUT: 'json_schema',
        P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
        P1_GROUNDING_RETRY_BACKOFF_MS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const successSummary = JSON.parse(successStdout);
  assert.equal(successSummary.status, 'requires_human_review');
  assert.equal(successSummary.calls, 2);
  assert.equal(successSummary.retryCalls, 1);
  assert.equal(successSummary.systemicTransportFailure, null);

  const ratePreload = join(dir, 'rate-provider.mjs');
  const rateOutput = join(dir, 'rate.json');
  writeFileSync(
    ratePreload,
    `
    let calls = 0;
    globalThis.fetch = async () => {
      if (++calls > 1) throw new Error('429 must not retry');
      return Response.json({error:{code:429,status:'RESOURCE_EXHAUSTED',message:'rate'}},{status:429});
    };
  `,
  );
  let stdout;
  try {
    execFileSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(ratePreload).href,
        'scripts/evaluate-grounding.mjs',
        '--live',
        '--max-cases',
        '1',
        '--max-retries',
        '1',
        '--output',
        rateOutput,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          LLM_PROVIDER: 'gemini',
          LLM_BUDGET_MODE: 'free',
          GEMINI_MODEL: 'gemini-3.5-flash-lite',
          GEMINI_API_KEY: 'PRIVATE-KEY',
          LLM_STRUCTURED_OUTPUT: 'json_schema',
          P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
          P1_GROUNDING_RETRY_BACKOFF_MS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.fail('Expected rate-limited grounding evaluation');
  } catch (error) {
    assert.equal(error.status, 1);
    stdout = error.stdout;
  }
  const rateSummary = JSON.parse(stdout);
  assert.equal(rateSummary.calls, 1);
  assert.equal(rateSummary.retryCalls, 0);
  assert.equal(rateSummary.systemicTransportFailure, 'provider_rate_limited');
});
