import { z } from 'zod';
import { boundedJson, JsonLimitError } from './bounded-json';
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
    title: z.string().max(180),
    description: z.string().max(6000),
    kind: z.string().max(40),
    status: z.string().max(50),
    version: z.number().int().positive(),
    updated_at: z.string(),
    estimated_at: z.string().nullable(),
    created_at: z.string(),
    closed_at: z.string().nullable(),
    source_system: z.string().max(120).nullable(),
    source_updated_at: z.string().nullable(),
    warranty_label: z.string().max(240).nullable(),
    quote_cents: z.number().int().nonnegative().nullable(),
    refund_cents: z.number().int().nonnegative().nullable(),
    currency: z.string().length(3),
    product: z.string().max(240).nullable(),
    store: z.string().max(240).nullable(),
    customer: z.string().max(320).nullable(),
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

function guardMutation(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin)
    fail(403, 'Requête externe refusée.', 'invalid_origin');
  if (req.headers.get('sec-fetch-site') === 'cross-site')
    fail(403, 'Requête externe refusée.', 'cross_site_request');
}

async function requestBody(req: Request) {
  if (!req.headers.get('content-type')?.toLowerCase().includes('application/json'))
    fail(415, 'Une requête JSON est requise.', 'json_required');
  try {
    const value = await boundedJson(req, 16 * 1024);
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
        'admin_case_detail',
        { p_organization_id: organization, p_case_id: caseId },
        session.accessToken,
      );
      const parsed = caseDetailSchema.safeParse(result);
      if (!parsed.success) fail(502, 'Détail du dossier invalide.', 'invalid_case_detail_response');
      if (!parsed.data) fail(404, 'Dossier introuvable.', 'case_not_found');
      return json({ case: parsed.data }, 200, session.cookies);
    }

    if (path === `${BASE_PATH}/case/note` && req.method === 'POST') {
      guardMutation(req);
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
      guardMutation(req);
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
