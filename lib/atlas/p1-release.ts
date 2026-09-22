import type { AtlasEnv } from './api';
import { redacted } from './domain';
import { digest, embeddingSettings } from './embedding-runtime';
import {
  assertValidationEvidence,
  type ValidationDiagnostics,
} from './factual-validation';
import type { EvidenceContext, EvidencePack } from './evidence-pack';
import {
  generationEvidence,
  type GenerationDiagnostics,
  type NaturalDraft,
} from './natural-generation';
import { safeConversationalDraft, type ConversationPlan } from './structured-conversation';

export type ReleaseSettings = {
  P1_RELEASE_MODE?: string;
  P1_CANARY_PERCENT?: string;
  P1_CANARY_SALT?: string;
  LLM_GENERATION_MODE?: string;
  LLM_VALIDATION_MODE?: string;
  LLM_ORCHESTRATOR?: string;
  RAG_MODE?: string;
  EMBEDDING_PROVIDER?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_BASE_URL?: string;
  EMBEDDING_API_KEY?: string;
  EMBEDDING_REVISION?: string;
  EMBEDDING_SEND_DIMENSIONS?: string;
  LLM_BUDGET_MODE?: string;
};

export type P1ReleaseMode = 'off' | 'shadow' | 'canary' | 'on';

export type ReleaseReason =
  | 'disabled'
  | 'shadow_only'
  | 'not_in_canary'
  | 'ineligible_plan'
  | 'configuration'
  | 'generation_failed'
  | 'validation_failed'
  | 'evidence_changed'
  | 'knowledge_unavailable'
  | 'hybrid_unavailable'
  | 'grounding_failure'
  | 'invalid_candidate';

export type ReleaseDiagnostics = {
  mode: P1ReleaseMode;
  cohort: boolean;
  cohortBucket: number | null;
  canaryPercent: number;
  attempted: boolean;
  released: boolean;
  reason: ReleaseReason | null;
  plan: ConversationPlan['kind'] | null;
  evidenceCaseVersion: number | null;
  knowledgeSourceCount: number;
};

export type ReleaseCohort = {
  mode: P1ReleaseMode;
  selected: boolean;
  bucket: number | null;
  percent: number;
  configurationValid: boolean;
};

const releasablePlans = new Set<ConversationPlan['kind']>([
  'case',
  'knowledge',
  'case_and_knowledge',
]);

function parseMode(
  value: string | undefined,
  generationMode?: string,
  validationMode?: string,
): P1ReleaseMode {
  const explicit = value?.trim();
  const normalized =
    explicit ||
    (generationMode === 'shadow' || validationMode === 'shadow'
      ? 'shadow'
      : 'off');
  if (!['off', 'shadow', 'canary', 'on'].includes(normalized))
    throw new Error('invalid_p1_release_mode');
  return normalized as P1ReleaseMode;
}

function parsePercent(value: string | undefined) {
  const raw = value?.trim() || '0';
  const percent = Number(raw);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100)
    throw new Error('invalid_p1_canary_percent');
  return percent;
}

export type ReleaseConfigurationState = {
  mode: P1ReleaseMode;
  valid: boolean;
  releaseReady: boolean;
  canaryPercent: number;
  canarySaltConfigured: boolean;
  embeddingConfigured: boolean;
  issues: string[];
};

export function releaseConfigurationState(
  env: ReleaseSettings,
): ReleaseConfigurationState {
  const issues: string[] = [];
  let mode: P1ReleaseMode = 'off';
  try {
    mode = parseMode(
      env.P1_RELEASE_MODE,
      env.LLM_GENERATION_MODE,
      env.LLM_VALIDATION_MODE,
    );
  } catch {
    issues.push('invalid_release_mode');
  }

  let canaryPercent = 0;
  if (mode === 'canary') {
    try {
      canaryPercent = parsePercent(env.P1_CANARY_PERCENT);
    } catch {
      issues.push('invalid_canary_percent');
    }
  } else if (mode === 'on') {
    canaryPercent = 100;
  }

  const canarySaltConfigured = (env.P1_CANARY_SALT?.trim().length ?? 0) >= 16;
  let embeddingConfigured = false;
  try {
    embeddingSettings(env);
    embeddingConfigured = true;
  } catch {
    embeddingConfigured = false;
  }

  if (mode === 'canary') {
    if (canaryPercent < 1) issues.push('canary_percent_must_be_positive');
    if (!canarySaltConfigured) issues.push('canary_salt_missing');
  }

  if (mode === 'canary' || mode === 'on') {
    if (env.LLM_ORCHESTRATOR !== 'structured')
      issues.push('structured_orchestrator_required');
    if (env.RAG_MODE !== 'hybrid') issues.push('hybrid_rag_required');
    if (!embeddingConfigured) issues.push('embedding_configuration_required');
    if (env.LLM_GENERATION_MODE !== 'release')
      issues.push('generation_release_mode_required');
    if (env.LLM_VALIDATION_MODE !== 'release')
      issues.push('validation_release_mode_required');
  }

  return {
    mode,
    valid: issues.length === 0,
    releaseReady:
      issues.length === 0 && (mode === 'canary' || mode === 'on'),
    canaryPercent,
    canarySaltConfigured,
    embeddingConfigured,
    issues,
  };
}

function stableBucket(hexDigest: string) {
  const value = Number.parseInt(hexDigest.slice(0, 8), 16);
  return Math.min(99, Math.floor((value / 0x1_0000_0000) * 100));
}

export async function releaseCohort(
  env: ReleaseSettings,
  input: {
    organizationId: string;
    authorizedCaseId: string;
    sessionId: string;
  },
): Promise<ReleaseCohort> {
  const state = releaseConfigurationState(env);
  const mode = state.mode;
  const percent = state.canaryPercent;

  if (!state.valid)
    return {
      mode,
      selected: false,
      bucket: null,
      percent,
      configurationValid: false,
    };

  if (mode === 'off' || mode === 'shadow')
    return {
      mode,
      selected: false,
      bucket: null,
      percent,
      configurationValid: true,
    };

  if (!state.releaseReady)
    return {
      mode,
      selected: false,
      bucket: null,
      percent,
      configurationValid: false,
    };

  if (mode === 'on')
    return {
      mode,
      selected: true,
      bucket: null,
      percent: 100,
      configurationValid: true,
    };

  const salt = env.P1_CANARY_SALT!.trim();
  const bucket = stableBucket(
    await digest(
      [
        salt,
        input.organizationId,
        input.authorizedCaseId,
        input.sessionId,
      ].join('|'),
    ),
  );
  return {
    mode,
    selected: bucket < percent,
    bucket,
    percent,
    configurationValid: true,
  };
}

export function shouldEvaluateNaturalResponse(
  env: AtlasEnv,
  plan: ConversationPlan['kind'],
  cohort: ReleaseCohort,
) {
  if (!releasablePlans.has(plan)) return false;
  if (cohort.mode === 'shadow')
    return env.LLM_GENERATION_MODE === 'shadow';
  if (cohort.mode === 'canary' || cohort.mode === 'on')
    return (
      cohort.configurationValid &&
      cohort.selected &&
      env.LLM_GENERATION_MODE === 'release' &&
      env.LLM_VALIDATION_MODE === 'release'
    );
  return false;
}

function candidateText(draft: NaturalDraft, allowEmoji: boolean) {
  const text = draft.sentences.map((sentence) => sentence.text.trim()).join(' ').trim();
  if (
    !text ||
    text.length > 2200 ||
    redacted(text) !== text ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text) ||
    /https?:\/\/|www\.|<\/?[a-z][^>]*>|\[[^\]]+\]\([^\)]+\)/iu.test(text) ||
    (!allowEmoji && /[\p{Extended_Pictographic}\uFE0F\u200D]/u.test(text))
  )
    return null;
  return text;
}

function planEvidenceCompatible(plan: ConversationPlan['kind'], pack: EvidencePack) {
  if (plan === 'case') return Boolean(pack.caseFacts);
  if (plan === 'knowledge') return pack.knowledge.sources.length > 0;
  if (plan === 'case_and_knowledge')
    return Boolean(pack.caseFacts) && pack.knowledge.sources.length > 0;
  return false;
}

export async function releaseNaturalResponse(
  env: AtlasEnv,
  input: {
    cohort: ReleaseCohort;
    plan: ConversationPlan['kind'];
    draft: NaturalDraft | null;
    generation: GenerationDiagnostics | null;
    validation: ValidationDiagnostics | null;
    generatedPack: EvidencePack;
    currentPack: EvidencePack;
    context: EvidenceContext;
    groundingFailure: boolean;
    freshnessFailure?: 'knowledge_changed' | 'knowledge_unavailable' | null;
    hybridEvidenceReady?: boolean;
    allowEmoji: boolean;
  },
): Promise<{ content: string | null; diagnostics: ReleaseDiagnostics }> {
  const diagnostics: ReleaseDiagnostics = {
    mode: input.cohort.mode,
    cohort: input.cohort.selected,
    cohortBucket: input.cohort.bucket,
    canaryPercent: input.cohort.percent,
    attempted: Boolean(input.draft || input.generation?.calls || input.validation?.calls),
    released: false,
    reason: null,
    plan: input.plan,
    evidenceCaseVersion: input.generatedPack.caseFacts?.version ?? null,
    knowledgeSourceCount: input.generatedPack.knowledge.sources.length,
  };

  if (!input.cohort.configurationValid) {
    diagnostics.reason = 'configuration';
    return { content: null, diagnostics };
  }
  if (input.cohort.mode === 'off') {
    diagnostics.reason = 'disabled';
    return { content: null, diagnostics };
  }
  if (input.cohort.mode === 'shadow') {
    diagnostics.reason = 'shadow_only';
    return { content: null, diagnostics };
  }
  if (!input.cohort.selected) {
    diagnostics.reason = 'not_in_canary';
    return { content: null, diagnostics };
  }
  if (!releasablePlans.has(input.plan)) {
    diagnostics.reason = 'ineligible_plan';
    return { content: null, diagnostics };
  }
  if (input.freshnessFailure) {
    diagnostics.reason =
      input.freshnessFailure === 'knowledge_unavailable'
        ? 'knowledge_unavailable'
        : 'evidence_changed';
    return { content: null, diagnostics };
  }
  if (
    (input.plan === 'knowledge' || input.plan === 'case_and_knowledge') &&
    input.hybridEvidenceReady !== true
  ) {
    diagnostics.reason = 'hybrid_unavailable';
    return { content: null, diagnostics };
  }
  if (input.groundingFailure) {
    diagnostics.reason = 'grounding_failure';
    return { content: null, diagnostics };
  }
  if (
    !input.draft ||
    input.generation?.mode !== 'release' ||
    input.generation.outcome !== 'candidate_generated' ||
    input.generation.reason !== null
  ) {
    diagnostics.reason = 'generation_failed';
    return { content: null, diagnostics };
  }
  if (
    input.validation?.mode !== 'release' ||
    input.validation.outcome !== 'supported_candidate' ||
    input.validation.reason !== null ||
    input.validation.issues.length
  ) {
    diagnostics.reason = 'validation_failed';
    return { content: null, diagnostics };
  }

  try {
    await assertValidationEvidence(
      input.generatedPack,
      input.currentPack,
      input.context,
    );
  } catch {
    diagnostics.reason = 'evidence_changed';
    return { content: null, diagnostics };
  }

  if (
    !planEvidenceCompatible(input.plan, input.currentPack) ||
    input.currentPack.completedActions.length ||
    input.draft.language !== input.currentPack.responseLanguage
  ) {
    diagnostics.reason = 'invalid_candidate';
    return { content: null, diagnostics };
  }

  const refs = generationEvidence(input.currentPack).references;
  if (
    !input.draft.sentences.some((sentence) => sentence.evidenceRefs.length) ||
    input.draft.sentences.some(
      (sentence) =>
        new Set(sentence.evidenceRefs).size !== sentence.evidenceRefs.length ||
        sentence.evidenceRefs.some((ref) => !Object.hasOwn(refs, ref)) ||
        (!sentence.evidenceRefs.length && !safeConversationalDraft(sentence.text)),
    )
  ) {
    diagnostics.reason = 'invalid_candidate';
    return { content: null, diagnostics };
  }

  const content = candidateText(input.draft, input.allowEmoji);
  if (!content) {
    diagnostics.reason = 'invalid_candidate';
    return { content: null, diagnostics };
  }

  diagnostics.released = true;
  diagnostics.reason = null;
  return { content, diagnostics };
}
