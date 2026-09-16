import qrcode from 'qrcode-generator';

/** Generate locally: enrollment credentials never leave the application for a QR service. */
export function mfaQrGeometry(uri?: string | null, secret?: string | null): { size: number; path: string } | null {
  if (!uri || uri.length > 4000 || !secret) return null;
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp' ||
        parsed.searchParams.getAll('secret').length !== 1 ||
        parsed.searchParams.get('secret') !== secret || !/^[A-Z2-7]+=*$/i.test(secret)) return null;
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
    return { size: count + 8, path: modules.join('') };
  } catch {
    // Never include an enrollment URI or secret in errors or logs.
    return null;
  }
}
