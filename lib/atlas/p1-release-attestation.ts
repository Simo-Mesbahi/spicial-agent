import { z } from 'zod';

const TOKEN_PREFIX = 'p1a1';
const MAX_ATTESTATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const payloadSchema = z
  .object({
    schema: z.literal(1),
    qualificationId: z.string().regex(/^[a-f0-9]{64}$/),
    sourceTreeSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    organizationId: z.string().uuid(),
    approvedAt: z.string().min(20).max(40),
    expiresAt: z.string().min(20).max(40),
  })
  .strict();

export type ReleaseAttestationPayload = z.infer<typeof payloadSchema>;

export type ReleaseAttestationVerification =
  | {
      valid: true;
      payload: ReleaseAttestationPayload;
      reason: null;
    }
  | {
      valid: false;
      payload: null;
      reason:
        | 'missing'
        | 'invalid_key'
        | 'invalid_format'
        | 'invalid_payload'
        | 'invalid_signature'
        | 'invalid_time_window'
        | 'expired'
        | 'source_mismatch'
        | 'organization_mismatch';
    };

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_base64url');
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64Url(bytes) !== value) throw new Error('non_canonical_base64url');
  return bytes;
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizedKey(value: string | undefined) {
  const key = value?.trim() ?? '';
  if (key.length < 32 || key.length > 512) return null;
  return key;
}

async function hmacKey(key: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw',
    textBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

function validTimes(payload: ReleaseAttestationPayload, now: number) {
  const approvedAt = Date.parse(payload.approvedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    approvedAt > expiresAt ||
    expiresAt - approvedAt > MAX_ATTESTATION_LIFETIME_MS ||
    approvedAt > now + CLOCK_SKEW_MS
  )
    return { valid: false as const, expired: false };
  if (expiresAt <= now) return { valid: false as const, expired: true };
  return { valid: true as const, expired: false };
}

export async function createReleaseAttestation(
  payload: ReleaseAttestationPayload,
  secret: string,
  now = Date.now(),
) {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new Error('invalid_release_attestation_payload');
  const key = normalizedKey(secret);
  if (!key) throw new Error('invalid_release_attestation_key');
  const timing = validTimes(parsed.data, now);
  if (!timing.valid) throw new Error(timing.expired ? 'release_attestation_expired' : 'invalid_release_attestation_time');

  const payloadBytes = textBytes(JSON.stringify(parsed.data));
  const encodedPayload = encodeBase64Url(payloadBytes);
  const signed = `${TOKEN_PREFIX}.${encodedPayload}`;
  const signingKey = await hmacKey(key, 'sign');
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', signingKey, textBytes(signed)),
  );
  return `${signed}.${encodeBase64Url(signature)}`;
}

export async function verifyReleaseAttestation(
  input: {
    token?: string;
    secret?: string;
    deployedSourceTreeSha?: string;
    organizationId?: string;
  },
  now = Date.now(),
): Promise<ReleaseAttestationVerification> {
  const token = input.token?.trim() ?? '';
  if (!token) return { valid: false, payload: null, reason: 'missing' };
  const key = normalizedKey(input.secret);
  if (!key) return { valid: false, payload: null, reason: 'invalid_key' };

  const sourceTreeSha = input.deployedSourceTreeSha?.trim() ?? '';
  const organizationId = input.organizationId?.trim() ?? '';
  if (
    !/^[a-f0-9]{40,64}$/.test(sourceTreeSha) ||
    !z.string().uuid().safeParse(organizationId).success ||
    token.length > 4096
  )
    return { valid: false, payload: null, reason: 'invalid_format' };

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX)
    return { valid: false, payload: null, reason: 'invalid_format' };

  let payload: ReleaseAttestationPayload;
  try {
    const payloadRaw = new TextDecoder('utf-8', { fatal: true }).decode(
      decodeBase64Url(parts[1]),
    );
    const parsed = payloadSchema.safeParse(JSON.parse(payloadRaw));
    if (!parsed.success)
      return { valid: false, payload: null, reason: 'invalid_payload' };
    payload = parsed.data;
  } catch {
    return { valid: false, payload: null, reason: 'invalid_payload' };
  }

  let signature: Uint8Array;
  try {
    signature = decodeBase64Url(parts[2]);
  } catch {
    return { valid: false, payload: null, reason: 'invalid_signature' };
  }

  if (signature.length !== 32)
    return { valid: false, payload: null, reason: 'invalid_signature' };

  try {
    const verifyingKey = await hmacKey(key, 'verify');
    const verified = await crypto.subtle.verify(
      'HMAC',
      verifyingKey,
      exactArrayBuffer(signature),
      textBytes(`${TOKEN_PREFIX}.${parts[1]}`),
    );
    if (!verified)
      return { valid: false, payload: null, reason: 'invalid_signature' };
  } catch {
    return { valid: false, payload: null, reason: 'invalid_signature' };
  }

  const timing = validTimes(payload, now);
  if (!timing.valid)
    return {
      valid: false,
      payload: null,
      reason: timing.expired ? 'expired' : 'invalid_time_window',
    };

  if (payload.sourceTreeSha !== sourceTreeSha)
    return { valid: false, payload: null, reason: 'source_mismatch' };
  if (payload.organizationId !== organizationId)
    return { valid: false, payload: null, reason: 'organization_mismatch' };

  return { valid: true, payload, reason: null };
}
