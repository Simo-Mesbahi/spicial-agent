import type { Database } from './api';

export const ADMIN_SERVER_IDLE_MS = 15 * 60_000;
export const ADMIN_SERVER_ABSOLUTE_MS = 12 * 60 * 60_000;
export const ADMIN_ACTIVITY_HEADER = 'x-savsc-admin-activity';

const ADMIN_REFRESH_COOKIE = 'savsc_admin_refresh';
const ADMIN_ACCESS_COOKIE = 'savsc_admin_access';
const PREAUTH_ACCESS_COOKIE = 'savsc_admin_preauth';
const PREAUTH_REFRESH_COOKIE = 'savsc_admin_preauth_refresh';
const SESSION_PREFIX = 'admin-session-v1:';

export type AdminServerSessionState = {
  state: 'missing' | 'active' | 'expired';
  key: string;
  createdAt?: number;
  deadline?: number;
};

function cookie(request: Request, name: string) {
  const raw = request.headers.get('cookie') ?? '';
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

function cookieValueFromSetCookie(response: Response, name: string) {
  const raw = response.headers.get('set-cookie') ?? '';
  if (!raw) return '';
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = raw.match(new RegExp(`(?:^|,\\s*)${escaped}=([^;,\\r\\n]*)`));
  if (!match?.[1]) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

function sessionCookie(request: Request, name: string, value: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

function clearCookie(request: Request, name: string) {
  return sessionCookie(request, name, '', 0);
}

async function sha256(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function adminRefreshToken(request: Request) {
  return cookie(request, ADMIN_REFRESH_COOKIE);
}

export function adminRefreshTokenFromResponse(response: Response) {
  return cookieValueFromSetCookie(response, ADMIN_REFRESH_COOKIE);
}

export function isProtectedAdminApi(pathname: string) {
  if (!pathname.startsWith('/api/production/admin/')) return false;
  if (pathname === '/api/production/admin/login') return false;
  if (pathname === '/api/production/admin/logout') return false;
  if (pathname.startsWith('/api/production/admin/mfa/')) return false;
  return true;
}

export function isAdminAuthenticationCompletion(pathname: string) {
  return pathname === '/api/production/admin/login' || pathname === '/api/production/admin/mfa/verify';
}

export function isAdminActivityRequest(request: Request) {
  return request.headers.get(ADMIN_ACTIVITY_HEADER) === '1';
}

export async function adminServerSessionKey(refreshToken: string) {
  return `${SESSION_PREFIX}${await sha256(`savsc-admin-session:${refreshToken}`)}`;
}

export async function inspectAdminServerSession(
  db: Database,
  refreshToken: string,
  now = Date.now(),
): Promise<AdminServerSessionState> {
  const key = await adminServerSessionKey(refreshToken);
  const row = await db
    .prepare('SELECT count AS created_at, expires_at FROM rate_buckets WHERE id=? LIMIT 1')
    .bind(key)
    .first<{ created_at: number; expires_at: number }>();
  if (!row) return { state: 'missing', key };

  const createdAt = Number(row.created_at);
  const deadline = Number(row.expires_at);
  const invalid =
    !Number.isFinite(createdAt) ||
    !Number.isFinite(deadline) ||
    createdAt <= 0 ||
    deadline <= now ||
    createdAt + ADMIN_SERVER_ABSOLUTE_MS <= now;
  if (invalid) {
    await db.prepare('DELETE FROM rate_buckets WHERE id=?').bind(key).run();
    return { state: 'expired', key, createdAt, deadline };
  }
  return { state: 'active', key, createdAt, deadline };
}

export async function registerAdminServerSession(
  db: Database,
  refreshToken: string,
  now = Date.now(),
) {
  const key = await adminServerSessionKey(refreshToken);
  const deadline = Math.min(now + ADMIN_SERVER_IDLE_MS, now + ADMIN_SERVER_ABSOLUTE_MS);
  await db
    .prepare('INSERT OR IGNORE INTO rate_buckets (id,count,expires_at) VALUES (?,?,?)')
    .bind(key, now, deadline)
    .run();
  return { key, createdAt: now, deadline };
}

export async function touchAdminServerSession(
  db: Database,
  refreshToken: string,
  now = Date.now(),
) {
  const key = await adminServerSessionKey(refreshToken);
  const row = await db
    .prepare('SELECT count AS created_at, expires_at FROM rate_buckets WHERE id=? LIMIT 1')
    .bind(key)
    .first<{ created_at: number; expires_at: number }>();
  if (!row) return false;
  const createdAt = Number(row.created_at);
  const deadline = Number(row.expires_at);
  if (
    !Number.isFinite(createdAt) ||
    !Number.isFinite(deadline) ||
    deadline <= now ||
    createdAt + ADMIN_SERVER_ABSOLUTE_MS <= now
  ) {
    await db.prepare('DELETE FROM rate_buckets WHERE id=?').bind(key).run();
    return false;
  }
  const nextDeadline = Math.min(now + ADMIN_SERVER_IDLE_MS, createdAt + ADMIN_SERVER_ABSOLUTE_MS);
  const result = await db
    .prepare('UPDATE rate_buckets SET expires_at=? WHERE id=? AND expires_at>?')
    .bind(nextDeadline, key, now)
    .run();
  return Number(result.meta.changes) === 1;
}

export async function revokeAdminServerSession(db: Database, refreshToken: string) {
  if (!refreshToken) return;
  const key = await adminServerSessionKey(refreshToken);
  await db.prepare('DELETE FROM rate_buckets WHERE id=?').bind(key).run();
}

export async function rotateAdminServerSession(
  db: Database,
  previousRefreshToken: string,
  nextRefreshToken: string,
  now = Date.now(),
) {
  if (!previousRefreshToken || !nextRefreshToken || previousRefreshToken === nextRefreshToken) return;
  const previous = await inspectAdminServerSession(db, previousRefreshToken, now);
  if (previous.state !== 'active' || previous.createdAt === undefined || previous.deadline === undefined)
    return;
  const nextKey = await adminServerSessionKey(nextRefreshToken);
  await db
    .prepare('INSERT OR REPLACE INTO rate_buckets (id,count,expires_at) VALUES (?,?,?)')
    .bind(nextKey, previous.createdAt, previous.deadline)
    .run();
  await db.prepare('DELETE FROM rate_buckets WHERE id=?').bind(previous.key).run();
}

export function withClearedAdminCookies(request: Request, response: Response) {
  const headers = new Headers(response.headers);
  for (const name of [
    ADMIN_ACCESS_COOKIE,
    ADMIN_REFRESH_COOKIE,
    PREAUTH_ACCESS_COOKIE,
    PREAUTH_REFRESH_COOKIE,
  ]) {
    headers.append('Set-Cookie', clearCookie(request, name));
  }
  headers.set('Cache-Control', 'no-store, max-age=0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function adminSessionExpiredResponse(request: Request) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const name of [
    ADMIN_ACCESS_COOKIE,
    ADMIN_REFRESH_COOKIE,
    PREAUTH_ACCESS_COOKIE,
    PREAUTH_REFRESH_COOKIE,
  ]) {
    headers.append('Set-Cookie', clearCookie(request, name));
  }
  return Response.json(
    {
      error: 'Votre session administrateur a expiré après une période d’inactivité. Reconnectez-vous pour continuer.',
      code: 'admin_session_idle_expired',
    },
    { status: 401, headers },
  );
}
