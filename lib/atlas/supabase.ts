import { boundedJson } from './bounded-json';

export interface SupabaseRuntimeEnv {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_ORGANIZATION_ID?: string;
}

export type SupabaseMode =
  { kind: 'publishable' } | { kind: 'privileged' } | { kind: 'user'; accessToken: string };

export class SupabaseConfigError extends Error {}

export class SupabaseRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = 'Supabase request failed',
  ) {
    super(message);
  }
}

export type SupabaseSettings = {
  url: string;
  publishableKey: string;
  secretKey: string;
  organizationId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(value: string | undefined) {
  return value?.trim() ?? '';
}

function safeProjectUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SupabaseConfigError('SUPABASE_URL invalide.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new SupabaseConfigError('SUPABASE_URL doit être une origine HTTPS sans identifiants.');
  return url.origin;
}

export function supabaseSettings(env: SupabaseRuntimeEnv): SupabaseSettings {
  const url = safeProjectUrl(clean(env.SUPABASE_URL));
  const publishableKey = clean(env.SUPABASE_PUBLISHABLE_KEY);
  const secretKey = clean(env.SUPABASE_SECRET_KEY);
  const organizationId = clean(env.SUPABASE_ORGANIZATION_ID);
  if (!publishableKey) throw new SupabaseConfigError('SUPABASE_PUBLISHABLE_KEY manquante.');
  if (!secretKey) throw new SupabaseConfigError('SUPABASE_SECRET_KEY manquante.');
  if (!UUID.test(organizationId))
    throw new SupabaseConfigError('SUPABASE_ORGANIZATION_ID manquant ou invalide.');
  return { url, publishableKey, secretKey, organizationId };
}

export function publicSupabaseState(env: SupabaseRuntimeEnv) {
  try {
    const settings = supabaseSettings(env);
    return {
      configured: true,
      projectHost: new URL(settings.url).host,
      organizationConfigured: true,
    };
  } catch {
    return { configured: false, projectHost: null, organizationConfigured: false };
  }
}

function requestHeaders(settings: SupabaseSettings, mode: SupabaseMode) {
  const key = mode.kind === 'privileged' ? settings.secretKey : settings.publishableKey;
  const headers = new Headers({
    apikey: key,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  if (mode.kind === 'user') headers.set('Authorization', `Bearer ${mode.accessToken}`);
  // Legacy service_role keys are JWTs and still require an Authorization header.
  if (mode.kind === 'privileged' && settings.secretKey.startsWith('eyJ'))
    headers.set('Authorization', `Bearer ${settings.secretKey}`);
  return headers;
}

function errorCode(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 'upstream_error';
  const record = payload as Record<string, unknown>;
  for (const key of ['code', 'error_code', 'message']) {
    const value = record[key];
    if (typeof value === 'string' && value.length <= 120) return value;
  }
  return 'upstream_error';
}

export async function supabaseRequest<T>(
  env: SupabaseRuntimeEnv,
  path: string,
  options: {
    mode: SupabaseMode;
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    timeoutMs?: number;
    headers?: Record<string, string>;
  },
): Promise<T> {
  const settings = supabaseSettings(env);
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new SupabaseConfigError('Chemin Supabase invalide.');
  const headers = requestHeaders(settings, options.mode);
  Object.entries(options.headers ?? {}).forEach(([name, value]) => headers.set(name, value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(settings.url + path, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // Workerd accepts only "manual" or "follow". Never follow a redirect:
      // it could forward an API key or a user's session to another origin.
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => {});
      throw new SupabaseRequestError(502, 'upstream_redirect_blocked');
    }
    let payload: unknown = null;
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (response.status !== 204 && contentType.includes('json')) {
      try {
        payload = await boundedJson(response, 512 * 1024, controller.signal);
      } catch {
        throw new SupabaseRequestError(
          502,
          controller.signal.aborted ? 'upstream_timeout' : 'invalid_upstream_response',
        );
      }
    }
    if (!response.ok)
      throw new SupabaseRequestError(
        response.status,
        errorCode(payload),
        'Supabase rejected request',
      );
    return payload as T;
  } catch (error) {
    if (error instanceof SupabaseRequestError) throw error;
    throw new SupabaseRequestError(
      503,
      error instanceof DOMException && error.name === 'AbortError'
        ? 'upstream_timeout'
        : 'upstream_unreachable',
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function jwtClaims(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
