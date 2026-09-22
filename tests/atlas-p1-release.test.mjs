import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

import { generationFixture, generationScenarios } from '../evals/generation.mjs';

const compiled = await build({
  stdin: {
    contents:
      "export {releaseCohort,releaseNaturalResponse,shouldEvaluateNaturalResponse,releaseConfigurationState} from './lib/atlas/p1-release';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const {
  releaseCohort,
  releaseNaturalResponse,
  shouldEvaluateNaturalResponse,
  releaseConfigurationState,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(compiled.outputFiles[0].text).toString('base64')
);

function diagnostics() {
  return {
    generation: {
      mode: 'release',
      outcome: 'candidate_generated',
      reason: null,
      evidenceCaseVersion: 1,
      released: false,
      validation: 'structure_only',
      calls: 1,
      latencyMs: 120,
      inputTokens: 80,
      outputTokens: 24,
    },
    validation: {
      mode: 'release',
      outcome: 'supported_candidate',
      reason: null,
      issues: [],
      sentenceCount: 1,
      calls: 1,
      latencyMs: 90,
      inputTokens: 90,
      outputTokens: 20,
      released: false,
      assurance: 'model_assisted_not_proof',
    },
  };
}

test('legacy shadow configuration remains shadow-only without a new release flag', async () => {
  const cohort = await releaseCohort(
    { LLM_GENERATION_MODE: 'shadow', LLM_VALIDATION_MODE: 'shadow' },
    {
      organizationId: '00000000-0000-4000-8000-000000000001',
      authorizedCaseId: '00000000-0000-4000-8000-000000000002',
      sessionId: 'session-a',
    },
  );
  assert.equal(cohort.mode, 'shadow');
  assert.equal(cohort.selected, false);
  assert.equal(
    shouldEvaluateNaturalResponse(
      {
        LLM_GENERATION_MODE: 'shadow',
        LLM_VALIDATION_MODE: 'shadow',
      },
      'case',
      cohort,
    ),
    true,
  );
});

test('canary cohort assignment is stable, secret-salted and bounded', async () => {
  const env = {
    P1_RELEASE_MODE: 'canary',
    P1_CANARY_PERCENT: '17',
    P1_CANARY_SALT: 'server-only-canary-salt-2026',
    LLM_ORCHESTRATOR: 'structured',
    RAG_MODE: 'hybrid',
    LLM_GENERATION_MODE: 'release',
    LLM_VALIDATION_MODE: 'release',
    LLM_BUDGET_MODE: 'approved',
    EMBEDDING_PROVIDER: 'gemini',
    EMBEDDING_MODEL: 'gemini-embedding-001',
    EMBEDDING_API_KEY: 'test-embedding-key',
  };
  const input = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    authorizedCaseId: '00000000-0000-4000-8000-000000000002',
    sessionId: 'stable-session',
  };
  const first = await releaseCohort(env, input);
  const second = await releaseCohort(env, input);
  assert.deepEqual(second, first);

  const reauthenticated = await releaseCohort(env, {
    ...input,
    sessionId: 'different-session-after-reauthentication',
  });
  assert.equal(reauthenticated.bucket, first.bucket);
  assert.equal(reauthenticated.selected, first.selected);

  assert.equal(first.configurationValid, true);
  assert.ok(first.bucket >= 0 && first.bucket <= 99);
  assert.equal(first.selected, first.bucket < 17);

  const invalid = await releaseCohort(
    {
      P1_RELEASE_MODE: 'canary',
      P1_CANARY_PERCENT: '10',
      P1_CANARY_SALT: 'short',
      LLM_ORCHESTRATOR: 'structured',
      RAG_MODE: 'hybrid',
      LLM_GENERATION_MODE: 'release',
      LLM_VALIDATION_MODE: 'release',
      LLM_BUDGET_MODE: 'approved',
      EMBEDDING_PROVIDER: 'gemini',
      EMBEDDING_MODEL: 'gemini-embedding-001',
      EMBEDDING_API_KEY: 'test-embedding-key',
    },
    input,
  );
  assert.equal(invalid.configurationValid, false);
  assert.equal(invalid.selected, false);
});

test('release gate emits a supported case draft only after every gate is green', async () => {
  const fixture = generationFixture(generationScenarios[0]);
  const { generation, validation } = diagnostics();
  const draft = {
    language: 'fr',
    sentences: [
      {
        text: 'Votre dossier est actuellement en attente de pièce.',
        evidenceRefs: ['case.status'],
      },
    ],
  };
  const result = await releaseNaturalResponse(
    {},
    {
      cohort: {
        mode: 'on',
        selected: true,
        bucket: null,
        percent: 100,
        configurationValid: true,
      },
      plan: 'case',
      draft,
      generation,
      validation,
      generatedPack: fixture.pack,
      currentPack: structuredClone(fixture.pack),
      context: fixture.context,
      groundingFailure: false,
      freshnessFailure: null,
      allowEmoji: false,
    },
  );
  assert.equal(result.diagnostics.released, true);
  assert.equal(result.diagnostics.reason, null);
  assert.equal(result.content, draft.sentences[0].text);
});

test('release gate blocks shadow, stale evidence and unsafe candidate formatting', async () => {
  const fixture = generationFixture(generationScenarios[0]);
  const { generation, validation } = diagnostics();
  const draft = {
    language: 'fr',
    sentences: [
      {
        text: 'Votre dossier est actuellement en attente de pièce.',
        evidenceRefs: ['case.status'],
      },
    ],
  };

  const shadow = await releaseNaturalResponse(
    {},
    {
      cohort: {
        mode: 'shadow',
        selected: false,
        bucket: null,
        percent: 0,
        configurationValid: true,
      },
      plan: 'case',
      draft,
      generation: { ...generation, mode: 'shadow' },
      validation: { ...validation, mode: 'shadow' },
      generatedPack: fixture.pack,
      currentPack: structuredClone(fixture.pack),
      context: fixture.context,
      groundingFailure: false,
      freshnessFailure: null,
      allowEmoji: false,
    },
  );
  assert.equal(shadow.content, null);
  assert.equal(shadow.diagnostics.reason, 'shadow_only');

  const changed = structuredClone(fixture.pack);
  changed.caseFacts.version = 2;
  const stale = await releaseNaturalResponse(
    {},
    {
      cohort: {
        mode: 'on',
        selected: true,
        bucket: null,
        percent: 100,
        configurationValid: true,
      },
      plan: 'case',
      draft,
      generation,
      validation,
      generatedPack: fixture.pack,
      currentPack: changed,
      context: fixture.context,
      groundingFailure: false,
      freshnessFailure: null,
      allowEmoji: false,
    },
  );
  assert.equal(stale.content, null);
  assert.equal(stale.diagnostics.reason, 'evidence_changed');

  const unsafe = await releaseNaturalResponse(
    {},
    {
      cohort: {
        mode: 'on',
        selected: true,
        bucket: null,
        percent: 100,
        configurationValid: true,
      },
      plan: 'case',
      draft: {
        ...draft,
        sentences: [
          {
            text: 'Consultez https://evil.example pour votre dossier.',
            evidenceRefs: ['case.status'],
          },
        ],
      },
      generation,
      validation,
      generatedPack: fixture.pack,
      currentPack: structuredClone(fixture.pack),
      context: fixture.context,
      groundingFailure: false,
      freshnessFailure: null,
      allowEmoji: false,
    },
  );
  assert.equal(unsafe.content, null);
  assert.equal(unsafe.diagnostics.reason, 'invalid_candidate');
});

test('release gate blocks documentary freshness failures before customer release', async () => {
  const fixture = generationFixture(generationScenarios.find((row) => row.kind === 'knowledge'));
  const { generation, validation } = diagnostics();
  const result = await releaseNaturalResponse(
    {},
    {
      cohort: {
        mode: 'on',
        selected: true,
        bucket: null,
        percent: 100,
        configurationValid: true,
      },
      plan: 'knowledge',
      draft: {
        language: fixture.pack.responseLanguage,
        sentences: [
          {
            text: 'La demande fait l’objet d’un examen.',
            evidenceRefs: ['knowledge.0'],
          },
        ],
      },
      generation: { ...generation, evidenceCaseVersion: null },
      validation,
      generatedPack: fixture.pack,
      currentPack: structuredClone(fixture.pack),
      context: fixture.context,
      groundingFailure: false,
      freshnessFailure: 'knowledge_changed',
      allowEmoji: false,
    },
  );
  assert.equal(result.content, null);
  assert.equal(result.diagnostics.reason, 'evidence_changed');
});


test('documentary release requires a successful hybrid evidence path even when evidence is fresh', async () => {
  const fixture = generationFixture(generationScenarios.find((row) => row.kind === 'knowledge'));
  const { generation, validation } = diagnostics();
  const result = await releaseNaturalResponse(
    {},
    {
      cohort: {
        mode: 'on',
        selected: true,
        bucket: null,
        percent: 100,
        configurationValid: true,
      },
      plan: 'knowledge',
      draft: {
        language: fixture.pack.responseLanguage,
        sentences: [
          {
            text: 'La demande fait l’objet d’un examen.',
            evidenceRefs: ['knowledge.0'],
          },
        ],
      },
      generation: { ...generation, evidenceCaseVersion: null },
      validation,
      generatedPack: fixture.pack,
      currentPack: structuredClone(fixture.pack),
      context: fixture.context,
      groundingFailure: false,
      freshnessFailure: null,
      hybridEvidenceReady: false,
      allowEmoji: false,
    },
  );
  assert.equal(result.content, null);
  assert.equal(result.diagnostics.reason, 'hybrid_unavailable');
});

test('release readiness fails closed unless structured, hybrid, generation and validation are all armed', () => {
  const base = {
    P1_RELEASE_MODE: 'on',
    LLM_ORCHESTRATOR: 'structured',
    RAG_MODE: 'hybrid',
    LLM_GENERATION_MODE: 'release',
    LLM_VALIDATION_MODE: 'release',
    LLM_BUDGET_MODE: 'approved',
    EMBEDDING_PROVIDER: 'gemini',
    EMBEDDING_MODEL: 'gemini-embedding-001',
    EMBEDDING_API_KEY: 'test-embedding-key',
  };
  assert.equal(releaseConfigurationState(base).releaseReady, true);

  for (const [key, value] of [
    ['LLM_ORCHESTRATOR', 'legacy'],
    ['RAG_MODE', 'lexical'],
    ['LLM_GENERATION_MODE', 'shadow'],
    ['LLM_VALIDATION_MODE', 'shadow'],
    ['EMBEDDING_API_KEY', ''],
  ]) {
    const state = releaseConfigurationState({ ...base, [key]: value });
    assert.equal(state.releaseReady, false, key);
    assert.ok(state.issues.length > 0, key);
  }
});
