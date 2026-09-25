import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('retrieval live runner recovers one embedding 429 without backend spend on failed attempt', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-retrieval-embedding-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'provider.mjs');
  const output = join(dir, 'report.json');
  writeFileSync(
    preload,
    `
    let embeddingCalls = 0;
    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.includes(':batchEmbedContents')) {
        embeddingCalls++;
        if (embeddingCalls === 1)
          return Response.json({error:{code:429,status:'RESOURCE_EXHAUSTED'}}, {status:429});
        return Response.json({
          embeddings: [{ values: [1, ...Array(767).fill(0)] }],
          usageMetadata: { promptTokenCount: 8 },
        });
      }
      if (target.includes('/rest/v1/rpc/knowledge_hybrid_candidates'))
        return Response.json([]);
      throw new Error('Unexpected request: ' + target);
    };
    `,
  );

  const stdout = execFileSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      'scripts/evaluate-retrieval.mjs',
      '--live',
      '--max-queries',
      '1',
      '--max-transient-retries',
      '0',
      '--max-embedding-retries',
      '1',
      '--output',
      output,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
        SUPABASE_SECRET_KEY: 'test-secret',
        SUPABASE_ORGANIZATION_ID: '00000000-0000-4000-8000-000000000001',
        LLM_BUDGET_MODE: 'free',
        EMBEDDING_PROVIDER: 'gemini',
        EMBEDDING_MODEL: 'gemini-embedding-2',
        EMBEDDING_API_KEY: 'test-key',
        EMBEDDING_REVISION: '1',
        RAG_CORPUS_LOCALE: 'fr-FR',
        RAG_MARKET: 'GLOBAL',
        RAG_MIN_SIMILARITY: '0.7',
        RAG_MIN_LEXICAL_SCORE: '3',
        RAG_RPC_TIMEOUT_MS: '5000',
        RAG_RPC_MAX_RETRIES: '1',
        RAG_RPC_RETRY_BACKOFF_MS: '0',
        P1_LIVE_EMBEDDING_MIN_INTERVAL_MS: '0',
        P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const summary = JSON.parse(stdout);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(summary.status, 'completed');
  assert.equal(summary.embeddingRetriesUsed, 1);
  assert.equal(summary.embeddingProviderCalls, 2);
  assert.equal(report.operational.embeddingRetriesUsed, 1);
  assert.equal(report.operational.embeddingProviderCalls, 2);
  assert.equal(report.results[0].hybrid.embeddingRetries, 1);
  assert.equal(report.results[0].hybrid.providerAttempts.length, 2);
  assert.equal(
    report.results[0].hybrid.providerAttempts[0].embeddingError,
    'upstream_rate_limited',
  );
  assert.equal(report.results[0].hybrid.providerAttempts[0].backendCalls, 0);
  assert.equal(report.results[0].hybrid.providerAttempts[1].embeddingError, null);
  assert.equal(report.results[0].hybrid.providerAttempts[1].backendCalls, 1);
  assert.equal(report.results[0].hybrid.retrieval.embedding.error, null);
});

test('structured live runner exposes semantic mismatches directly in report diagnostics', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-structured-semantic-failure-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'provider.mjs');
  const output = join(dir, 'report.json');
  writeFileSync(
    preload,
    `
    globalThis.fetch = async () =>
      Response.json({
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: JSON.stringify({
              language: 'fr',
              preferredResponseLanguage: null,
              intent: 'casual',
              subIntent: 'general',
              topic: null,
              guidance: 'none',
              guidancePreference: 'keep',
              reference: 'none',
              selectedCaseId: null,
              referencedProduct: null,
              referencesPreviousTurn: false,
              conversationRepair: false,
              requiresCase: false,
              requiresKnowledge: false,
              requiresClarification: false,
              requiresHuman: false,
              confidence: 0.95,
              style: { length: 'keep', emoji: 'keep' },
              retrievalQuery: null,
              response: 'Bonjour.',
            }),
          },
        }],
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });
    `,
  );

  let stdout;
  try {
    execFileSync(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        'scripts/evaluate-structured-ai.mjs',
        '--live',
        '--mode',
        'structured',
        '--max-turns',
        '5',
        '--languages',
        'fr',
        '--families',
        'handoff-toggle',
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
          LLM_DAILY_LIMIT: '100',
          GEMINI_MODEL: 'gemini-2.5-flash',
          GEMINI_API_KEY: 'test-key',
          LLM_STRUCTURED_OUTPUT: '',
          LLM_REQUEST_TIMEOUT_MS: '20000',
          P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
          P1_STRUCTURED_MAX_SCENARIO_RETRIES: '0',
          P1_STRUCTURED_RETRY_BACKOFF_MS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.fail('Expected semantic qualification failure');
  } catch (error) {
    assert.equal(error.status, 1);
    stdout = error.stdout;
  }

  const summary = JSON.parse(stdout);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.ok(Array.isArray(summary.semanticFailures));
  assert.ok(summary.semanticFailures.length > 0);
  assert.deepEqual(summary.semanticFailures, report.semanticFailures);
  assert.ok(summary.semanticFailures.some((row) => row.id === 'pre-p1-handoff-toggle-fr/1'));
  assert.ok(
    summary.semanticFailures.some(
      (row) => row.failedChecks.includes('intent') && row.failedChecks.includes('guidance'),
    ),
  );
  assert.doesNotMatch(JSON.stringify(summary.semanticFailures), /test-key/);
});

test('structured live runner retries one 429 then stops after persistent rate limit', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-structured-rate-limit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'provider.mjs');
  const output = join(dir, 'report.json');
  writeFileSync(
    preload,
    `
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json([{error:{code:429,status:'RESOURCE_EXHAUSTED'}}], {status:429});
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
        'scripts/evaluate-structured-ai.mjs',
        '--live',
        '--mode',
        'structured',
        '--max-turns',
        '5',
        '--languages',
        'fr',
        '--families',
        'correction-understanding',
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
          LLM_DAILY_LIMIT: '100',
          GEMINI_MODEL: 'gemini-2.5-flash',
          GEMINI_API_KEY: 'test-key',
          LLM_STRUCTURED_OUTPUT: '',
          LLM_REQUEST_TIMEOUT_MS: '20000',
          P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
          P1_STRUCTURED_MAX_SCENARIO_RETRIES: '1',
          P1_STRUCTURED_RETRY_BACKOFF_MS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.fail('Expected persistent structured rate limit to fail closed');
  } catch (error) {
    assert.equal(error.status, 1);
    stdout = error.stdout;
  }
  const summary = JSON.parse(stdout);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(summary.operational.providerCalls, 2);
  assert.equal(summary.operational.finalProviderCalls, 1);
  assert.equal(summary.operational.discardedProviderCalls, 1);
  assert.equal(summary.operational.retriedScenarios, 1);
  assert.equal(summary.operational.systemicTransportFailure, 'provider_rate_limited');
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].fallbackReason, 'upstream_rate_limited');
});

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
  test(`${script} live retry refreshes synthetic evidence after transport delay beyond the 30s TTL`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-expired-retry-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const preload = join(dir, 'provider.mjs');
    const output = join(dir, 'report.json');
    writeFileSync(
      preload,
      `
      let calls = 0;
      let now = 1_800_000_000_000;
      Date.now = () => now;
      globalThis.fetch = async () => {
        calls++;
        if (calls === 1) {
          now += 31_000;
          return Response.json([{error:{code:503,status:'UNAVAILABLE'}}], {status:503});
        }
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
      assert.fail('Expected final request rejection');
    } catch (error) {
      assert.equal(error.status, 1);
      stdout = error.stdout;
    }
    const summary = JSON.parse(stdout);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    if (script === 'generation') {
      assert.equal(summary.generationCalls, 2);
      assert.equal(summary.generationRetriesUsed, 1);
      assert.equal(report.results[0].providerAttempts.length, 2);
      assert.notEqual(report.results[0].diagnostics.reason, 'evidence_expired');
    } else {
      assert.equal(summary.calls, 2);
      assert.equal(summary.retriesUsed, 1);
      assert.equal(report.results[0].providerAttempts.length, 2);
      assert.notEqual(report.results[0].diagnostics.reason, 'evidence_expired');
    }
  });


for (const script of ['generation', 'grounding'])
  test(`${script} live runner retries one HTTP 429 within budget then fails closed`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-rate-limit-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const preload = join(dir, 'provider.mjs');
    const output = join(dir, 'report.json');
    writeFileSync(
      preload,
      `
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
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
      assert.fail('Expected persistent rate limit to remain fail-closed');
    } catch (error) {
      assert.equal(error.status, 1);
      stdout = error.stdout;
    }
    const summary = JSON.parse(stdout);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(summary.status, 'incomplete');
    assert.equal(summary.systemicTransportFailure, 'provider_rate_limited');
    if (script === 'generation') {
      assert.equal(summary.generationCalls, 2);
      assert.equal(summary.generationRetriesUsed, 1);
      assert.equal(report.operational.generationRetriesUsed, 1);
      assert.equal(report.operational.systemicTransportFailure, 'provider_rate_limited');
    } else {
      assert.equal(summary.calls, 2);
      assert.equal(summary.retriesUsed, 1);
      assert.equal(report.operational.retriesUsed, 1);
      assert.equal(report.systemicTransportFailure, 'provider_rate_limited');
    }
  });


test('generation live runner repairs one local structure drift within a dedicated bounded budget', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-structure-correction-'));
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
      if (calls === 1)
        return ok({
          language:'fr',
          sentences:[{text:'Votre dossier attend une pièce.',evidenceRefs:['case.statusLabel']}],
          action:'refund'
        });
      if (calls === 2) {
        if (!body.messages[0].content.includes('failed local output-structure or output-policy validation'))
          throw new Error('Missing structure correction directive');
        return ok({
          language:'fr',
          sentences:[
            {text:'Votre dossier attend une pièce.',evidenceRefs:['case.statusLabel']},
            {text:'Aucune date confirmée n’est disponible.',evidenceRefs:['case.confirmedEta']}
          ]
        });
      }
      if (calls === 3)
        return ok({language:'fr',sentences:[{verdict:'supported',issues:[]},{verdict:'supported',issues:[]}]});
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
      '--max-structure-corrections',
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
        GEMINI_MODEL: 'gemini-3.5-flash-lite',
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
  assert.equal(summary.structureCorrectionsUsed, 1);
  assert.equal(summary.generationRetriesUsed, 0);
  assert.equal(summary.languageCorrectionsUsed, 0);
  assert.equal(summary.citationCorrectionsUsed, 0);
  assert.equal(summary.generationCalls, 2);
  assert.equal(summary.validationCalls, 1);
  assert.equal(report.operational.structureCorrectionsUsed, 1);
  assert.equal(report.results[0].structureCorrections, 1);
  assert.deepEqual(report.results[0].structureFailures, [
    { code: 'schema_mismatch', sentenceIndex: null },
  ]);
  assert.equal(report.results[0].diagnostics.reason, null);
  assert.equal(report.results[0].diagnostics.structureFailure, null);
  assert.equal(report.results[0].groundedness, true);
});

test('generation live runner never structure-repairs provider transport/outer-envelope failures', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-no-structure-provider-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'provider.mjs');
  const output = join(dir, 'report.json');
  writeFileSync(
    preload,
    `
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls > 1) throw new Error('Structure correction must not retry provider envelope failures');
      return Response.json({
        choices:[{finish_reason:'stop',message:{role:'assistant',content:null}}],
        usage:{prompt_tokens:10,completion_tokens:5}
      });
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
        '--max-structure-corrections',
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
          GEMINI_MODEL: 'gemini-3.5-flash-lite',
          GEMINI_API_KEY: 'test-key',
          LLM_STRUCTURED_OUTPUT: '',
          P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
          P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.fail('Expected provider envelope failure to remain fail-closed');
  } catch (error) {
    assert.equal(error.status, 1);
    stdout = error.stdout;
  }

  const summary = JSON.parse(stdout);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(summary.status, 'incomplete');
  assert.equal(summary.structureCorrectionsUsed, 0);
  assert.equal(summary.generationCalls, 1);
  assert.equal(report.results[0].structureCorrections, 0);
  assert.deepEqual(report.results[0].structureFailures, []);
  assert.equal(report.results[0].diagnostics.structureFailure, null);
});

test('generation live runner repairs one citation-only drift within a dedicated bounded budget', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-citation-correction-'));
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
      if (calls === 1)
        return ok({language:'fr',sentences:[{text:'Votre dossier attend une pièce.',evidenceRefs:['case.status']}]});
      if (calls === 2) {
        if (!body.messages[0].content.includes('failed evidence-reference validation'))
          throw new Error('Missing citation correction directive');
        return ok({language:'fr',sentences:[{text:'Votre dossier attend une pièce.',evidenceRefs:['case.statusLabel']},{text:'Aucune date confirmée n’est disponible.',evidenceRefs:['case.confirmedEta']}]});
      }
      if (calls === 3)
        return ok({language:'fr',sentences:[{verdict:'supported',issues:[]},{verdict:'supported',issues:[]}]});
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
      '--max-citation-corrections',
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
        GEMINI_MODEL: 'gemini-3.5-flash-lite',
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
  assert.equal(summary.citationCorrectionsUsed, 1);
  assert.equal(summary.generationRetriesUsed, 0);
  assert.equal(summary.languageCorrectionsUsed, 0);
  assert.equal(summary.generationCalls, 2);
  assert.equal(summary.validationCalls, 1);
  assert.equal(report.operational.citationCorrectionsUsed, 1);
  assert.equal(report.results[0].citationCorrections, 1);
  assert.deepEqual(report.results[0].citationFailures, [
    { code: 'unknown_evidence_reference', sentenceIndex: 0, referenceCount: 1 },
  ]);
  assert.equal(report.results[0].diagnostics.reason, null);
  assert.equal(report.results[0].groundedness, true);
});

test('generation live runner never citation-repairs factual validation failures', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-eval-no-citation-factual-retry-'));
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
        return ok({language:'fr',sentences:[{text:'Votre dossier attend une pièce.',evidenceRefs:['case.statusLabel']}]});
      if (calls === 2)
        return ok({language:'fr',sentences:[{verdict:'unsupported',issues:['status']}]});
      throw new Error('Citation correction must not run after factual rejection');
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
        '--max-citation-corrections',
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
          GEMINI_MODEL: 'gemini-3.5-flash-lite',
          GEMINI_API_KEY: 'test-key',
          LLM_STRUCTURED_OUTPUT: '',
          P1_LIVE_COMPLETION_MIN_INTERVAL_MS: '0',
          P1_LIVE_TRANSIENT_RETRY_BACKOFF_MS: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.fail('Expected factual rejection to fail qualification');
  } catch (error) {
    assert.equal(error.status, 1);
    stdout = error.stdout;
  }
  const summary = JSON.parse(stdout);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(summary.citationCorrectionsUsed, 0);
  assert.equal(summary.generationCalls, 1);
  assert.equal(summary.validationCalls, 1);
  assert.equal(report.results[0].citationCorrections, 0);
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
