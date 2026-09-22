import type { AtlasEnv } from './api';
import { redacted } from './domain';
import { digest } from './embedding-runtime';
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
import type { ConversationPlan } from './structured-conversation';

export type ReleaseSettings = {
  P1_RELEASE_MODE?: string;
  P1_CANARY_PERCENT?: string;
  P1_CANARY_SALT?: string;
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

function parseMode(value: string | undefined): P1ReleaseMode {
  const normalized = value?.trim() || 'off';
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
  let mode: P1ReleaseMode;
  let percent: number;
  try {
    mode = parseMode(env.P1_RELEASE_MODE);
    percent = parsePercent(env.P1_CANARY_PERCENT);
  } catch {
    return {
      mode: 'off',
      selected: false,
      bucket: null,
      percent: 0,
      configurationValid: false,
    };
  }

  if (mode === 'off')
    return {
      mode,
      selected: false,
      bucket: null,
      percent,
      configurationValid: true,
    };

  if (mode === 'shadow')
    return {
      mode,
      selected: false,
      bucket: null,
      percent,
      configurationValid: true,
    };

  if (mode === 'on')
    return {
      mode,
      selected: true,
      bucket: null,
      percent: 100,
      configurationValid: true,
    };

  const salt = env.P1_CANARY_SALT?.trim() ?? '';
  if (salt.length < 16 || percent < 1)
    return {
      mode,
      selected: false,
      bucket: null,
      percent,
      configurationValid: false,
    };

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
    return (
      env.LLM_GENERATION_MODE === 'shadow' &&
      env.LLM_VALIDATION_MODE === 'shadow'
    );
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
    input.draft.sentences.some(
      (sentence) =>
        !sentence.evidenceRefs.length ||
        new Set(sentence.evidenceRefs).size !== sentence.evidenceRefs.length ||
        sentence.evidenceRefs.some((ref) => !Object.hasOwn(refs, ref)),
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
