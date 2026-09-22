import { caseSchema } from './case-schema';
import { bindProductionCaseSession, caseSessionHash, CaseAccessError } from './case-adapter';
import { productionChat } from './production-chat';
import { releaseConfigurationState } from './p1-release';
import {
  MfaError,
  mfaError,
  mfaUser,
  mfaScope,
  cachedEnrollment,
  enrollMfa,
  withMfaLock,
} from './mfa-enrollment';
import { z } from 'zod';
import {
  effectiveEnvironment,
  environmentLabel,
  type RuntimeEnv,
} from './runtime-settings';
import { boundedJson, JsonLimitError } from './bounded-json';
import { mutationOriginAllowed } from './request-security';
import type { Database } from './api';
import {
  jwtClaims,
  publicSupabaseState,
  SupabaseConfigError,
  SupabaseRequestError,
  supabaseRequest,
  supabaseSettings,
  type SupabaseRuntimeEnv,
} from './supabase';

export interface ProductionEnv extends SupabaseRuntimeEnv, RuntimeEnv {
  DB: Database;
}

const CASE_COOKIE = 'savsc_case_access';
const ADMIN_ACCESS_COOKIE = 'savsc_admin_access';
const ADMIN_REFRESH_COOKIE = 'savsc_admin_refresh';
const PREAUTH_ACCESS_COOKIE = 'savsc_admin_preauth';
const PREAUTH_REFRESH_COOKIE = 'savsc_admin_preauth_refresh';
const FIFTEEN_MINUTES = 15 * 60 * 1000;

class ProductionApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'request_failed',
  ) {
    super(message);
  }
}

const caseSessionSchema = z
  .object({
    access_token: z.string().regex(/^[a-f0-9]{64}$/),
    expires_at: z.string(),
    case: caseSchema,
  })
  .strict();

const currentCaseSchema = z.object({ expires_at: z.string(), case: caseSchema }).strict();

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
  // Supabase refresh tokens are opaque implementation details. Do not reject
  // an otherwise valid Supabase session because of an arbitrary minimum length.
  refresh_token: z.string().min(1).max(8000),
  expires_in: z.number().int().positive().max(86400).optional(),
  user: z
    .object({
      id: z.string().uuid(),
      email: z.string().email().nullable().optional(),
      // Depending on the Auth response and MFA state, factors can be omitted,
      // null, or an array.
      factors: z
        .array(
          z
            .object({
              id: z.string().uuid(),
              factor_type: z.string(),
              status: z.string(),
              friendly_name: z.string().nullable().optional(),
            })
            .passthrough(),
        )
        .nullish(),
    })
    .passthrough(),
});

const p1ReleaseMetricsSchema = z
  .object({
    generated_at: z.string(),
    period_hours: z.number().int().min(1).max(168),
    events: z.number().int().nonnegative(),
    release_modes: z.record(z.string(), z.number().int().nonnegative()),
    canary: z
      .object({
        selected: z.number().int().nonnegative(),
        attempted: z.number().int().nonnegative(),
        released: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
        release_rate: z.number().min(0).max(100).nullable(),
      })
      .strict(),
    quality: z
      .object({
        invariant_violations: z.number().int().nonnegative(),
        generation_failed: z.number().int().nonnegative(),
        validation_failed: z.number().int().nonnegative(),
        evidence_invalidated: z.number().int().nonnegative(),
        invalid_candidate: z.number().int().nonnegative(),
        configuration_blocked: z.number().int().nonnegative(),
      })
      .strict(),
    latency: z
      .object({
        p50_ms: z.number().nonnegative().nullable(),
        p95_ms: z.number().nonnegative().nullable(),
      })
      .strict(),
    usage: z
      .object({
        provider_calls: z.number().int().nonnegative(),
        input_tokens: z.number().int().nonnegative().nullable(),
        output_tokens: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    by_reason: z.record(z.string(), z.number().int().nonnegative()),
    by_plan: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

const releaseTelemetryResponseSchema = z
  .object({
    metadata: z
      .object({
        requestId: z.string().uuid(),
        provider: z.string().min(1).max(40),
        model: z.string().min(1).max(160).nullable(),
        providerCalls: z.number().int().min(0).max(10),
        inputTokens: z.number().int().min(0).max(1_000_000).nullable(),
        outputTokens: z.number().int().min(0).max(1_000_000).nullable(),
        latencyMs: z.number().min(0).max(300_000),
        generation: z
          .object({
            outcome: z.enum(['skipped', 'candidate_generated', 'failed']),
          })
          .passthrough()
          .nullable(),
        validation: z
          .object({
            outcome: z.enum(['skipped', 'supported_candidate', 'blocked', 'abstained']),
          })
          .passthrough()
          .nullable(),
        release: z
          .object({
            mode: z.enum(['off', 'shadow', 'canary', 'on']),
            cohort: z.boolean(),
            cohortBucket: z.number().int().min(0).max(99).nullable(),
            canaryPercent: z.number().int().min(0).max(100),
            attempted: z.boolean(),
            released: z.boolean(),
            reason: z
              .enum([
                'disabled',
                'shadow_only',
                'not_in_canary',
                'ineligible_plan',
                'configuration',
                'generation_failed',
                'validation_failed',
                'evidence_changed',
                'knowledge_unavailable',
                'hybrid_unavailable',
                'grounding_failure',
                'invalid_candidate',
              ])
              .nullable(),
            plan: z
              .enum([
                'respond',
                'clarify',
                'case',
                'knowledge',
                'case_and_knowledge',
                'handoff',
                'unsupported_action',
              ])
              .nullable(),
            // Parsed to lock the internal response contract, deliberately NOT persisted.
            evidenceCaseVersion: z.number().int().positive().nullable(),
            knowledgeSourceCount: z.number().int().min(0).max(3),
          })
          .strict()
          .nullable(),
      })
      .passthrough(),
  })
  .passthrough();

const dashboardSchema = z
  .object({
    generated_at: z.string(),
    cases: z.object({
      total: z.number().int().nonnegative(),
      open: z.number().int().nonnegative(),
      overdue: z.number().int().nonnegative(),
      resolved_30d: z.number().int().nonnegative(),
    }),
    handoffs: z.object({ open: z.number().int().nonnegative() }),
    assistant: z.object({
      messages_24h: z.number().int().nonnegative(),
      conversations_30d: z.number().int().nonnegative(),
    }),
    performance: z.object({
      requests_24h: z.number().int().nonnegative(),
      error_rate_24h: z.number().nonnegative(),
      avg_latency_ms_24h: z.number().nonnegative(),
    }),
    by_status: z.record(z.string(), z.number().int().nonnegative()),
    by_kind: z.record(z.string(), z.number().int().nonnegative()),
  })
  .strict();

function fail(status: number, message: string, code?: string): never {
  throw new ProductionApiError(status, message, code);
}

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
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));
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

function guardMutation(req: Request, env: ProductionEnv) {
  if (!mutationOriginAllowed(req, env))
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
    if (error instanceof ProductionApiError) throw error;
    fail(400, 'Le JSON est invalide.', 'invalid_json');
  }
}

async function sha256(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function networkKey(req: Request, purpose: string) {
  const day = new Date().toISOString().slice(0, 10);
  const address = req.headers.get('cf-connecting-ip') ?? 'local';
  return `${purpose}:${await sha256(`${day}:${address}`)}`;
}

async function reserveRate(db: Database | undefined, id: string, limit: number, windowMs: number) {
  if (!db) fail(503, 'Protection anti-abus indisponible.', 'rate_store_unavailable');
  if (limit <= 0) fail(429, 'Le budget de requêtes est épuisé.', 'rate_limited');
  const now = Date.now();
  const reserved = await db
    .prepare(
      'INSERT INTO rate_buckets (id,count,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END,expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END WHERE count<? OR expires_at<=? RETURNING count',
    )
    .bind(id, now + windowMs, now, now, now + windowMs, limit, now)
    .first();
  if (!reserved) fail(429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'rate_limited');
}

function rpc<T>(
  env: ProductionEnv,
  functionName: string,
  body: Record<string, unknown>,
  mode: { kind: 'privileged' } | { kind: 'user'; accessToken: string },
) {
  return supabaseRequest<T>(env, `/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    body,
    mode,
  });
}

function adminCookies(req: Request, session: z.infer<typeof authSessionSchema>) {
  const ttl = Math.max(60, Math.min(session.expires_in ?? 3600, 3600));
  return [
    sessionCookie(req, ADMIN_ACCESS_COOKIE, session.access_token, ttl),
    sessionCookie(req, ADMIN_REFRESH_COOKIE, session.refresh_token, 30 * 24 * 60 * 60),
    clearCookie(req, PREAUTH_ACCESS_COOKIE),
    clearCookie(req, PREAUTH_REFRESH_COOKIE),
  ];
}

function preauthCookies(req: Request, session: z.infer<typeof authSessionSchema>) {
  return [
    sessionCookie(req, PREAUTH_ACCESS_COOKIE, session.access_token, 10 * 60),
    sessionCookie(req, PREAUTH_REFRESH_COOKIE, session.refresh_token, 10 * 60),
    clearCookie(req, ADMIN_ACCESS_COOKIE),
    clearCookie(req, ADMIN_REFRESH_COOKIE),
  ];
}

function allAdminCookiesCleared(req: Request) {
  return [
    clearCookie(req, ADMIN_ACCESS_COOKIE),
    clearCookie(req, ADMIN_REFRESH_COOKIE),
    clearCookie(req, PREAUTH_ACCESS_COOKIE),
    clearCookie(req, PREAUTH_REFRESH_COOKIE),
  ];
}

async function adminMe(env: ProductionEnv, accessToken: string) {
  const result = await rpc<unknown>(env, 'admin_me', {}, { kind: 'user', accessToken });
  const parsed = adminMeSchema.safeParse(result);
  if (!parsed.success) fail(502, 'Réponse d’identité invalide.', 'invalid_identity_response');
  if (!parsed.data.memberships.length)
    fail(403, 'Ce compte ne possède aucun accès administrateur actif.', 'not_an_admin');
  return parsed.data;
}

async function passwordLogin(env: ProductionEnv, email: string, password: string) {
  const result = await supabaseRequest<unknown>(env, '/auth/v1/token?grant_type=password', {
    mode: { kind: 'publishable' },
    method: 'POST',
    body: { email, password },
  });

  const parsed = authSessionSchema.safeParse(result);
  if (!parsed.success) {
    // Never log tokens or credentials. Only log Zod paths/codes so an upstream
    // response-shape change can be diagnosed safely.
    console.error(
      'invalid_auth_response_schema',
      parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    );
    fail(502, 'Réponse de connexion invalide.', 'invalid_auth_response');
  }

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
  let refreshed: z.infer<typeof authSessionSchema> | null = null;
  if (accessToken) {
    try {
      const me = await adminMe(env, accessToken);
      if (me.aal !== 'aal2') fail(403, 'La double authentification est requise.', 'mfa_required');
      return { accessToken, me, cookies: [] as string[] };
    } catch (error) {
      if (error instanceof ProductionApiError) throw error;
      if (!(error instanceof SupabaseRequestError) || ![401, 403].includes(error.status)) throw error;
    }
  }
  if (!refreshToken) fail(401, 'Votre session a expiré.', 'admin_session_expired');
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
  return { accessToken, me, cookies: adminCookies(req, refreshed) };
}

function factorList(session: z.infer<typeof authSessionSchema>) {
  return (session.user.factors ?? [])
    .filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified')
    .map((factor) => ({ id: factor.id, friendlyName: factor.friendly_name ?? 'Application d’authentification' }));
}

function publicAdmin(me: z.infer<typeof adminMeSchema>) {
  return {
    userId: me.user_id,
    email: me.email,
    aal: me.aal,
    memberships: me.memberships.map((membership) => ({
      organizationId: membership.organization_id,
      organizationName: membership.organization_name,
      role: membership.role,
      displayName: membership.display_name,
    })),
  };
}

async function handleCaseRoutes(req: Request, env: ProductionEnv, path: string) {
  const settings = supabaseSettings(env);
  if (path === '/api/production/cases/verify' && req.method === 'POST') {
    guardMutation(req, env);
    const parsed = z
      .object({
        reference: z
          .string()
          .trim()
          .min(6)
          .max(64)
          .regex(/^[A-Za-z0-9-]+$/),
        code: z.string().regex(/^\d{6,12}$/),
      })
      .strict()
      .safeParse(await requestBody(req));
    if (!parsed.success)
      fail(400, 'Saisissez une référence et un code valides.', 'invalid_case_credentials');
    await reserveRate(env.DB, await networkKey(req, 'case-ip'), 15, FIFTEEN_MINUTES);
    await reserveRate(
      env.DB,
      `case-ref:${await sha256(`${settings.organizationId}:${parsed.data.reference.toUpperCase()}`)}`,
      5,
      FIFTEEN_MINUTES,
    );
    let result: unknown;
    try {
      result = await rpc(
        env,
        'customer_open_case_session',
        {
          p_organization_id: settings.organizationId,
          p_reference: parsed.data.reference,
          p_code: parsed.data.code,
        },
        { kind: 'privileged' },
      );
    } catch (error) {
      if (error instanceof SupabaseRequestError && error.status < 500)
        fail(403, 'Référence ou code incorrect.', 'invalid_case_credentials');
      throw error;
    }
    if (
      result &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      (result as Record<string, unknown>).error === 'invalid_case_credentials'
    )
      fail(403, 'Référence ou code incorrect.', 'invalid_case_credentials');
    const session = caseSessionSchema.safeParse(result);
    if (!session.success) fail(502, 'Réponse du dossier invalide.', 'invalid_case_response');
    if (session.data.case.reference.toUpperCase() !== parsed.data.reference.toUpperCase())
      fail(502, 'Réponse du dossier invalide.', 'invalid_case_response');
    if (env.LLM_ORCHESTRATOR === 'structured')
      await bindProductionCaseSession(
        env,
        session.data.access_token,
        session.data.case.id,
        session.data.expires_at,
      );
    const expiresAt = Date.parse(session.data.expires_at);
    const maxAge = Number.isFinite(expiresAt)
      ? Math.max(60, Math.min(Math.floor((expiresAt - Date.now()) / 1000), 30 * 60))
      : 30 * 60;
    return json({ case: session.data.case, expiresAt: session.data.expires_at }, 200, [
      sessionCookie(req, CASE_COOKIE, session.data.access_token, maxAge),
    ]);
  }
  if (path === '/api/production/cases/current' && req.method === 'GET') {
    const accessToken = cookie(req, CASE_COOKIE);
    if (!accessToken) fail(401, 'Vérifiez votre dossier pour continuer.', 'case_session_required');
    try {
      const result = await rpc<unknown>(
        env,
        'customer_case_snapshot',
        { p_access_token: accessToken },
        { kind: 'privileged' },
      );
      const current = currentCaseSchema.safeParse(result);
      if (!current.success) fail(502, 'Réponse du dossier invalide.', 'invalid_case_response');
      return json({ case: current.data.case, expiresAt: current.data.expires_at });
    } catch (error) {
      if (error instanceof SupabaseRequestError && error.status < 500)
        return json(
          { error: 'Votre accès au dossier a expiré.', code: 'case_session_expired' },
          401,
          [clearCookie(req, CASE_COOKIE)],
        );
      throw error;
    }
  }
  if (path === '/api/production/cases/current' && req.method === 'DELETE') {
    guardMutation(req, env);
    const accessToken = cookie(req, CASE_COOKIE);
    if (accessToken)
      await rpc(
        env,
        'customer_close_case_session',
        { p_access_token: accessToken },
        { kind: 'privileged' },
      );
    if (accessToken)
      await env.DB.prepare('DELETE FROM spaces WHERE token_hash=?')
        .bind(await caseSessionHash(settings.organizationId, accessToken))
        .run();
    return json({ ok: true }, 200, [clearCookie(req, CASE_COOKIE)]);
  }
  return null;
}

async function handleAdminRoutes(req: Request, env: ProductionEnv, path: string) {
  if (path === '/api/production/admin/login' && req.method === 'POST') {
    guardMutation(req, env);
    await reserveRate(env.DB, await networkKey(req, 'admin-login'), 10, FIFTEEN_MINUTES);
    const parsed = z
      .object({
        email: z.string().trim().email().max(320),
        password: z.string().min(8).max(1024),
      })
      .strict()
      .safeParse(await requestBody(req));
    if (!parsed.success) fail(400, 'Email ou mot de passe invalide.', 'invalid_login');
    let session: z.infer<typeof authSessionSchema>;
    try {
      session = await passwordLogin(env, parsed.data.email, parsed.data.password);
    } catch (error) {
      if (error instanceof SupabaseRequestError && error.status < 500)
        fail(401, 'Email ou mot de passe incorrect.', 'invalid_login');
      throw error;
    }
    const me = await adminMe(env, session.access_token);
    const aal = jwtClaims(session.access_token)?.aal;
    if (me.aal === 'aal2' || aal === 'aal2')
      return json({ status: 'authenticated', admin: publicAdmin(me) }, 200, adminCookies(req, session));
    return json(
      {
        status: 'mfa_required',
        admin: publicAdmin(me),
        factors: factorList(session),
        enrollmentRequired: factorList(session).length === 0,
      },
      200,
      preauthCookies(req, session),
    );
  }

  if (path === '/api/production/admin/mfa/state' && req.method === 'GET') {
    const accessToken = cookie(req, PREAUTH_ACCESS_COOKIE);
    const refreshToken = cookie(req, PREAUTH_REFRESH_COOKIE);
    if (!accessToken || !refreshToken) fail(401, 'Reconnectez-vous pour continuer.', 'preauth_expired');
    const me = await adminMe(env, accessToken);
    const user = await mfaUser(env, accessToken);
    if (me.user_id !== user.id) fail(401, 'Session MFA invalide.', 'preauth_expired');
    const factors = user.factors.filter(f => f.factor_type === 'totp' && f.status === 'verified').map(f => ({ id: f.id, friendlyName: f.friendly_name || 'Authentificateur' }));
    const enrollment = factors.length ? null : await cachedEnrollment(env.DB, env, await mfaScope(env, user.id), refreshToken, user.factors);
    return json({ status: 'mfa_required', admin: publicAdmin(me), factors, enrollmentRequired: !factors.length, enrollment });
  }

  if (path === '/api/production/admin/mfa/enroll' && req.method === 'POST') {
    guardMutation(req, env);
    await requestBody(req);
    const accessToken = cookie(req, PREAUTH_ACCESS_COOKIE);
    const refreshToken = cookie(req, PREAUTH_REFRESH_COOKIE);
    if (!accessToken || !refreshToken) fail(401, 'Reconnectez-vous pour configurer la sécurité.', 'preauth_expired');
    const me = await adminMe(env, accessToken);
    return json(await enrollMfa(env.DB, env, accessToken, refreshToken, me.user_id));
  }

  if (path === '/api/production/admin/mfa/verify' && req.method === 'POST') {
    guardMutation(req, env);
    await reserveRate(env.DB, await networkKey(req, 'admin-mfa'), 10, FIFTEEN_MINUTES);
    const parsed = z
      .object({
        factorId: z.string().uuid(),
        code: z.string().regex(/^\d{6}$/),
      })
      .strict()
      .safeParse(await requestBody(req));
    if (!parsed.success) fail(400, 'Code de sécurité invalide.', 'invalid_mfa_code');
    const accessToken = cookie(req, PREAUTH_ACCESS_COOKIE);
    if (!accessToken) fail(401, 'Reconnectez-vous pour continuer.', 'preauth_expired');
    const identity = await adminMe(env, accessToken);
    const scope = await mfaScope(env, identity.user_id);
    return withMfaLock(env.DB, scope, async () => {
    try {
      const challenge = await supabaseRequest<unknown>(
        env,
        `/auth/v1/factors/${parsed.data.factorId}/challenge`,
        { mode: { kind: 'user', accessToken }, method: 'POST', body: {} },
      );
      const challengeParsed = z.object({ id: z.string().uuid() }).safeParse(challenge);
      if (!challengeParsed.success) fail(502, 'Défi MFA invalide.', 'invalid_mfa_challenge');
      const verified = await supabaseRequest<unknown>(
        env,
        `/auth/v1/factors/${parsed.data.factorId}/verify`,
        {
          mode: { kind: 'user', accessToken },
          method: 'POST',
          body: { challenge_id: challengeParsed.data.id, code: parsed.data.code },
        },
      );
      const session = authSessionSchema.safeParse(verified);
      if (!session.success) fail(502, 'Session MFA invalide.', 'invalid_mfa_session');
      const me = await adminMe(env, session.data.access_token);
      if (me.aal !== 'aal2' && jwtClaims(session.data.access_token)?.aal !== 'aal2')
        fail(403, 'La double authentification n’a pas été validée.', 'mfa_required');
      await env.DB.prepare("UPDATE mfa_enrollments SET payload='',owner='',expires_at=0 WHERE scope=?").bind(scope).run();
      return json(
        { status: 'authenticated', admin: publicAdmin({ ...me, aal: 'aal2' }) },
        200,
        adminCookies(req, session.data),
      );
    } catch (error) {
      mfaError(error);
    }
    });
  }

  if (path === '/api/production/admin/logout' && req.method === 'POST') {
    guardMutation(req, env);
    const accessToken = cookie(req, ADMIN_ACCESS_COOKIE) || cookie(req, PREAUTH_ACCESS_COOKIE);
    if (accessToken)
      await supabaseRequest(env, '/auth/v1/logout', {
        mode: { kind: 'user', accessToken },
        method: 'POST',
        body: {},
      }).catch(() => undefined);
    return json({ ok: true }, 200, allAdminCookiesCleared(req));
  }

  if (path === '/api/production/admin/session' && req.method === 'GET') {
    const session = await requireAdmin(req, env);
    return json({ admin: publicAdmin(session.me) }, 200, session.cookies);
  }

  if (path === '/api/production/admin/dashboard' && req.method === 'GET') {
    const session = await requireAdmin(req, env);
    const organizationId = new URL(req.url).searchParams.get('organizationId') ?? '';
    if (!session.me.memberships.some((membership) => membership.organization_id === organizationId))
      fail(403, 'Organisation non autorisée.', 'organization_denied');
    const result = await rpc<unknown>(
      env,
      'admin_dashboard',
      { p_organization_id: organizationId },
      { kind: 'user', accessToken: session.accessToken },
    );
    const dashboard = dashboardSchema.safeParse(result);
    if (!dashboard.success) fail(502, 'Tableau de bord invalide.', 'invalid_dashboard_response');
    return json({ dashboard: dashboard.data }, 200, session.cookies);
  }

  if (path === '/api/production/admin/p1-release' && req.method === 'GET') {
    const session = await requireAdmin(req, env);
    const params = new URL(req.url).searchParams;
    const organizationId = params.get('organizationId') ?? '';
    if (!session.me.memberships.some((membership) => membership.organization_id === organizationId))
      fail(403, 'Organisation non autorisée.', 'organization_denied');

    const requestedHours = Number(params.get('hours') ?? 24);
    const hours = Number.isInteger(requestedHours)
      ? Math.max(1, Math.min(requestedHours, 168))
      : 24;
    const result = await rpc<unknown>(
      env,
      'admin_p1_release_metrics',
      { p_organization_id: organizationId, p_hours: hours },
      { kind: 'user', accessToken: session.accessToken },
    );
    const metrics = p1ReleaseMetricsSchema.safeParse(result);
    if (!metrics.success)
      fail(502, 'Mesures de déploiement IA invalides.', 'invalid_p1_release_metrics');

    const effective = await effectiveEnvironment(env, req.url);
    const release = await releaseConfigurationState(effective);
    return json(
      {
        metrics: metrics.data,
        configuration: {
          environment: environmentLabel(effective, req.url),
          mode: release.mode,
          ready: release.releaseReady,
          canaryPercent: release.canaryPercent,
          modelConfigured: release.modelConfigured,
          embeddingConfigured: release.embeddingConfigured,
          attestationConfigured: release.attestationConfigured,
          attestationVerified: release.attestationVerified,
          attestationExpiresAt: release.attestationExpiresAt,
          issues: release.issues,
        },
      },
      200,
      session.cookies,
    );
  }

  if (path === '/api/production/admin/cases' && req.method === 'GET') {
    const session = await requireAdmin(req, env);
    const params = new URL(req.url).searchParams;
    const organizationId = params.get('organizationId') ?? '';
    if (!session.me.memberships.some((membership) => membership.organization_id === organizationId))
      fail(403, 'Organisation non autorisée.', 'organization_denied');
    const limit = Math.max(1, Math.min(Number(params.get('limit') ?? 50) || 50, 100));
    const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0);
    const serviceType = params.get('serviceType') || null;
    if (serviceType && !['sav', 'customer_service'].includes(serviceType))
      fail(400, 'Service invalide.', 'invalid_service_type');
    const archiveFilter = params.get('archive') || 'active';
    if (!['active', 'archived', 'all'].includes(archiveFilter))
      fail(400, 'Filtre d’archive invalide.', 'invalid_archive_filter');
    const result = await rpc<unknown>(
      env,
      'admin_list_cases_v2',
      {
        p_organization_id: organizationId,
        p_limit: limit,
        p_offset: offset,
        p_search: (params.get('search') ?? '').slice(0, 120),
        p_status: params.get('status') || null,
        p_kind: params.get('kind') || null,
        p_service_type: serviceType,
        p_archive_filter: archiveFilter,
      },
      { kind: 'user', accessToken: session.accessToken },
    );
    const cases = z
      .object({ items: z.array(z.record(z.string(), z.unknown())).max(100), total: z.number().int().nonnegative() })
      .safeParse(result);
    if (!cases.success) fail(502, 'Liste de dossiers invalide.', 'invalid_case_list_response');
    return json(cases.data, 200, session.cookies);
  }
  return null;
}

export async function handleProductionApi(req: Request, env: ProductionEnv): Promise<Response> {
  try {
    const path = new URL(req.url).pathname;
    if (path === '/api/production/config' && req.method === 'GET') {
      const effective = await effectiveEnvironment(env, req.url);
      const release = await releaseConfigurationState(effective);
      return json({
        backend: 'supabase',
        environment: environmentLabel(effective, req.url),
        chatEnabled: effective.LLM_ORCHESTRATOR === 'structured',
        p1Release: {
          mode: release.mode,
          ready: release.releaseReady,
          canaryPercent: release.canaryPercent,
          canarySaltConfigured: release.canarySaltConfigured,
          modelConfigured: release.modelConfigured,
          embeddingConfigured: release.embeddingConfigured,
          attestationConfigured: release.attestationConfigured,
          attestationVerified: release.attestationVerified,
          attestationExpiresAt: release.attestationExpiresAt,
          issues: release.issues,
        },
        ...publicSupabaseState(effective),
      });
    }

    if (path === '/api/production/health' && req.method === 'GET') {
      supabaseSettings(env);
      await Promise.all([
        supabaseRequest(env, '/auth/v1/health', { mode: { kind: 'publishable' } }),
        supabaseRequest(env, '/rest/v1/organizations?select=id&limit=1', {
          mode: { kind: 'privileged' },
          headers: { Prefer: 'count=none' },
        }),
      ]);
      return json({ status: 'ok', database: 'reachable' });
    }

    if (path === '/api/production/chat' && ['GET', 'POST'].includes(req.method)) {
      if (req.method === 'POST') guardMutation(req, env);
      await reserveRate(env.DB, await networkKey(req, 'production-chat'), 60, FIFTEEN_MINUTES);
      const body = req.method === 'POST' ? await requestBody(req) : null;
      return json(
        await productionChat(req, env, cookie(req, CASE_COOKIE), body, async (activeEnv) => {
          const value = Number(activeEnv.LLM_DAILY_LIMIT ?? 100);
          const limit = Number.isFinite(value)
            ? Math.max(0, Math.min(Math.floor(value), 10000))
            : 100;
          await reserveRate(env.DB, 'llm-global', limit, 24 * 60 * 60_000);
        }),
      );
    }
    const caseResponse = await handleCaseRoutes(req, env, path);
    if (caseResponse) return caseResponse;
    const adminResponse = await handleAdminRoutes(req, env, path);
    if (adminResponse) return adminResponse;
    return json({ error: 'Ressource introuvable.', code: 'not_found' }, 404);
  } catch (error) {
    if (error instanceof CaseAccessError)
      return json(
        { error: error.message, code: error.code },
        error.status,
        error.status === 401 ? [clearCookie(req, CASE_COOKIE)] : [],
      );
    if (new URL(req.url).pathname.startsWith('/api/production/admin/mfa/')) {
      // D1 can wrap SQLite errors in Error.cause. Diagnose the absent local
      // migration without returning database messages or sensitive payloads.
      let cause: unknown = error;
      for (let depth = 0; depth < 4 && cause instanceof Error; depth++) {
        if (/no such table:\s*mfa_enrollments\b/i.test(cause.message)) {
          return json(
            {
              error:
                'Le stockage MFA n’est pas initialisé. Le responsable doit appliquer les migrations dans cet environnement avant de reprendre la configuration.',
              code: 'mfa_storage_not_ready',
            },
            503,
          );
        }
        cause = cause.cause;
      }
      if (error instanceof SupabaseRequestError) {
        try {
          mfaError(error);
        } catch (mapped) {
          error = mapped;
        }
      }
      if (error instanceof MfaError)
        return json({ error: error.message, code: error.code }, error.status);
    }
    if (error instanceof ProductionApiError)
      return json({ error: error.message, code: error.code }, error.status);
    if (error instanceof SupabaseConfigError)
      return json(
        {
          error: 'La connexion sécurisée à Supabase n’est pas encore configurée.',
          code: 'supabase_not_configured',
        },
        503,
      );
    if (error instanceof SupabaseRequestError)
      return json(
        {
          error: 'Le service de données est temporairement indisponible.',
          code: error.code === 'upstream_timeout' ? 'data_timeout' : 'data_unavailable',
        },
        error.status === 429 ? 429 : 503,
      );
    console.error('production_api_unhandled', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Une erreur interne est survenue.', code: 'internal_error' }, 500);
  }
}

export async function recordProductionReleaseEvent(
  env: ProductionEnv,
  route: string,
  response: Response,
) {
  if (route !== '/api/production/chat' || !response.ok) return;
  try {
    const payload = await boundedJson(response.clone(), 128 * 1024);
    const parsed = releaseTelemetryResponseSchema.safeParse(payload);
    if (!parsed.success) return;

    const settings = supabaseSettings(env);
    const metadata = parsed.data.metadata;
    const release = metadata.release;
    if (!release) return;
    await supabaseRequest(env, '/rest/v1/rpc/record_p1_release_event', {
      mode: { kind: 'privileged' },
      method: 'POST',
      timeoutMs: 3_000,
      body: {
        p_organization_id: settings.organizationId,
        p_request_id: metadata.requestId,
        p_release_mode: release.mode,
        p_cohort: release.cohort,
        p_cohort_bucket: release.cohortBucket,
        p_canary_percent: release.canaryPercent,
        p_attempted: release.attempted,
        p_released: release.released,
        p_reason: release.reason,
        p_plan: release.plan,
        p_generation_outcome: metadata.generation?.outcome ?? null,
        p_validation_outcome: metadata.validation?.outcome ?? null,
        p_provider: metadata.provider,
        p_model: metadata.model,
        p_provider_calls: metadata.providerCalls,
        p_input_tokens: metadata.inputTokens,
        p_output_tokens: metadata.outputTokens,
        p_latency_ms: Math.round(metadata.latencyMs),
      },
    });
  } catch {
    // Rollout telemetry is best-effort and must never delay or break a customer response.
  }
}

export async function recordProductionPerformance(
  env: ProductionEnv,
  route: string,
  statusCode: number,
  latencyMs: number,
) {
  try {
    const settings = supabaseSettings(env);
    await supabaseRequest(env, '/rest/v1/performance_samples', {
      mode: { kind: 'privileged' },
      method: 'POST',
      body: {
        organization_id: settings.organizationId,
        route: route.slice(0, 240),
        status_code: Math.max(100, Math.min(Math.trunc(statusCode), 599)),
        latency_ms: Math.max(0, Math.min(Math.trunc(latencyMs), 300_000)),
      },
      timeoutMs: 3_000,
      headers: { Prefer: 'return=minimal' },
    });
  } catch {
    // Telemetry must never delay or break a customer request.
  }
}
