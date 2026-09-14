import { z } from 'zod';
import type { Database } from './api';
import { supabaseRequest, SupabaseRequestError, type SupabaseRuntimeEnv } from './supabase';

export class MfaError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) {
    super(message);
  }
}
export function mfaError(error: unknown): never {
  if (!(error instanceof SupabaseRequestError)) throw error;
  const mapped: Record<string, [number, string, string]> = {
    mfa_factor_name_conflict: [
      409,
      'Un authentificateur existe déjà. Reprenez la vérification.',
      'mfa_factor_exists',
    ],
    mfa_factor_not_found: [
      409,
      'Cette configuration n’existe plus. Reprenez la configuration.',
      'mfa_factor_not_found',
    ],
    mfa_totp_enroll_not_enabled: [
      403,
      'La configuration TOTP est désactivée dans Supabase. Contactez le responsable.',
      'mfa_disabled',
    ],
    mfa_totp_verify_not_enabled: [
      403,
      'La vérification TOTP est désactivée dans Supabase. Contactez le responsable.',
      'mfa_disabled',
    ],
    mfa_verification_failed: [
      400,
      'Code incorrect ou périmé. Saisissez le code actuel de votre authentificateur.',
      'invalid_mfa_code',
    ],
    mfa_challenge_expired: [
      400,
      'Le défi de vérification a expiré. Saisissez le code actuel et réessayez.',
      'mfa_challenge_expired',
    ],
    mfa_verification_rejected: [
      403,
      'La vérification a été refusée par la politique de sécurité.',
      'mfa_verification_rejected',
    ],
    mfa_ip_address_mismatch: [
      400,
      'La connexion a changé pendant la vérification. Reconnectez-vous.',
      'mfa_ip_address_mismatch',
    ],
    insufficient_aal: [
      403,
      'Supabase exige une vérification supplémentaire pour cette opération.',
      'mfa_assurance_required',
    ],
    upstream_timeout: [504, 'Supabase n’a pas répondu à temps. Réessayez.', 'mfa_timeout'],
    request_timeout: [504, 'Supabase n’a pas répondu à temps. Réessayez.', 'mfa_timeout'],
    upstream_unreachable: [
      503,
      'Connexion à Supabase impossible. Réessayez.',
      'mfa_network_unavailable',
    ],
    invalid_upstream_response: [
      502,
      'La réponse MFA de Supabase est invalide. Réessayez.',
      'invalid_mfa_response',
    ],
  };
  if (mapped[error.code]) {
    const [status, message, code] = mapped[error.code];
    throw new MfaError(status, message, code);
  }
  if (
    error.status === 401 ||
    [
      'session_expired',
      'session_not_found',
      'bad_jwt',
      'refresh_token_not_found',
      'refresh_token_already_used',
    ].includes(error.code)
  )
    throw new MfaError(
      401,
      'Votre session de connexion a expiré. Reconnectez-vous.',
      'preauth_expired',
    );
  if (error.status === 429)
    throw new MfaError(
      429,
      'Trop de tentatives MFA. Patientez avant de réessayer.',
      'mfa_rate_limited',
    );
  if (error.status >= 500)
    throw new MfaError(
      503,
      'Le service d’authentification Supabase rencontre une erreur. Réessayez plus tard.',
      'mfa_upstream_error',
    );
  throw new MfaError(
    400,
    'Supabase a refusé cette opération MFA. Reprenez la configuration ou contactez le responsable.',
    'invalid_mfa_enrollment',
  );
}
export const enrollmentSchema = z.object({
  factorId: z.string().uuid(),
  totp: z.object({
    qr_code: z.string().min(1).max(200000),
    secret: z.string().min(8).max(512),
    uri: z.string().min(1).max(4000),
  }),
});
const factorSchema = z.object({
  id: z.string().uuid(),
  factor_type: z.string(),
  status: z.string(),
  friendly_name: z.string().nullish(),
});
export async function mfaUser(env: SupabaseRuntimeEnv, accessToken: string) {
  const value = await supabaseRequest(env, '/auth/v1/user', {
    mode: { kind: 'user', accessToken },
  });
  const parsed = z
    .object({ id: z.string().uuid(), factors: z.array(factorSchema).nullish() })
    .safeParse(value);
  if (!parsed.success)
    throw new MfaError(502, 'Réponse d’identité MFA invalide.', 'invalid_mfa_response');
  return { ...parsed.data, factors: parsed.data.factors ?? [] };
}
type Row = {
  scope: string;
  owner: string;
  payload: string;
  expires_at: number;
  lock_id: string;
  lock_until: number;
};
export async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function mfaScope(env: SupabaseRuntimeEnv, userId: string) {
  return digest(`${env.SUPABASE_URL}:${userId}`);
}
async function key(env: SupabaseRuntimeEnv, refreshToken: string) {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`savsc-mfa-v1:${env.SUPABASE_SECRET_KEY}:${refreshToken}`),
  );
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env: SupabaseRuntimeEnv, refreshToken: string, scope: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(scope) },
    await key(env, refreshToken),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return JSON.stringify({ iv: [...iv], data: [...new Uint8Array(encrypted)] });
}
export async function cachedEnrollment(
  db: Database,
  env: SupabaseRuntimeEnv,
  scope: string,
  refreshToken: string,
  factors: Awaited<ReturnType<typeof mfaUser>>['factors'],
) {
  const row = await db
    .prepare('SELECT * FROM mfa_enrollments WHERE scope=?')
    .bind(scope)
    .first<Row>();
  if (
    !row ||
    !row.payload ||
    row.expires_at <= Date.now() ||
    row.owner !== (await digest(refreshToken))
  )
    return null;
  try {
    const blob = JSON.parse(row.payload);
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: new Uint8Array(blob.iv),
        additionalData: new TextEncoder().encode(scope),
      },
      await key(env, refreshToken),
      new Uint8Array(blob.data),
    );
    const value = enrollmentSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
    return factors.some(
      (f) => f.id === value.factorId && f.factor_type === 'totp' && f.status === 'unverified',
    )
      ? value
      : null;
  } catch {
    return null;
  }
}
export async function withMfaLock<T>(
  db: Database,
  scope: string,
  run: (lock: string) => Promise<T>,
) {
  const lock = crypto.randomUUID(),
    now = Date.now();
  await db
    .prepare(
      "INSERT INTO mfa_enrollments(scope,owner,payload,expires_at,lock_id,lock_until) VALUES(?,'','',0,'',0) ON CONFLICT(scope) DO NOTHING",
    )
    .bind(scope)
    .run();
  const acquired = await db
    .prepare('UPDATE mfa_enrollments SET lock_id=?,lock_until=? WHERE scope=? AND lock_until<=?')
    .bind(lock, now + 90000, scope, now)
    .run();
  if (!acquired.meta.changes)
    throw new MfaError(
      409,
      'Une opération MFA est déjà en cours. Patientez puis reprenez.',
      'mfa_in_progress',
    );
  try {
    return await run(lock);
  } finally {
    await db
      .prepare("UPDATE mfa_enrollments SET lock_id='',lock_until=0 WHERE scope=? AND lock_id=?")
      .bind(scope, lock)
      .run();
  }
}
export async function enrollMfa(
  db: Database,
  env: SupabaseRuntimeEnv,
  accessToken: string,
  refreshToken: string,
  userId: string,
) {
  const scope = await mfaScope(env, userId);
  return withMfaLock(db, scope, async (lock) => {
    const user = await mfaUser(env, accessToken);
    if (user.id !== userId)
      throw new MfaError(401, 'Session MFA invalide. Reconnectez-vous.', 'preauth_expired');
    if (user.factors.some((f) => f.factor_type === 'totp' && f.status === 'verified'))
      throw new MfaError(
        409,
        'Un authentificateur est déjà validé. Reprenez la vérification avec son code.',
        'mfa_factor_exists',
      );
    const cached = await cachedEnrollment(db, env, scope, refreshToken, user.factors);
    if (cached) return cached;
    const current = await db
      .prepare('SELECT * FROM mfa_enrollments WHERE scope=?')
      .bind(scope)
      .first<Row>();
    if (
      current?.payload &&
      current.expires_at > Date.now() &&
      current.owner !== (await digest(refreshToken))
    )
      throw new MfaError(
        409,
        'Une configuration est ouverte dans une autre session. Terminez-la ou attendez son expiration.',
        'mfa_other_session',
      );
    // Only abandon this application's own, unverified TOTP factors. Never touch verified factors.
    for (const factor of user.factors.filter(
      (f) =>
        f.factor_type === 'totp' &&
        f.status === 'unverified' &&
        f.friendly_name === 'SAV SC Administration',
    )) {
      await supabaseRequest(env, `/auth/v1/factors/${factor.id}`, {
        mode: { kind: 'user', accessToken },
        method: 'DELETE',
      });
    }
    const result = await supabaseRequest<unknown>(env, '/auth/v1/factors', {
      mode: { kind: 'user', accessToken },
      method: 'POST',
      body: { factor_type: 'totp', friendly_name: 'SAV SC Administration' },
    });
    const parsed = z
      .object({ id: z.string().uuid(), totp: enrollmentSchema.shape.totp })
      .safeParse(result);
    if (!parsed.success)
      throw new MfaError(
        502,
        'La configuration MFA reçue est invalide. Réessayez pour reprendre proprement.',
        'invalid_mfa_enrollment',
      );
    const value = { factorId: parsed.data.id, totp: parsed.data.totp };
    const saved = await db
      .prepare(
        'UPDATE mfa_enrollments SET owner=?,payload=?,expires_at=? WHERE scope=? AND lock_id=? AND lock_until>?',
      )
      .bind(
        await digest(refreshToken),
        await seal(env, refreshToken, scope, value),
        Date.now() + 600000,
        scope,
        lock,
        Date.now(),
      )
      .run();
    if (!saved.meta.changes)
      throw new MfaError(
        409,
        'La configuration a expiré. Reprenez la configuration.',
        'mfa_in_progress',
      );
    return value;
  });
}
