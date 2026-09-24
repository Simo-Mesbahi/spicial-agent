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


for (const script of ['generation', 'grounding'])
  test(`${script} live runner retries one 503 within budget but never retries the final semantic/request failure`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-retry-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const preload = join(dir, 'provider.mjs');
    const output = join(dir, 'report.json');
    writeFileSync(
      preload,
      `
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1)
          return Response.json([{error:{code:503,status:'UNAVAILABLE'}}], {status:503});
        if (calls === 2)
          return Response.json([{error:{code:404,status:'NOT_FOUND'}}], {status:404});
        throw new Error('Unexpected third call');
      };
      `,
    );
    const retryArgs =
      script === 'generation'
        ? ['--max-generation-retries', '1']
        : ['--max-retries', '1'];
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
          ...retryArgs,
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
            GEMINI_API_KEY: 'test-key',
            LLM_STRUCTURED_OUTPUT: '',
            P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
            P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '0',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      assert.fail('Expected incomplete evaluation');
    } catch (error) {
      assert.equal(error.status, 1);
      stdout = error.stdout;
    }
    const summary = JSON.parse(stdout);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(summary.status, 'incomplete');
    if (script === 'generation') {
      assert.equal(summary.generationCalls, 2);
      assert.equal(summary.generationRetriesUsed, 1);
      assert.equal(report.operational.generationRetriesUsed, 1);
    } else {
      assert.equal(summary.calls, 2);
      assert.equal(summary.retriesUsed, 1);
      assert.equal(report.operational.retriesUsed, 1);
    }
  });

for (const script of ['generation', 'grounding'])
  test(`${script} live runner does not retry HTTP 429 even when transport retry budget exists`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-rate-limit-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const preload = join(dir, 'provider.mjs');
    const output = join(dir, 'report.json');
    writeFileSync(
      preload,
      `
      let calls = 0;
      globalThis.fetch = async () => {
        if (++calls > 1) throw new Error('Unexpected retry after 429');
        return Response.json([{error:{code:429,status:'RESOURCE_EXHAUSTED'}}], {status:429});
      };
      `,
    );
    const retryArgs =
      script === 'generation'
        ? ['--max-generation-retries', '1']
        : ['--max-retries', '1'];
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
          ...retryArgs,
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
            GEMINI_API_KEY: 'test-key',
            LLM_STRUCTURED_OUTPUT: '',
            P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
            P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '0',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      assert.fail('Expected incomplete evaluation');
    } catch (error) {
      assert.equal(error.status, 1);
      stdout = error.stdout;
    }
    const summary = JSON.parse(stdout);
    if (script === 'generation') {
      assert.equal(summary.generationCalls, 1);
      assert.equal(summary.generationRetriesUsed, 0);
    } else {
      assert.equal(summary.calls, 1);
      assert.equal(summary.retriesUsed, 0);
    }
  });


test('generation live runner corrects one language-only drift without retrying factual semantics', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-language-correction-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'provider.mjs');
  const output = join(dir, 'report.json');
  writeFileSync(
    preload,
    `
    let calls = 0;
    const ok = (content) => Response.json({
      choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(content)}}],
      usage:{prompt_tokens:10,completion_tokens:5}
    });
    globalThis.fetch = async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      if (calls === 1) {
        return ok({
          language:'fr',
          sentences:[{
            text:'No confirmed date is available.',
            evidenceRefs:['case.confirmedEta']
          }]
        });
      }
      if (calls === 2) {
        return ok({
          language:'en',
          sentences:[{verdict:'supported',issues:[]}]
        });
      }
      if (calls === 3) {
        if (!body.messages[0].content.includes('previous candidate failed language validation'))
          throw new Error('Missing server-owned language correction directive');
        return ok({
          language:'fr',
          sentences:[{
            text:'Aucune date confirmée n’est disponible.',
            evidenceRefs:['case.confirmedEta']
          }]
        });
      }
      if (calls === 4) {
        return ok({
          language:'fr',
          sentences:[{verdict:'supported',issues:[]}]
        });
      }
      throw new Error('Unexpected extra call');
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
      '--max-language-corrections',
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
        GEMINI_API_KEY: 'test-key',
        LLM_STRUCTURED_OUTPUT: '',
        P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
        P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const summary = JSON.parse(stdout);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(summary.status, 'requires_human_review');
  assert.equal(summary.languageCorrectionsUsed, 1);
  assert.equal(summary.generationRetriesUsed, 0);
  assert.equal(summary.validationRetriesUsed, 0);
  assert.equal(summary.generationCalls, 2);
  assert.equal(summary.validationCalls, 2);
  assert.equal(report.operational.languageCorrectionsUsed, 1);
  assert.equal(report.results[0].languageCorrections, 1);
  assert.equal(report.results[0].draft.language, 'fr');
  assert.match(report.results[0].draft.sentences[0].text, /Aucune date confirmée/);
});

test('generation live runner never language-corrects an unsupported factual verdict', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-no-semantic-correction-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'provider.mjs');
  const output = join(dir, 'report.json');
  writeFileSync(
    preload,
    `
    let calls = 0;
    const ok = (content) => Response.json({
      choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(content)}}],
      usage:{prompt_tokens:10,completion_tokens:5}
    });
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1)
        return ok({
          language:'fr',
          sentences:[{
            text:'Le remboursement est garanti.',
            evidenceRefs:['case.refund']
          }]
        });
      if (calls === 2)
        return ok({
          language:'fr',
          sentences:[{verdict:'unsupported',issues:['amount']}]
        });
      throw new Error('Unexpected retry after semantic failure');
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
        'scripts/evaluate-generation.mjs',
        '--live',
        '--max-cases',
        '1',
        '--max-language-corrections',
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
          GEMINI_API_KEY: 'test-key',
          LLM_STRUCTURED_OUTPUT: '',
          P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
          P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.fail('Expected semantic failure to remain fail-closed');
  } catch (error) {
    assert.equal(error.status, 1);
    stdout = error.stdout;
  }
  const summary = JSON.parse(stdout);
  assert.equal(summary.status, 'incomplete');
  assert.equal(summary.languageCorrectionsUsed, 0);
  assert.equal(summary.generationCalls, 1);
  assert.equal(summary.validationCalls, 1);
});
