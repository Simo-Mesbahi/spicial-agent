import qrcode from 'qrcode-generator';

const ISSUER = 'SAV SC Administration';
const BASE32 = /^[A-Z2-7]+=*$/i;

function normalizeSecret(secret?: string | null) {
  const value = secret?.replace(/\s+/g, '').toUpperCase() ?? '';
  return value && value.length <= 512 && BASE32.test(value) ? value : null;
}

function canonicalTotpUri(secret: string) {
  const label = encodeURIComponent(ISSUER);
  const issuer = encodeURIComponent(ISSUER);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

function trustedTotpUri(uri: string | null | undefined, secret: string) {
  if (!uri || uri.length > 4000) return null;
  try {
    const parsed = new URL(uri);
    const uriSecret = normalizeSecret(parsed.searchParams.get('secret'));
    if (
      parsed.protocol !== 'otpauth:' ||
      parsed.hostname !== 'totp' ||
      parsed.searchParams.getAll('secret').length !== 1 ||
      uriSecret !== secret
    )
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function geometry(payload: string) {
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  const modules: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) modules.push(`M${col + 4} ${row + 4}h1v1h-1z`);
    }
  }
  return { size: count + 8, path: modules.join('') };
}

/**
 * Generate the enrollment QR locally so the TOTP credential never leaves the app.
 * Prefer the Auth-issued otpauth URI when it is structurally valid and bound to the
 * exact enrollment secret. If Auth returns an unusable URI, build a canonical TOTP
 * URI from the validated secret instead of degrading immediately to manual setup.
 */
export function mfaQrResult(
  uri?: string | null,
  secret?: string | null,
): ({ ok: true; size: number; path: string } | { ok: false; code: 'invalid_secret' | 'generation_failed' }) {
  const normalizedSecret = normalizeSecret(secret);
  if (!normalizedSecret) return { ok: false, code: 'invalid_secret' };
  try {
    return { ok: true, ...geometry(trustedTotpUri(uri, normalizedSecret) ?? canonicalTotpUri(normalizedSecret)) };
  } catch {
    // Never include an enrollment URI or secret in errors or logs.
    return { ok: false, code: 'generation_failed' };
  }
}

export function mfaQrGeometry(uri?: string | null, secret?: string | null): {size: number; path: string} | null {
  const result = mfaQrResult(uri, secret);
  return result.ok ? {size: result.size, path: result.path} : null;
}
