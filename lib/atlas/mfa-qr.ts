/** Auth-issued images only. Never forward the enrollment secret to a QR service. */
export function mfaQrSource(payload?: string | null): string | null {
  const value = payload?.trim();
  if (!value || value.length > 200_000) return null;
  if (/^data:image\/(?:svg\+xml|png)(?:;[^,]*)?,/i.test(value)) return value;
  // Supabase's raw SVG can include an XML declaration, comments or a doctype.
  // It stays in an <img>, never injected as HTML.
  const svg = value.replace(/^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)*/i, '');
  return /^<svg[\s>]/i.test(svg)
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    : null;
}
