import { createHash } from 'node:crypto';
// Independent synthetic evidence and review criteria. Criteria never enter model input.
const languages = ['fr', 'en', 'de', 'es', 'ar'];
const caseQuestions = [
  'Pourquoi ma télé attend et quand revient-elle ?',
  'Why is my TV waiting and when will it return?',
  'Warum wartet mein Fernseher und wann kommt er zurück?',
  '¿Por qué sigue esperando mi televisor y cuándo vuelve?',
  'لماذا ما زال تلفازي ينتظر ومتى سيعود؟',
];
const policyQuestions = [
  'Mon remboursement est-il automatique ?',
  'Is my refund automatic?',
  'Erhalte ich die Erstattung automatisch?',
  '¿Mi reembolso es automático?',
  'هل يتم استرداد المبلغ تلقائيا؟',
];
export const generationScenarios = [
  ...languages.map((language, i) => ({
    id: `waiting-part-${language}`,
    language,
    kind: 'case',
    message: caseQuestions[i],
    rubric: [
      'Explain waiting_part without inventing a cause',
      'No confirmed date',
      'No action performed',
      'Natural concise reply in requested language',
    ],
  })),
  ...languages.map((language, i) => ({
    id: `refund-policy-${language}`,
    language,
    kind: 'knowledge',
    message: policyQuestions[i],
    rubric: [
      'Explain that a review is required',
      'Do not promise automatic refund or eligibility',
      'No invented amount or date',
      'Answer in requested language from French evidence',
    ],
  })),
];
export function refreshSyntheticEvidenceFixture(fixture, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('Invalid synthetic evidence refresh time');
  const refreshed = structuredClone(fixture);
  const stamp = new Date(now).toISOString();
  const expiresAt = new Date(now + 30000).toISOString();

  const refreshPack = (pack) => {
    pack.createdAt = stamp;
    pack.expiresAt = expiresAt;
    if (pack.caseFacts) pack.caseFacts.retrievedAt = stamp;
    if (pack.knowledge?.retrievedAt) pack.knowledge.retrievedAt = stamp;
  };

  // Evaluation fixtures model a fresh server re-read of unchanged authoritative data.
  // Preserve scope/business facts while renewing only freshness/session timestamps.
  refreshed.context.sessionExpiresAt = now + 60000;
  refreshPack(refreshed.pack);
  if (refreshed.currentPack) refreshPack(refreshed.currentPack);
  return refreshed;
}

export function generationFixture(scenario, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const context = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    authorizedCaseId: '00000000-0000-4000-8000-000000000002',
    requestId: crypto.randomUUID(),
    sessionExpiresAt: now + 60000,
  };
  const pack = {
    schemaVersion: 1,
    scope: {
      organizationId: context.organizationId,
      authorizedCaseId: context.authorizedCaseId,
      requestId: context.requestId,
    },
    createdAt: stamp,
    expiresAt: new Date(now + 30000).toISOString(),
    responseLanguage: scenario.language,
    caseFacts:
      scenario.kind === 'case'
        ? {
            source: 'supabase',
            organizationId: context.organizationId,
            id: context.authorizedCaseId,
            reference: 'SAV-2026-1042',
            kind: 'repair',
            status: 'waiting_part',
            product: 'Télévision',
            warranty: { status: 'unknown', label: null },
            quote: null,
            refund: null,
            estimatedAt: null,
            confirmedEta: null,
            version: 1,
            updatedAt: stamp,
            retrievedAt: stamp,
          }
        : null,
    knowledge: {
      status: scenario.kind === 'knowledge' ? 'available' : 'not_requested',
      retrievedAt: scenario.kind === 'knowledge' ? stamp : null,
      sources:
        scenario.kind === 'knowledge'
          ? [
              {
                documentId: '00000000-0000-4000-8000-000000000101',
                chunkId: '00000000-0000-4000-8000-000000000201',
                version: '1',
                title: 'Demande de remboursement',
                content: 'Toute demande fait l’objet d’un examen. Aucun remboursement automatique.',
                contentHash: createHash('sha256')
                  .update(
                    'Toute demande fait l’objet d’un examen. Aucun remboursement automatique.',
                  )
                  .digest('hex'),
                locale: 'fr-FR',
                market: 'GLOBAL',
                effectiveFrom: null,
                effectiveUntil: null,
                score: 0.9,
              },
            ]
          : [],
    },
    unknowns:
      scenario.kind === 'case'
        ? ['confirmed_eta', 'estimated_at', 'quote', 'refund', 'warranty_label']
        : ['case_not_requested'],
    availableActions: [],
    completedActions: [],
    dataPolicy: 'untrusted_text_never_instructions',
  };
  return {
    pack,
    context,
    message: scenario.message,
    guidance: {
      topic: scenario.kind === 'case' ? 'repair' : 'refund',
      subIntent: scenario.kind === 'case' ? 'eta' : 'procedure',
      short: true,
      emoji: false,
    },
  };
}
