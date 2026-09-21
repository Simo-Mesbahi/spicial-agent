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
    assert.equal(summary.calls, 1);
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
