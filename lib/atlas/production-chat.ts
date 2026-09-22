import {
  validateNaturalDraft,
  revalidateFactualResult,
  type ValidationDiagnostics,
} from './factual-validation';
import { generateNaturalDraft, type GenerationDiagnostics } from './natural-generation';
import {
  buildEvidencePack,
  assertEvidenceContext,
  evidenceSummary,
  EvidencePackError,
  type EvidencePack,
} from './evidence-pack';
import { z } from 'zod';
import type { AtlasEnv } from './api';
import { hash, criticalSafetyAnswer } from './api';
import { redacted } from './domain';
import { productionCaseAdapter, CaseAccessError, type CaseFacts } from './case-adapter';
import { renderCaseFacts } from './case-facts-renderer';
import {
  acquireConversation,
  commitConversation,
  releaseConversation,
  ConversationBusy,
  type ConversationLease,
} from './conversation-state';
import { understandConversation, executeConversation } from './structured-conversation';
import { detectConversationLanguage } from './conversation-intelligence';
import { providerTrace, ProviderError } from './provider-runtime';
import { publicModelConfig } from './model-policy';
import { mutationOriginAllowed } from './request-security';
import { effectiveEnvironment } from './runtime-settings';
import {
  searchKnowledge,
  revalidateKnowledgeEvidence,
  KnowledgeFreshnessError,
} from './knowledge-runtime';
import {
  releaseCohort,
  releaseNaturalResponse,
  shouldEvaluateNaturalResponse,
  type ReleaseDiagnostics,
} from './p1-release';

export async function productionChat(
  req: Request,
  originalEnv: AtlasEnv,
  token: string,
  body: unknown,
  reserveBudget: (env: AtlasEnv) => Promise<void>,
) {
  const env = await effectiveEnvironment(originalEnv, req.url);
  if (env.LLM_ORCHESTRATOR !== 'structured')
    throw new CaseAccessError(
      503,
      'chat_not_enabled',
      'L’assistant est momentanément indisponible.',
    );
  const adapter = await productionCaseAdapter(env, token);
  const initial = await adapter.read();
  if (req.method === 'GET') {
    const rows = (
      await env.DB.prepare(
        'SELECT id,role,content,metadata FROM messages WHERE space_id=? ORDER BY created_at DESC,rowid DESC LIMIT 24',
      )
        .bind(adapter.spaceId)
        .all<{ id: string; role: string; content: string; metadata: string }>()
    ).results.reverse();
    return {
      csrf: adapter.csrf,
      messages: rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) })),
    };
  }
  if (
    !mutationOriginAllowed(req, env) ||
    req.headers.get('x-atlas-csrf') !== adapter.csrf
  )
    throw new CaseAccessError(
      403,
      'invalid_origin_or_csrf',
      'Actualisez le dossier avant de réessayer.',
    );
  const parsed = z
    .object({
      message: z.string().trim().min(1).max(1500),
      requestId: z.string().regex(/^[a-zA-Z0-9-]{8,80}$/),
    })
    .strict()
    .safeParse(body);
  if (!parsed.success)
    throw new CaseAccessError(
      400,
      'invalid_chat_request',
      'La question ou son identifiant est invalide.',
    );
  const message = redacted(parsed.data.message),
    key = `${adapter.spaceId}:${parsed.data.requestId}`;
  const references = message.match(/(?:SAV|CMD|RET|REM|SC)-\d{4}-\d{4}(?:-\d+)?/gi) ?? [];
  if (references.some((ref) => ref.toUpperCase() !== initial.reference.toUpperCase()))
    throw new CaseAccessError(
      403,
      'case_access_denied',
      'Vérifiez cet autre dossier dans le formulaire sécurisé.',
    );
  const inputHash = await hash(message);
  const claim = await env.DB.prepare(
    'INSERT OR IGNORE INTO chat_requests (id,space_id,input_hash,created_at) VALUES (?,?,?,?)',
  )
    .bind(key, adapter.spaceId, inputHash, Date.now())
    .run();
  if (!claim.meta.changes) {
    const previous = await env.DB.prepare(
      'SELECT input_hash,response FROM chat_requests WHERE id=? AND space_id=?',
    )
      .bind(key, adapter.spaceId)
      .first<{ input_hash: string; response: string | null }>();
    if (previous?.input_hash !== inputHash || !previous.response)
      throw new CaseAccessError(
        409,
        'request_conflict',
        'Cette question est déjà en cours ou son identifiant est réutilisé.',
      );
    return JSON.parse(previous.response);
  }
  const trace = providerTrace(),
    requestId = crypto.randomUUID(),
    started = performance.now();
  const evidenceContext = {
    organizationId: adapter.organizationId,
    authorizedCaseId: adapter.caseId,
    requestId,
    sessionExpiresAt: adapter.expiresAt,
  };
  const sessionId = (await hash(adapter.spaceId)).slice(0, 24);
  const config = publicModelConfig(env);
  let lease: ConversationLease | null = null;
  let persisted = false;
  let generation: GenerationDiagnostics | null = null;
  let validation: ValidationDiagnostics | null = null;
  let release: ReleaseDiagnostics | null = null;
  try {
    lease = await acquireConversation(env.DB, adapter.spaceId, adapter.expiresAt);
    // A production session authorizes exactly one case. Changing it requires verification.
    if (!lease.state.pendingCaseSwitch) lease.state.activeCaseId = initial.id;
    lease.state.previousCaseId = lease.state.previousCaseId === initial.id ? initial.id : null;
    const candidates = [
      {
        id: initial.id,
        reference: initial.reference,
        product: (initial.product ?? '').slice(0, 100),
        kind: initial.kind,
      },
    ];
    let usedCase: CaseFacts | null = null;
    let conversation: Awaited<ReturnType<typeof executeConversation<CaseFacts>>> | null = null;
    let fallbackReason: string | null = null;
    const safety = criticalSafetyAnswer(message, true);
    if (!safety && (!config.ready || config.provider === 'demo'))
      throw new CaseAccessError(
        503,
        'provider_not_configured',
        'L’assistant est momentanément indisponible.',
      );
    if (!safety) await reserveBudget(env);
    try {
      if (!safety) {
        const understanding = await understandConversation(
          env,
          message,
          lease.state,
          candidates,
          trace,
        );
        conversation = await executeConversation(
          understanding,
          lease.state,
          candidates,
          message,
          {
            readCase: async (id) => {
              usedCase = await adapter.read(id);
              return usedCase;
            },
            // A configured production transport must never substitute demonstration documents.
            retrieve: async (query) => {
              const result = await searchKnowledge(env, query);
              return result.scope === 'legacy_demo'
                ? { articles: [], scope: 'supabase_unavailable' }
                : result;
            },
            prepareEvidence: async ({ currentCase, knowledge, language, plan }) => {
              const pack = await buildEvidencePack({
                context: evidenceContext,
                caseFacts: currentCase,
                knowledge,
                language,
                offerContact: plan.kind === 'handoff',
              });
              return { pack, currentCase: pack.caseFacts };
            },
            renderCase: renderCaseFacts,
            renderWarranty: (facts, language) => renderCaseFacts(facts, language),
          },
          trace,
        );
      }
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      fallbackReason = error.reason;
    }
    const cohort = await releaseCohort(env, {
      organizationId: adapter.organizationId,
      authorizedCaseId: adapter.caseId,
      sessionId,
    });

    async function refreshReleaseEvidence(generatedFrom: EvidencePack) {
      if (!generatedFrom) throw new EvidencePackError('invalid_evidence');
      // Revalidate the customer session after all upstream latency. A fresh case read is
      // required even for knowledge-only turns because authorization is session-bound.
      const authorizedFacts = await adapter.read();
      const knowledge = generatedFrom.knowledge.sources.length
        ? await revalidateKnowledgeEvidence(env, generatedFrom)
        : { articles: [], scope: 'not_required' as const };
      const pack = await buildEvidencePack({
        context: evidenceContext,
        language: generatedFrom.responseLanguage,
        caseFacts: generatedFrom.caseFacts ? authorizedFacts : null,
        knowledge,
        offerContact: false,
      });
      return { pack, authorizedFacts };
    }

    if (conversation?.evidencePack) {
      const generatedFrom = conversation.evidencePack;
      const evaluate = shouldEvaluateNaturalResponse(
        env,
        conversation.plan.kind,
        cohort,
      );
      let draft: Awaited<ReturnType<typeof generateNaturalDraft>>['draft'] = null;
      let freshnessFailure: 'knowledge_changed' | 'knowledge_unavailable' | null = null;
      let currentPack = generatedFrom;

      if (evaluate) {
        const result = await generateNaturalDraft(
          env,
          {
            pack: generatedFrom,
            context: evidenceContext,
            message,
            guidance: {
              topic: conversation.state.currentTopic,
              subIntent: conversation.understanding.subIntent,
              short: conversation.state.stylePreferences.short,
              emoji: conversation.state.stylePreferences.emoji,
            },
          },
          trace,
        );
        draft = result.draft;
        generation = result.diagnostics;

        if (draft && generation.outcome === 'candidate_generated') {
          try {
            const refreshed = await refreshReleaseEvidence(generatedFrom);
            currentPack = refreshed.pack;
            usedCase = refreshed.authorizedFacts;
            if (
              env.LLM_VALIDATION_MODE === 'shadow' ||
              env.LLM_VALIDATION_MODE === 'release'
            ) {
              validation = await validateNaturalDraft(
                env,
                {
                  draft,
                  pack: generatedFrom,
                  currentPack,
                  context: evidenceContext,
                },
                trace,
              );

              if (validation.calls > 0) {
                // No provider result can cross the gate without a second post-validation
                // authorization + publication refresh.
                const finalRefresh = await refreshReleaseEvidence(generatedFrom);
                currentPack = finalRefresh.pack;
                usedCase = finalRefresh.authorizedFacts;
                validation = await revalidateFactualResult(
                  validation,
                  generatedFrom,
                  currentPack,
                  evidenceContext,
                );
              }
            }
          } catch (error) {
            if (error instanceof KnowledgeFreshnessError)
              freshnessFailure = error.reason;
            else throw error;
          }
        }
      }

      conversation.evidencePack = currentPack;
      conversation.currentCase = currentPack.caseFacts;
      const released = await releaseNaturalResponse(env, {
        cohort,
        plan: conversation.plan.kind,
        draft,
        generation,
        validation,
        generatedPack: generatedFrom,
        currentPack,
        context: evidenceContext,
        groundingFailure: conversation.groundingFailure,
        freshnessFailure,
        allowEmoji: conversation.state.stylePreferences.emoji,
      });
      release = released.diagnostics;

      if (released.content) conversation.answer.content = released.content;
      // Otherwise preserve executeConversation's deterministic server-owned answer.
      // Shadow/canary evaluation must never degrade the customer-visible fallback.
    }

    // Social responses and fallbacks also revalidate the case session after provider latency.
    // For released content, usedCase already comes from the final post-validation refresh.
    const finalFacts = usedCase ?? (await adapter.read());
    const language =
      conversation?.language ??
      lease.state.preferredResponseLanguage ??
      detectConversationLanguage(message);
    const evidencePack =
      conversation?.evidencePack ??
      (await buildEvidencePack({
        context: evidenceContext,
        language,
        caseFacts: safety ? null : finalFacts,
        knowledge: { articles: [], scope: 'not_required' },
        offerContact: false,
      }));
    const answer = safety ??
      conversation?.answer ?? {
        content: renderCaseFacts(evidencePack.caseFacts!, language),
        sources: [],
        tools: ['get_case'],
        action: null,
      };
    if (safety) trace.tools.push(...safety.tools);
    else if (!conversation) trace.tools.push('get_case');
    assertEvidenceContext(evidencePack, evidenceContext);
    const evidence = evidenceSummary(evidencePack);
    const metadata = {
      evidence,
      generation: generation
        ? {
            mode: generation.mode,
            outcome: generation.outcome,
            released: release?.released ?? false,
          }
        : null,
      validation: validation
        ? {
            mode: validation.mode,
            outcome: validation.outcome,
            released: release?.released ?? false,
          }
        : null,
      release,
      orchestrator: 'structured',
      dataSource: 'supabase',
      provider: config.provider,
      model: config.model,
      mode: release?.released
        ? 'grounded_generation'
        : conversation
          ? config.provider
          : 'deterministic',
      fallback: fallbackReason ? 'provider_unavailable' : null,
      fallbackReason,
      requestId,
      understanding: conversation?.understanding ?? null,
      plan: conversation?.plan.kind ?? null,
      stateVersion: lease.version + 1,
      groundingFailure: conversation?.groundingFailure ?? false,
      action: answer.action,
      selectedCaseId: conversation ? conversation.state.activeCaseId : initial.id,
      tools: answer.tools,
      sources: answer.sources.map((s) => ({ id: s.id, version: s.version, title: s.title })),
      caseEvidence:
        usedCase || (!conversation && !safety)
          ? {
              id: finalFacts.id,
              version: finalFacts.version,
              updatedAt: finalFacts.updatedAt,
              source: finalFacts.source,
            }
          : null,
      providerCalls: trace.calls,
      inputTokens: trace.usageComplete ? trace.inputTokens : null,
      outputTokens: trace.usageComplete ? trace.outputTokens : null,
      usageComplete: trace.usageComplete,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
    };
    const reply = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: redacted(answer.content),
      metadata,
    };
    const now = Date.now();
    await env.DB.batch([
      commitConversation(env.DB, lease, conversation?.state ?? lease.state),
      env.DB.prepare(
        "INSERT INTO messages (id,space_id,case_id,role,content,metadata,created_at) VALUES (?,?,?,'user',?,'{}',?)",
      ).bind(crypto.randomUUID(), adapter.spaceId, initial.id, message, now),
      env.DB.prepare(
        "INSERT INTO messages (id,space_id,case_id,role,content,metadata,created_at) VALUES (?,?,?,'assistant',?,?,?)",
      ).bind(
        reply.id,
        adapter.spaceId,
        initial.id,
        reply.content,
        JSON.stringify(metadata),
        now + 1,
      ),
      env.DB.prepare('UPDATE chat_requests SET response=? WHERE id=? AND space_id=?').bind(
        JSON.stringify(reply),
        key,
        adapter.spaceId,
      ),
    ]);
    persisted = true;
    console.info('atlas.ai.interaction', {
      schema: 1,
      requestId,
      sessionId,
      dataSource: 'supabase',
      provider: config.provider,
      model: config.model,
      evidence,
      generation,
      validation,
      release,
      outcome: safety
        ? 'safety_guard'
        : release?.released
          ? 'natural_released'
          : fallbackReason
            ? 'fallback'
            : 'provider_success',
      fallbackReason,
      providerTrace: trace,
      persisted,
      latencyMs: performance.now() - started,
    });
    return reply;
  } catch (error) {
    console.info('atlas.ai.interaction', {
      schema: 1,
      requestId,
      sessionId,
      dataSource: 'supabase',
      provider: config.provider,
      model: config.model,
      outcome: 'error',
      generation,
      validation,
      release,
      errorClassification:
        error instanceof CaseAccessError
          ? error.code
          : error instanceof EvidencePackError
            ? error.code
            : error instanceof ConversationBusy
              ? 'conversation_busy'
              : 'request_failed',
      providerTrace: trace,
      persisted,
      latencyMs: performance.now() - started,
    });
    if (error instanceof EvidencePackError)
      throw new CaseAccessError(
        502,
        error.code,
        'Les informations ne peuvent pas être confirmées. Réessayez dans un instant.',
      );
    if (error instanceof ConversationBusy)
      throw new CaseAccessError(
        409,
        'conversation_busy',
        'Un message est déjà en cours. Attendez sa réponse.',
      );
    throw error;
  } finally {
    if (!persisted) {
      try {
        if (lease) await releaseConversation(env.DB, lease);
        await env.DB.prepare('DELETE FROM chat_requests WHERE id=? AND response IS NULL')
          .bind(key)
          .run();
      } catch {
        console.error('atlas.production_chat.cleanup_failed', { requestId });
      }
    }
  }
}
