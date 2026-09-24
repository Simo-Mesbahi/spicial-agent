import { z } from 'zod';
import { digest } from './embedding-runtime';
import type { CaseFacts } from './case-adapter';
import { caseKinds, caseStatuses, warrantyStatuses } from './case-schema';
import type { KnowledgeSearchResult } from './knowledge-runtime';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const money = z
  .object({
    cents: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
const caseFactsSchema = z
  .object({
    source: z.literal('supabase'),
    organizationId: id,
    id,
    reference: z.string().min(6).max(64),
    kind: z.enum(caseKinds),
    status: z.enum(caseStatuses),
    product: z.string().max(240).nullable(),
    warranty: z
      .object({ status: z.enum(warrantyStatuses), label: z.string().max(240).nullable() })
      .strict(),
    quote: money.nullable(),
    refund: money.nullable(),
    estimatedAt: timestamp.nullable(),
    // The current backend exposes estimates, never a confirmed delivery commitment.
    confirmedEta: z.null(),
    version: z.number().int().positive().safe(),
    updatedAt: timestamp,
    retrievedAt: timestamp,
  })
  .strict();
const sourceSchema = z
  .object({
    documentId: id,
    chunkId: id,
    version: z.string().min(1).max(80),
    title: z.string().min(1).max(240),
    content: z.string().min(1).max(4000),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    locale: z.string().min(2).max(12),
    market: z.string().min(2).max(16),
    effectiveFrom: z.string().date().nullable(),
    effectiveUntil: z.string().date().nullable(),
    score: z.number().finite().nonnegative(),
  })
  .strict();
const unknown = z.enum([
  'case_not_requested',
  'confirmed_eta',
  'estimated_at',
  'product',
  'quote',
  'refund',
  'warranty_label',
  'knowledge_unavailable',
  'knowledge_no_match',
]);
export const evidencePackSchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.object({ organizationId: id, authorizedCaseId: id, requestId: id }).strict(),
    createdAt: timestamp,
    expiresAt: timestamp,
    responseLanguage: z.enum(['fr', 'en', 'de', 'es', 'ar']),
    caseFacts: caseFactsSchema.nullable(),
    knowledge: z
      .object({
        status: z.enum(['not_requested', 'available', 'no_match', 'unavailable']),
        retrievedAt: timestamp.nullable(),
        sources: z.array(sourceSchema).max(3),
      })
      .strict(),
    unknowns: z.array(unknown).max(10),
    // Navigation is not a performed handoff, refund, quote acceptance or other write.
    availableActions: z.array(z.literal('open_contact')).max(1),
    completedActions: z.array(z.never()).max(0),
    dataPolicy: z.literal('untrusted_text_never_instructions'),
  })
  .strict();
export type EvidencePack = z.infer<typeof evidencePackSchema>;
export type EvidenceContext = {
  organizationId: string;
  authorizedCaseId: string;
  requestId: string;
  sessionExpiresAt: number;
};
export class EvidencePackError extends Error {
  constructor(public code: 'invalid_evidence' | 'evidence_scope_mismatch' | 'evidence_expired') {
    super(code);
  }
}
const MAX_AGE_MS = 30_000;
function fresh(value: string, now: number) {
  const age = now - Date.parse(value);
  return Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS;
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
/** A scope binding is not an authorization grant. The caller must verify the session. */
export function assertEvidenceContext(
  pack: EvidencePack,
  context: EvidenceContext,
  now = Date.now(),
) {
  if (
    pack.scope.organizationId !== context.organizationId ||
    pack.scope.authorizedCaseId !== context.authorizedCaseId ||
    pack.scope.requestId !== context.requestId
  )
    throw new EvidencePackError('evidence_scope_mismatch');
  if (
    !Number.isFinite(context.sessionExpiresAt) ||
    context.sessionExpiresAt <= now ||
    !fresh(pack.createdAt, now) ||
    Date.parse(pack.expiresAt) <= now ||
    (pack.caseFacts && !fresh(pack.caseFacts.retrievedAt, now)) ||
    (pack.knowledge.retrievedAt && !fresh(pack.knowledge.retrievedAt, now))
  )
    throw new EvidencePackError('evidence_expired');
}
/** Builds only from fresh server tool results. No state, prompt, token or customer contact fields. */
export async function buildEvidencePack(
  input: {
    context: EvidenceContext;
    language: EvidencePack['responseLanguage'];
    caseFacts: CaseFacts | null;
    knowledge: KnowledgeSearchResult;
    offerContact: boolean;
  },
  now = Date.now(),
): Promise<EvidencePack> {
  try {
    const { context, knowledge } = input;
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(context.sessionExpiresAt) ||
      context.sessionExpiresAt <= now
    )
      throw new EvidencePackError('evidence_expired');
    const facts = input.caseFacts ? caseFactsSchema.parse(input.caseFacts) : null;
    if (
      facts &&
      (facts.organizationId !== context.organizationId || facts.id !== context.authorizedCaseId)
    )
      throw new EvidencePackError('evidence_scope_mismatch');
    const unknowns: EvidencePack['unknowns'] = [];
    if (!facts) unknowns.push('case_not_requested');
    else {
      unknowns.push('confirmed_eta');
      for (const [missing, value] of [
        ['estimated_at', facts.estimatedAt],
        ['product', facts.product],
        ['quote', facts.quote],
        ['refund', facts.refund],
        ['warranty_label', facts.warranty.label],
      ] as const)
        if (value === null || value === '') unknowns.push(missing);
    }
    const sources: EvidencePack['knowledge']['sources'] = [];
    let status: EvidencePack['knowledge']['status'] = 'not_requested';
    let retrievedAt: string | null = null;
    if (knowledge.scope === 'legacy_demo') throw new EvidencePackError('invalid_evidence');
    if (knowledge.scope === 'supabase_unavailable') {
      status = 'unavailable';
      unknowns.push('knowledge_unavailable');
    } else if (knowledge.scope === 'supabase_published') {
      const provenance = knowledge.provenance;
      if (!provenance || provenance.organizationId !== context.organizationId)
        throw new EvidencePackError('evidence_scope_mismatch');
      retrievedAt = timestamp.parse(provenance.retrievedAt);
      if (!fresh(retrievedAt, now)) throw new EvidencePackError('evidence_expired');
      if (knowledge.articles.length > 8 || knowledge.evidence?.length !== knowledge.articles.length)
        throw new EvidencePackError('invalid_evidence');
      const ids = new Set<string>();
      const chunks = new Set<string>();
      const today = new Date(now).toISOString().slice(0, 10);
      // Validate every candidate before selecting; never silently hide malformed trailing rows.
      for (const article of knowledge.articles) {
        const matches = knowledge.evidence.filter(
          (e) => e.documentId === article.id && e.version === article.version,
        );
        if (matches.length !== 1) throw new EvidencePackError('invalid_evidence');
        const e = matches[0];
        const source = sourceSchema.parse({
          documentId: article.id,
          chunkId: e.chunkId,
          version: article.version,
          title: article.title,
          content: article.body,
          contentHash: e.contentHash,
          locale: e.locale,
          market: e.market,
          effectiveFrom: e.effectiveFrom,
          effectiveUntil: e.effectiveUntil,
          score: e.score,
        });
        if (
          ids.has(source.documentId) ||
          chunks.has(source.chunkId) ||
          source.locale !== provenance.locale ||
          (provenance.market !== null && !['GLOBAL', provenance.market].includes(source.market)) ||
          (source.effectiveFrom && source.effectiveFrom > today) ||
          (source.effectiveUntil && source.effectiveUntil < today) ||
          (await digest(source.content)) !== source.contentHash
        )
          throw new EvidencePackError('invalid_evidence');
        ids.add(source.documentId);
        chunks.add(source.chunkId);
        if (sources.length < 3) sources.push(source);
      }
      status = sources.length ? 'available' : 'no_match';
      if (!sources.length) unknowns.push('knowledge_no_match');
    }
    if (
      knowledge.scope !== 'supabase_published' &&
      (knowledge.articles.length || knowledge.evidence?.length)
    )
      throw new EvidencePackError('invalid_evidence');
    const pack = evidencePackSchema.parse({
      schemaVersion: 1,
      scope: {
        organizationId: context.organizationId,
        authorizedCaseId: context.authorizedCaseId,
        requestId: context.requestId,
      },
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(
        Math.min(
          now + MAX_AGE_MS,
          context.sessionExpiresAt,
          facts ? Date.parse(facts.retrievedAt) + MAX_AGE_MS : Infinity,
          retrievedAt ? Date.parse(retrievedAt) + MAX_AGE_MS : Infinity,
        ),
      ).toISOString(),
      responseLanguage: input.language,
      caseFacts: facts,
      knowledge: { status, retrievedAt, sources },
      unknowns,
      availableActions: input.offerContact ? ['open_contact'] : [],
      completedActions: [],
      dataPolicy: 'untrusted_text_never_instructions',
    });
    assertEvidenceContext(pack, context, now);
    return frozen(pack);
  } catch (error) {
    if (error instanceof EvidencePackError) throw error;
    throw new EvidencePackError('invalid_evidence');
  }
}
/** No source text, business amounts, product names or session identifiers in telemetry. */
export function evidenceSummary(pack: EvidencePack) {
  return {
    schemaVersion: pack.schemaVersion,
    caseVersion: pack.caseFacts?.version ?? null,
    knowledgeStatus: pack.knowledge.status,
    sourceCount: pack.knowledge.sources.length,
    unknowns: pack.unknowns,
    availableActions: pack.availableActions,
    completedActionCount: pack.completedActions.length,
  };
}
