import { syntheticProviderHealth } from './provider-health';
import { effectiveEnvironment } from './runtime-settings';
import { z } from 'zod';
import { retrieve } from './domain';
import { publicModelConfig } from './model-policy';
import { applyConfig, availableProviders, defaults, environmentLabel, readSettings, runtimeConfigSchema, saveSettings, scopeKey, validateConfig, type Revision } from './runtime-settings';
import { boundedJson, JsonLimitError } from './bounded-json';
import { mutationOriginAllowed } from './request-security';
import { chunkKnowledge, knowledgeDocumentSchema, knowledgeDraftSchema, knowledgeListSchema } from './knowledge-control';
import {
  caseAccessRotateInputSchema,
  caseArchiveInputSchema,
  caseCreateInputSchema,
  caseTransitionInputSchema,
  caseUpdateInputSchema,
} from './case-management';
import type { ProductionEnv } from './production-api';
import { SupabaseRequestError, supabaseRequest } from './supabase';

const ADMIN_ACCESS_COOKIE = 'savsc_admin_access';
const ADMIN_REFRESH_COOKIE = 'savsc_admin_refresh';
const PREAUTH_ACCESS_COOKIE = 'savsc_admin_preauth';
const PREAUTH_REFRESH_COOKIE = 'savsc_admin_preauth_refresh';
const BASE_PATH = '/api/production/admin/operations';

class AdminOperationsError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

const membershipSchema = z.object({
  organization_id: z.string().uuid(),
  organization_name: z.string().min(1).max(160),
  role: z.enum(['super_admin', 'sav_manager', 'sc_manager', 'adviser', 'analyst']),
  display_name: z.string().max(160).nullable(),
});

const adminMeSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().email(),
  aal: z.enum(['aal1', 'aal2']),
  memberships: z.array(membershipSchema).max(20),
});

const authSessionSchema = z.object({
  access_token: z.string().min(20).max(8000),
  refresh_token: z.string().min(20).max(8000),
  expires_in: z.number().int().positive().max(86400).optional(),
  user: z.object({ id: z.string().uuid() }).passthrough(),
});

const nonNegativeInt = z.number().int().nonnegative();
const nullableMetric = z.number().nonnegative().nullable();

const overviewSchema = z
  .object({
    generated_at: z.string(),
    period_days: z.number().int().min(1).max(90),
    cases: z.object({
      total: nonNegativeInt,
      open: nonNegativeInt,
      overdue: nonNegativeInt,
      without_eta: nonNegativeInt,
      stale: nonNegativeInt,
      resolved: nonNegativeInt,
      avg_resolution_hours: nullableMetric,
    }),
    by_status: z.record(z.string(), nonNegativeInt),
    trend: z
      .array(
        z.object({
          day: z.string(),
          opened: nonNegativeInt,
          closed: nonNegativeInt,
        }),
      )
      .max(90),
    performance: z.object({
      requests_24h: nonNegativeInt,
      error_rate_24h: nullableMetric,
      avg_latency_ms_24h: nullableMetric,
      p95_latency_ms_24h: nullableMetric,
      denied_24h: nonNegativeInt,
      rate_limited_24h: nonNegativeInt,
    }),
    routes: z
      .array(
        z.object({
          route: z.string().max(240),
          requests: nonNegativeInt,
          errors: nonNegativeInt,
          avg_ms: nullableMetric,
        }),
      )
      .max(20),
    documents: z.object({
      total: nonNegativeInt,
      published: nonNegativeInt,
      review: nonNegativeInt,
      expired: nonNegativeInt,
    }),
    assistant: z.object({
      messages_24h: nonNegativeInt,
      conversations: nonNegativeInt,
    }),
    handoffs: z.object({
      open: nonNegativeInt,
      unassigned: nonNegativeInt,
    }),
  })
  .strict();

const queueSchema = z
  .object({
    priorities: z
      .array(
        z.object({
          id: z.string().uuid(),
          reference: z.string().min(1).max(64),
          title: z.string().min(1).max(180),
          status: z.string().min(1).max(50),
          estimated_at: z.string().nullable(),
          updated_at: z.string(),
        }),
      )
      .max(20),
    handoffs: z
      .array(
        z.object({
          id: z.string().uuid(),
          case_id: z.string().uuid().nullable(),
          reference: z.string().max(64).nullable(),
          summary: z.string().max(4000),
          status: z.string().max(40),
          assigned_to: z.string().uuid().nullable(),
          updated_at: z.string(),
          created_at: z.string(),
        }),
      )
      .max(30),
  })
  .strict();

const caseDetailSchema = z
  .object({
    id: z.string().uuid(),
    reference: z.string().max(64),
    service_type: z.enum(['sav', 'customer_service']),
    title: z.string().max(180),
    description: z.string().max(6000),
    kind: z.string().max(40),
    status: z.string().max(50),
    version: z.number().int().positive(),
    updated_at: z.string(),
    estimated_at: z.string().nullable(),
    created_at: z.string(),
    closed_at: z.string().nullable(),
    archived_at: z.string().nullable(),
    archive_reason: z.string().max(1000).nullable(),
    source_system: z.string().max(120).nullable(),
    source_updated_at: z.string().nullable(),
    warranty_status: z.string().max(40),
    warranty_label: z.string().max(240).nullable(),
    quote_cents: z.number().int().nonnegative().nullable(),
    refund_cents: z.number().int().nonnegative().nullable(),
    currency: z.string().length(3),
    delivery_mode: z.string().max(240).nullable(),
    customer_id: z.string().uuid().nullable(),
    customer: z
      .object({
        id: z.string().uuid(),
        external_id: z.string().max(160).nullable(),
        first_name: z.string().max(160).nullable(),
        last_name: z.string().max(160).nullable(),
        email: z.string().max(320).nullable(),
        phone: z.string().max(80).nullable(),
      })
      .strict()
      .nullable(),
    product_id: z.string().uuid().nullable(),
    product: z
      .object({
        id: z.string().uuid(),
        external_id: z.string().max(160).nullable(),
        sku: z.string().max(120).nullable(),
        name: z.string().max(240),
        category: z.string().max(160).nullable(),
        serial_number: z.string().max(160).nullable(),
      })
      .strict()
      .nullable(),
    store_id: z.string().uuid().nullable(),
    store: z
      .object({
        id: z.string().uuid(),
        code: z.string().max(160),
        name: z.string().max(240),
        city: z.string().max(160).nullable(),
      })
      .strict()
      .nullable(),
    events: z
      .array(
        z.object({
          id: z.string().uuid(),
          label: z.string().max(240),
          detail: z.string().max(6000).nullable(),
          customer_visible: z.boolean(),
          occurred_at: z.string(),
          source: z.string().max(80),
        }),
      )
      .max(100),
  })
  .strict()
  .nullable();

const caseMutationResultSchema = z
  .object({
    ok: z.literal(true),
    id: z.string().uuid(),
    reference: z.string().max(64),
    version: z.number().int().positive(),
  })
  .passthrough();

const accessCodeResultSchema = caseMutationResultSchema.extend({
  access_code: z.string().regex(/^\d{6,12}$/).nullable(),
  access_code_available: z.boolean(),
  replayed: z.boolean(),
});

const caseFormOptionsSchema = z
  .object({
    stores: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            code: z.string().max(160),
            name: z.string().max(240),
            city: z.string().max(160).nullable(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

const auditSchema = z
  .object({
    items: z
      .array(
        z.object({
          id: z.string().uuid(),
          action: z.string().max(160),
          outcome: z.string().max(80),
          entity_type: z.string().max(120).nullable(),
          entity_id: z.string().uuid().nullable(),
          actor_user_id: z.string().uuid().nullable(),
          created_at: z.string(),
        }),
      )
      .max(30),
    total: nonNegativeInt,
  })
  .strict();

function securityHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

function json(data: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers(securityHeaders());
  headers.set('Content-Type', 'application/json; charset=utf-8');
  cookies.forEach((value) => headers.append('Set-Cookie', value));
  return Response.json(data, { status, headers });
}

function cookie(req: Request, name: string) {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function sessionCookie(req: Request, name: string, value: string, maxAge: number) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearCookie(req: Request, name: string) {
  return sessionCookie(req, name, '', 0);
}

function refreshedCookies(req: Request, session: z.infer<typeof authSessionSchema>) {
  const ttl = Math.max(60, Math.min(session.expires_in ?? 3600, 3600));
  return [
    sessionCookie(req, ADMIN_ACCESS_COOKIE, session.access_token, ttl),
    sessionCookie(req, ADMIN_REFRESH_COOKIE, session.refresh_token, 30 * 24 * 60 * 60),
    clearCookie(req, PREAUTH_ACCESS_COOKIE),
    clearCookie(req, PREAUTH_REFRESH_COOKIE),
  ];
}

function fail(status: number, message: string, code: string): never {
  throw new AdminOperationsError(status, message, code);
}

function guardMutation(req: Request, env: ProductionEnv) {
  if (!mutationOriginAllowed(req, env))
    fail(403, 'Requête externe refusée.', 'invalid_origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site')
    fail(403, 'Requête externe refusée.', 'cross_site_request');
}

async function requestBody(req: Request, maxBytes = 16 * 1024) {
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json'))
    fail(415, 'Une requête JSON est requise.', 'json_required');
  try {
    const value = await boundedJson(req, maxBytes);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      fail(400, 'Format de requête invalide.', 'invalid_body');
    return value;
  } catch (error) {
    if (error instanceof JsonLimitError)
      fail(413, 'La requête est trop volumineuse.', 'body_too_large');
    if (error instanceof AdminOperationsError) throw error;
    fail(400, 'Le JSON est invalide.', 'invalid_json');
  }
}

function rpc<T>(
  env: ProductionEnv,
  functionName: string,
  body: Record<string, unknown>,
  accessToken: string,
) {
  return supabaseRequest<T>(env, `/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    body,
    mode: { kind: 'user', accessToken },
  });
}

async function adminMe(env: ProductionEnv, accessToken: string) {
  const result = await rpc<unknown>(env, 'admin_me', {}, accessToken);
  const parsed = adminMeSchema.safeParse(result);
  if (!parsed.success) fail(502, 'Réponse d’identité invalide.', 'invalid_identity_response');
  if (!parsed.data.memberships.length)
    fail(403, 'Ce compte ne possède aucun accès administrateur actif.', 'not_an_admin');
  return parsed.data;
}

async function refreshAdminSession(env: ProductionEnv, refreshToken: string) {
  const result = await supabaseRequest<unknown>(env, '/auth/v1/token?grant_type=refresh_token', {
    mode: { kind: 'publishable' },
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
  const parsed = authSessionSchema.safeParse(result);
  if (!parsed.success) fail(401, 'Votre session a expiré.', 'admin_session_expired');
  return parsed.data;
}

async function requireAdmin(req: Request, env: ProductionEnv) {
  let accessToken = cookie(req, ADMIN_ACCESS_COOKIE);
  const refreshToken = cookie(req, ADMIN_REFRESH_COOKIE);

  if (accessToken) {
    try {
      const me = await adminMe(env, accessToken);
      if (me.aal !== 'aal2') fail(403, 'La double authentification est requise.', 'mfa_required');
      return { accessToken, me, cookies: [] as string[] };
    } catch (error) {
      if (error instanceof AdminOperationsError) throw error;
      if (!(error instanceof SupabaseRequestError) || ![401, 403].includes(error.status)) throw error;
    }
  }

  if (!refreshToken) fail(401, 'Votre session a expiré.', 'admin_session_expired');
  let refreshed: z.infer<typeof authSessionSchema>;
  try {
    refreshed = await refreshAdminSession(env, refreshToken);
  } catch (error) {
    if (error instanceof SupabaseRequestError && error.status < 500)
      fail(401, 'Votre session a expiré.', 'admin_session_expired');
    throw error;
  }
  accessToken = refreshed.access_token;
  const me = await adminMe(env, accessToken);
  if (me.aal !== 'aal2') fail(403, 'La double authentification est requise.', 'mfa_required');
  return { accessToken, me, cookies: refreshedCookies(req, refreshed) };
}

function organizationId(url: URL, me: z.infer<typeof adminMeSchema>) {
  const value = url.searchParams.get('organizationId') ?? '';
  if (!z.string().uuid().safeParse(value).success)
    fail(400, 'Organisation invalide.', 'invalid_organization');
  if (!me.memberships.some((membership) => membership.organization_id === value))
    fail(403, 'Organisation non autorisée.', 'organization_denied');
  return value;
}

function organizationFromBody(value: unknown, me: z.infer<typeof adminMeSchema>) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) fail(400, 'Organisation invalide.', 'invalid_organization');
  if (!me.memberships.some((membership) => membership.organization_id === parsed.data))
    fail(403, 'Organisation non autorisée.', 'organization_denied');
  return parsed.data;
}

function mapSupabaseError(error: SupabaseRequestError): never {
  switch (error.code) {
    case '40001':
      fail(409, 'Les données ont changé. Actualisez avant de réessayer.', 'version_conflict');
    case '42501':
      fail(403, 'Votre rôle ne permet pas cette action.', 'admin_access_denied');
    case 'P0002':
      fail(404, 'La ressource demandée est introuvable.', 'not_found');
    case '22023':
      fail(400, 'Les données envoyées sont invalides.', 'invalid_operation');
    case '28000':
      fail(401, 'Votre session a expiré.', 'admin_session_expired');
    default:
      throw error;
  }
}

async function safeRpc<T>(
  env: ProductionEnv,
  functionName: string,
  body: Record<string, unknown>,
  accessToken: string,
) {
  try {
    return await rpc<T>(env, functionName, body, accessToken);
  } catch (error) {
    if (error instanceof SupabaseRequestError) mapSupabaseError(error);
    throw error;
  }
}

export async function handleAdminOperationsApi(
  req: Request,
  env: ProductionEnv,
): Promise<Response> {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith(BASE_PATH))
      return json({ error: 'Ressource introuvable.', code: 'not_found' }, 404);

    const session = await requireAdmin(req, env);

    if (path === `${BASE_PATH}/provider-health`) {
      if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.', code: 'method_not_allowed' }, 405, session.cookies);
      guardMutation(req, env);
      if (!req.headers.get('origin') || !mutationOriginAllowed(req, env))
        fail(403, 'Origine requise.', 'invalid_origin');
      const organization = organizationId(url, session.me);
      if (organization !== env.SUPABASE_ORGANIZATION_ID)
        fail(403, 'Organisation du déploiement uniquement.', 'deployment_organization_only');
      if (!session.me.memberships.some(m => m.organization_id === organization && m.role === 'super_admin'))
        fail(403, 'Accès super-administrateur requis.', 'settings_role_denied');
      const input = z.object({}).strict().safeParse(await requestBody(req, 256));
      if (!input.success) fail(400, 'Requête invalide.', 'invalid_body');
      const effective = await effectiveEnvironment(env, req.url);
      const result = await syntheticProviderHealth(effective, scopeKey(env, req.url));
      return json(result, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/deployment` && req.method === 'GET') {
      const membership = session.me.memberships.find(item => item.organization_id === env.SUPABASE_ORGANIZATION_ID);
      if (!membership) fail(403, 'Ce compte n’a pas accès à l’organisation de ce déploiement.', 'deployment_organization_only');
      return json({ organizationId: membership.organization_id, environment: environmentLabel(env, req.url) }, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/knowledge` && req.method === 'GET') {
      const organization = organizationId(url, session.me);
      const membership = session.me.memberships.find(item => item.organization_id === organization);
      const status = url.searchParams.get('status') || null;
      const search = url.searchParams.get('search') || null;
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100));
      const offset = Math.max(0, Math.min(Number(url.searchParams.get('offset') ?? 0) || 0, 100000));
      const result = await safeRpc<unknown>(
        env,
        'admin_knowledge_list',
        { p_organization_id: organization, p_status: status, p_search: search, p_limit: limit, p_offset: offset },
        session.accessToken,
      );
      const parsed = knowledgeListSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Base de connaissances invalide.', 'invalid_knowledge_list');
      return json({
        ...parsed.data,
        permissions: {
          canEdit: ['super_admin','sav_manager','sc_manager'].includes(membership?.role ?? ''),
          canPublish: membership?.role === 'super_admin',
        },
      }, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/knowledge/document` && req.method === 'GET') {
      const organization = organizationId(url, session.me);
      const documentId = url.searchParams.get('documentId') ?? '';
      if (!z.string().uuid().safeParse(documentId).success)
        fail(400, 'Document invalide.', 'invalid_knowledge_document_id');
      const result = await safeRpc<unknown>(
        env,
        'admin_knowledge_get',
        { p_organization_id: organization, p_document_id: documentId },
        session.accessToken,
      );
      if (result == null) fail(404, 'Document introuvable.', 'knowledge_document_not_found');
      const parsed = knowledgeDocumentSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Document de connaissance invalide.', 'invalid_knowledge_document');
      return json({ document: parsed.data }, 200, session.cookies);
    }

    if (path.startsWith(`${BASE_PATH}/knowledge/`) && req.method === 'POST') {
      guardMutation(req, env);
      const raw = await requestBody(req, 160 * 1024);
      const common = z.object({
        organizationId: z.string().uuid(),
        documentId: z.string().uuid(),
        expectedLockVersion: z.number().int().positive(),
      }).strict();

      if (path === `${BASE_PATH}/knowledge/create`) {
        const input = z.object({ organizationId: z.string().uuid(), document: knowledgeDraftSchema }).strict().safeParse(raw);
        if (!input.success) fail(400, 'Document invalide.', 'invalid_knowledge_document');
        const organization = organizationFromBody(input.data.organizationId, session.me);
        const d = input.data.document;
        const result = await safeRpc<unknown>(
          env,
          'admin_knowledge_create',
          {
            p_organization_id: organization,
            p_title: d.title,
            p_category: d.category,
            p_version: d.version,
            p_content: d.content,
            p_summary: d.summary || null,
            p_locale: d.locale,
            p_market: d.market,
            p_tags: d.tags,
            p_source_url: d.sourceUrl || null,
            p_effective_from: d.effectiveFrom,
            p_effective_until: d.effectiveUntil,
          },
          session.accessToken,
        );
        const id = z.string().uuid().safeParse(result);
        if (!id.success) fail(502, 'Création documentaire non confirmée.', 'invalid_knowledge_create_response');
        return json({ ok: true, id: id.data }, 201, session.cookies);
      }

      if (path === `${BASE_PATH}/knowledge/update`) {
        const input = z.object({
          organizationId: z.string().uuid(),
          documentId: z.string().uuid(),
          expectedLockVersion: z.number().int().positive(),
          document: knowledgeDraftSchema,
        }).strict().safeParse(raw);
        if (!input.success) fail(400, 'Document invalide.', 'invalid_knowledge_document');
        const organization = organizationFromBody(input.data.organizationId, session.me);
        const d = input.data.document;
        const result = await safeRpc<unknown>(
          env,
          'admin_knowledge_update',
          {
            p_organization_id: organization,
            p_document_id: input.data.documentId,
            p_expected_lock_version: input.data.expectedLockVersion,
            p_title: d.title,
            p_category: d.category,
            p_version: d.version,
            p_content: d.content,
            p_summary: d.summary || null,
            p_locale: d.locale,
            p_market: d.market,
            p_tags: d.tags,
            p_source_url: d.sourceUrl || null,
            p_effective_from: d.effectiveFrom,
            p_effective_until: d.effectiveUntil,
          },
          session.accessToken,
        );
        const lockVersion = z.number().int().positive().safeParse(result);
        if (!lockVersion.success) fail(502, 'Mise à jour non confirmée.', 'invalid_knowledge_update_response');
        return json({ ok: true, lockVersion: lockVersion.data }, 200, session.cookies);
      }

      if (path === `${BASE_PATH}/knowledge/review`) {
        const input = common.safeParse(raw);
        if (!input.success) fail(400, 'Demande de revue invalide.', 'invalid_knowledge_review');
        const organization = organizationFromBody(input.data.organizationId, session.me);
        const result = await safeRpc<unknown>(
          env,
          'admin_knowledge_submit_review',
          { p_organization_id: organization, p_document_id: input.data.documentId, p_expected_lock_version: input.data.expectedLockVersion },
          session.accessToken,
        );
        const lockVersion = z.number().int().positive().safeParse(result);
        if (!lockVersion.success) fail(502, 'Revue non confirmée.', 'invalid_knowledge_review_response');
        return json({ ok: true, lockVersion: lockVersion.data }, 200, session.cookies);
      }

      if (path === `${BASE_PATH}/knowledge/publish`) {
        const input = common.safeParse(raw);
        if (!input.success) fail(400, 'Publication invalide.', 'invalid_knowledge_publish');
        const organization = organizationFromBody(input.data.organizationId, session.me);
        const current = await safeRpc<unknown>(
          env,
          'admin_knowledge_get',
          { p_organization_id: organization, p_document_id: input.data.documentId },
          session.accessToken,
        );
        const parsed = knowledgeDocumentSchema.safeParse(current);
        if (!parsed.success) fail(409, 'Le document doit être rechargé avant publication.', 'knowledge_document_refresh_required');
        const chunks = chunkKnowledge(parsed.data.content);
        if (!chunks.length) fail(400, 'Le document ne contient aucun contenu indexable.', 'knowledge_empty');
        const result = await safeRpc<unknown>(
          env,
          'admin_knowledge_publish',
          {
            p_organization_id: organization,
            p_document_id: input.data.documentId,
            p_expected_lock_version: input.data.expectedLockVersion,
            p_chunks: chunks,
          },
          session.accessToken,
        );
        const lockVersion = z.number().int().positive().safeParse(result);
        if (!lockVersion.success) fail(502, 'Publication non confirmée.', 'invalid_knowledge_publish_response');
        return json({ ok: true, lockVersion: lockVersion.data, chunks: chunks.length }, 200, session.cookies);
      }

      if (path === `${BASE_PATH}/knowledge/archive`) {
        const input = common.safeParse(raw);
        if (!input.success) fail(400, 'Archivage invalide.', 'invalid_knowledge_archive');
        const organization = organizationFromBody(input.data.organizationId, session.me);
        const result = await safeRpc<unknown>(
          env,
          'admin_knowledge_archive',
          { p_organization_id: organization, p_document_id: input.data.documentId, p_expected_lock_version: input.data.expectedLockVersion },
          session.accessToken,
        );
        const lockVersion = z.number().int().positive().safeParse(result);
        if (!lockVersion.success) fail(502, 'Archivage non confirmé.', 'invalid_knowledge_archive_response');
        return json({ ok: true, lockVersion: lockVersion.data }, 200, session.cookies);
      }

      if (path === `${BASE_PATH}/knowledge/revision`) {
        const input = z.object({
          organizationId: z.string().uuid(),
          documentId: z.string().uuid(),
          version: z.string().trim().min(1).max(80),
        }).strict().safeParse(raw);
        if (!input.success) fail(400, 'Nouvelle version invalide.', 'invalid_knowledge_revision');
        const organization = organizationFromBody(input.data.organizationId, session.me);
        const result = await safeRpc<unknown>(
          env,
          'admin_knowledge_create_revision',
          { p_organization_id: organization, p_document_id: input.data.documentId, p_version: input.data.version },
          session.accessToken,
        );
        const id = z.string().uuid().safeParse(result);
        if (!id.success) fail(502, 'Création de version non confirmée.', 'invalid_knowledge_revision_response');
        return json({ ok: true, id: id.data }, 201, session.cookies);
      }

      if (path === `${BASE_PATH}/knowledge/search`) {
        const input = z.object({
          organizationId: z.string().uuid(),
          query: z.string().trim().min(2).max(500),
          limit: z.number().int().min(1).max(8).default(3),
          locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).nullable().default(null),
          market: z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,15}$/).nullable().default(null),
        }).strict().safeParse(raw);
        if (!input.success) fail(400, 'Recherche documentaire invalide.', 'invalid_knowledge_search');
        const organization = organizationFromBody(input.data.organizationId, session.me);
        const result = await safeRpc<unknown>(
          env,
          'knowledge_search',
          { p_organization_id: organization, p_query: input.data.query, p_limit: input.data.limit, p_locale: input.data.locale, p_market: input.data.market },
          session.accessToken,
        );
        const resultSchema = z.array(z.object({
          document_id: z.string().uuid(),
          chunk_id: z.string().uuid(),
          title: z.string().max(240),
          category: z.string().max(120),
          version: z.string().max(80),
          locale: z.string(),
          market: z.string(),
          effective_from: z.string().nullable(),
          effective_until: z.string().nullable(),
          chunk_ordinal: z.number().int().nonnegative(),
          content: z.string().max(4000),
          rank: z.number().nonnegative(),
        })).max(8);
        const parsed = resultSchema.safeParse(result);
        if (!parsed.success) fail(502, 'Résultats documentaires invalides.', 'invalid_knowledge_search_response');
        return json({ results: parsed.data }, 200, session.cookies);
      }

      return json({ error: 'Ressource introuvable.', code: 'not_found' }, 404, session.cookies);
    }

    if (path === `${BASE_PATH}/settings` || path === `${BASE_PATH}/settings/preview`) {
      const organization = organizationId(url, session.me);
      if (organization !== env.SUPABASE_ORGANIZATION_ID)
        fail(403, 'Les réglages concernent uniquement l’organisation de ce déploiement.', 'deployment_organization_only');
      const environment = environmentLabel(env, req.url);
      const scope = scopeKey(env, req.url);
      const canEdit = session.me.memberships.some(item => item.organization_id === organization && item.role === 'super_admin');
      if (req.method === 'GET' && path.endsWith('/settings')) {
        const saved = await readSettings(env.DB, scope);
        const history = await env.DB.prepare('SELECT revision,config,actor,created_at FROM runtime_settings WHERE scope=? ORDER BY revision DESC LIMIT 10').bind(scope).all<Revision>();
        const config = saved ? runtimeConfigSchema.parse(JSON.parse(saved.config)) : defaults(env);
        const state = publicModelConfig(applyConfig(env, config));
        try { validateConfig(env, config); }
        catch (cause) { state.ready = false; state.blockedReason = cause instanceof Error ? cause.message : 'Fournisseur désactivé côté serveur.'; }
        return json({ environment, canEdit, revision: saved?.revision ?? 0,
          config, effectiveProvider: state.ready ? state.provider : 'demo', providerWarning: state.blockedReason,
          providers: availableProviders(env), budget: env.LLM_BUDGET_MODE ?? 'zero',
          scope: 'Chat de démonstration · dossiers D1 + base de connaissances Supabase publiée',
          history: history.results.map(item => ({ revision: item.revision, actor: item.actor, createdAt: item.created_at, config: runtimeConfigSchema.parse(JSON.parse(item.config)) })) }, 200, session.cookies);
      }
      if (req.method === 'POST') {
        guardMutation(req, env);
        if (!canEdit) fail(403, 'Seul le super-administrateur peut modifier les réglages.', 'settings_role_denied');
        if (path.endsWith('/preview')) {
          const input = z.object({ query: z.string().trim().min(3).max(1000), ragResults: z.number().int().min(1).max(3), ragMinAnchors: z.number().int().min(1).max(3) }).strict().safeParse(await requestBody(req));
          if (!input.success) fail(400, 'Paramètres de recherche invalides.', 'invalid_preview');
          return json({ documents: retrieve(input.data.query, input.data.ragResults, input.data.ragMinAnchors) }, 200, session.cookies);
        }
        const input = z.object({ revision: z.number().int().min(0), config: runtimeConfigSchema, confirmEnvironment: z.string() }).strict().safeParse(await requestBody(req));
        if (!input.success) fail(400, 'Réglages invalides.', 'invalid_settings');
        if (environment === 'NON CONFIGURÉ' || input.data.confirmEnvironment !== environment)
          fail(400, 'Confirmez l’environnement avant d’enregistrer.', 'environment_confirmation_required');
        try { validateConfig(env, input.data.config); }
        catch (error) { fail(400, error instanceof Error ? error.message : 'Fournisseur non autorisé.', 'provider_not_allowed'); }
        const saved = await saveSettings(env.DB, scope, input.data.revision, input.data.config, session.me.user_id);
        if (!saved) fail(409, 'Une autre modification a été enregistrée. Actualisez avant de réessayer.', 'version_conflict');
        return json({ ok: true, revision: input.data.revision + 1 }, 200, session.cookies);
      }
      return json({ error: 'Méthode non autorisée.', code: 'method_not_allowed' }, 405, session.cookies);
    }

    if (path === `${BASE_PATH}/overview` && req.method === 'GET') {
      const organization = organizationId(url, session.me);
      const days = Math.max(1, Math.min(Number(url.searchParams.get('days') ?? 30) || 30, 90));
      const result = await safeRpc<unknown>(
        env,
        'admin_overview',
        { p_organization_id: organization, p_days: days },
        session.accessToken,
      );
      const parsed = overviewSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Vue d’ensemble invalide.', 'invalid_overview_response');
      return json({ overview: parsed.data }, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/queue` && req.method === 'GET') {
      const organization = organizationId(url, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_queue',
        { p_organization_id: organization },
        session.accessToken,
      );
      const parsed = queueSchema.safeParse(result);
      if (!parsed.success) fail(502, 'File opérationnelle invalide.', 'invalid_queue_response');
      return json({ queue: parsed.data }, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case` && req.method === 'GET') {
      const organization = organizationId(url, session.me);
      const caseId = url.searchParams.get('caseId') ?? '';
      if (!z.string().uuid().safeParse(caseId).success)
        fail(400, 'Dossier invalide.', 'invalid_case_id');
      const result = await safeRpc<unknown>(
        env,
        'admin_case_detail_v2',
        { p_organization_id: organization, p_case_id: caseId },
        session.accessToken,
      );
      const parsed = caseDetailSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Détail du dossier invalide.', 'invalid_case_detail_response');
      if (!parsed.data) fail(404, 'Dossier introuvable.', 'case_not_found');
      return json({ case: parsed.data }, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case/options` && req.method === 'GET') {
      const organization = organizationId(url, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_case_form_options',
        { p_organization_id: organization },
        session.accessToken,
      );
      const parsed = caseFormOptionsSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Options de dossier invalides.', 'invalid_case_options_response');
      return json(parsed.data, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case/create` && req.method === 'POST') {
      guardMutation(req, env);
      const input = caseCreateInputSchema.safeParse(await requestBody(req));
      if (!input.success) fail(400, 'Nouveau dossier invalide.', 'invalid_case_create');
      const organization = organizationFromBody(input.data.organizationId, session.me);
      const customer = input.data.customer;
      const product = input.data.product;
      const result = await safeRpc<unknown>(
        env,
        'admin_create_case',
        {
          p_organization_id: organization,
          p_payload: {
            service_type: input.data.serviceType,
            kind: input.data.kind,
            title: input.data.title,
            description: input.data.description,
            customer_id: input.data.customerId,
            customer_external_id: customer?.externalId ?? null,
            customer_first_name: customer?.firstName ?? null,
            customer_last_name: customer?.lastName ?? null,
            customer_email: customer?.email ?? null,
            customer_phone: customer?.phone ?? null,
            product_id: input.data.productId,
            product_external_id: product?.externalId ?? null,
            product_sku: product?.sku ?? null,
            product_name: product?.name ?? null,
            product_category: product?.category ?? null,
            product_serial_number: product?.serialNumber ?? null,
            store_id: input.data.storeId,
            warranty_status: input.data.warrantyStatus,
            warranty_label: input.data.warrantyLabel,
            quote_cents: input.data.quoteCents,
            refund_cents: input.data.refundCents,
            currency: input.data.currency,
            delivery_mode: input.data.deliveryMode,
            estimated_at: input.data.estimatedAt,
          },
          p_request_id: input.data.requestId,
        },
        session.accessToken,
      );
      const parsed = accessCodeResultSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Création du dossier non confirmée.', 'invalid_case_create_response');
      return json(parsed.data, 201, session.cookies);
    }

    if (path === `${BASE_PATH}/case/update` && req.method === 'POST') {
      guardMutation(req, env);
      const input = caseUpdateInputSchema.safeParse(await requestBody(req));
      if (!input.success) fail(400, 'Modification du dossier invalide.', 'invalid_case_update');
      const organization = organizationFromBody(input.data.organizationId, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_update_case',
        {
          p_organization_id: organization,
          p_case_id: input.data.caseId,
          p_expected_version: input.data.expectedVersion,
          p_payload: {
            title: input.data.title,
            description: input.data.description,
            customer_id: input.data.customerId,
            product_id: input.data.productId,
            store_id: input.data.storeId,
            warranty_status: input.data.warrantyStatus,
            warranty_label: input.data.warrantyLabel,
            quote_cents: input.data.quoteCents,
            refund_cents: input.data.refundCents,
            currency: input.data.currency,
            delivery_mode: input.data.deliveryMode,
            estimated_at: input.data.estimatedAt,
          },
          p_request_id: input.data.requestId,
        },
        session.accessToken,
      );
      const parsed = caseMutationResultSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Modification du dossier non confirmée.', 'invalid_case_update_response');
      return json(parsed.data, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case/transition` && req.method === 'POST') {
      guardMutation(req, env);
      const input = caseTransitionInputSchema.safeParse(await requestBody(req));
      if (!input.success) fail(400, 'Transition de dossier invalide.', 'invalid_case_transition');
      const organization = organizationFromBody(input.data.organizationId, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_transition_case',
        {
          p_organization_id: organization,
          p_case_id: input.data.caseId,
          p_expected_version: input.data.expectedVersion,
          p_status: input.data.status,
          p_note: input.data.note,
          p_customer_visible: input.data.customerVisible,
          p_request_id: input.data.requestId,
        },
        session.accessToken,
      );
      const parsed = caseMutationResultSchema
        .extend({ status: z.string().max(50) })
        .safeParse(result);
      if (!parsed.success) fail(502, 'Transition non confirmée.', 'invalid_case_transition_response');
      return json(parsed.data, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case/access-code` && req.method === 'POST') {
      guardMutation(req, env);
      const input = caseAccessRotateInputSchema.safeParse(await requestBody(req));
      if (!input.success) fail(400, 'Renouvellement du code invalide.', 'invalid_case_access_rotation');
      const organization = organizationFromBody(input.data.organizationId, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_rotate_case_access_code',
        {
          p_organization_id: organization,
          p_case_id: input.data.caseId,
          p_expected_version: input.data.expectedVersion,
          p_request_id: input.data.requestId,
        },
        session.accessToken,
      );
      const parsed = accessCodeResultSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Renouvellement du code non confirmé.', 'invalid_case_access_response');
      return json(parsed.data, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case/archive` && req.method === 'POST') {
      guardMutation(req, env);
      const input = caseArchiveInputSchema.safeParse(await requestBody(req));
      if (!input.success) fail(400, 'Archivage du dossier invalide.', 'invalid_case_archive');
      const organization = organizationFromBody(input.data.organizationId, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_archive_case',
        {
          p_organization_id: organization,
          p_case_id: input.data.caseId,
          p_expected_version: input.data.expectedVersion,
          p_reason: input.data.reason,
          p_request_id: input.data.requestId,
        },
        session.accessToken,
      );
      const parsed = caseMutationResultSchema
        .extend({ archived: z.literal(true) })
        .safeParse(result);
      if (!parsed.success) fail(502, 'Archivage du dossier non confirmé.', 'invalid_case_archive_response');
      return json(parsed.data, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case/note` && req.method === 'POST') {
      guardMutation(req, env);
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          caseId: z.string().uuid(),
          version: z.number().int().positive(),
          note: z.string().trim().min(3).max(4000),
          visible: z.boolean(),
          requestId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
        })
        .strict()
        .safeParse(await requestBody(req));
      if (!parsed.success) fail(400, 'Note invalide.', 'invalid_note');
      const organization = organizationFromBody(parsed.data.organizationId, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_add_note',
        {
          p_organization_id: organization,
          p_case_id: parsed.data.caseId,
          p_version: parsed.data.version,
          p_note: parsed.data.note,
          p_visible: parsed.data.visible,
          p_request_id: parsed.data.requestId,
        },
        session.accessToken,
      );
      const response = z
        .object({
          ok: z.literal(true),
          version: z.number().int().positive(),
          event_id: z.string().uuid(),
        })
        .strict()
        .safeParse(result);
      if (!response.success) fail(502, 'Confirmation de note invalide.', 'invalid_note_response');
      return json(response.data, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/handoff` && req.method === 'POST') {
      guardMutation(req, env);
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          handoffId: z.string().uuid(),
          status: z.enum(['assigned', 'resolved']),
          expectedUpdatedAt: z.string().datetime({ offset: true }),
        })
        .strict()
        .safeParse(await requestBody(req));
      if (!parsed.success) fail(400, 'Relais invalide.', 'invalid_handoff');
      const organization = organizationFromBody(parsed.data.organizationId, session.me);
      const result = await safeRpc<unknown>(
        env,
        'admin_manage_handoff',
        {
          p_organization_id: organization,
          p_handoff_id: parsed.data.handoffId,
          p_status: parsed.data.status,
          p_expected_updated_at: parsed.data.expectedUpdatedAt,
        },
        session.accessToken,
      );
      const response = z.object({ ok: z.literal(true) }).strict().safeParse(result);
      if (!response.success) fail(502, 'Confirmation de relais invalide.', 'invalid_handoff_response');
      return json(response.data, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/audit` && req.method === 'GET') {
      const organization = organizationId(url, session.me);
      const offset = Math.max(0, Math.min(Number(url.searchParams.get('offset') ?? 0) || 0, 100000));
      const result = await safeRpc<unknown>(
        env,
        'admin_audit',
        { p_organization_id: organization, p_offset: offset },
        session.accessToken,
      );
      const parsed = auditSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Journal d’audit invalide.', 'invalid_audit_response');
      return json({ audit: parsed.data }, 200, session.cookies);
    }

    return json({ error: 'Ressource introuvable.', code: 'not_found' }, 404, session.cookies);
  } catch (error) {
    if (error instanceof AdminOperationsError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SupabaseRequestError)
      return json(
        {
          error: 'Le service de données est temporairement indisponible.',
          code: error.code === 'upstream_timeout' ? 'data_timeout' : 'data_unavailable',
        },
        error.status === 429 ? 429 : 503,
      );
    console.error('admin_operations_unhandled', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Une erreur interne est survenue.', code: 'internal_error' }, 500);
  }
}
