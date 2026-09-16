import qrcode from 'qrcode-generator';

export type MfaQrResult =
  | { ok: true; size: number; path: string }
  | { ok: false; code: 'missing_data' | 'invalid_uri' | 'invalid_secret' | 'secret_mismatch' | 'generation_failed' };

/** Generate locally: enrollment credentials never leave the application for a QR service. */
export function mfaQrResult(uri?: string | null, secret?: string | null): MfaQrResult {
  if (!uri || !secret) return { ok: false, code: 'missing_data' };
  if (uri.length > 4000) return { ok: false, code: 'invalid_uri' };
  if (!/^[A-Z2-7]+=*$/i.test(secret)) return { ok: false, code: 'invalid_secret' };
  let parsed: URL;
  try { parsed = new URL(uri); } catch { return { ok: false, code: 'invalid_uri' }; }
  try {
    if (parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp' ||
        parsed.searchParams.getAll('secret').length !== 1) return { ok: false, code: 'invalid_uri' };
    if (parsed.searchParams.get('secret') !== secret) return { ok: false, code: 'secret_mismatch' };
    // URL serialisation percent-encodes Unicode account labels before byte encoding.
    const qr = qrcode(0, 'M');
    qr.addData(parsed.href);
    qr.make();
    const count = qr.getModuleCount();
    const modules: string[] = [];
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) modules.push(`M${col + 4} ${row + 4}h1v1h-1z`);
      }
    }
    return { ok: true, size: count + 8, path: modules.join('') };
  } catch {
    // Never include an enrollment URI or secret in errors or logs.
    return { ok: false, code: 'generation_failed' };
  }
}

/** Compatibility wrapper for consumers requiring geometry only. */
export function mfaQrGeometry(uri?: string | null, secret?: string | null): { size: number; path: string } | null {
  const result = mfaQrResult(uri, secret);
  return result.ok ? { size: result.size, path: result.path } : null;
}
