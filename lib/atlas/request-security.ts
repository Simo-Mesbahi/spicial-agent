export type RequestSecurityEnvironment = {
  APP_ENVIRONMENT?: string;
  APP_PUBLIC_ORIGIN?: string;
};

function parseHttpOrigin(value: string): URL | null {
  const normalized = value.trim();
  if (!normalized || normalized === 'null') return null;

  try {
    const url = new URL(normalized);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Optional canonical browser-facing origin for a trusted reverse proxy that
 * rewrites the public host before the request reaches the application runtime.
 *
 * Invalid configuration fails closed: it is never converted into a wildcard.
 */
export function configuredPublicOrigin(
  env: RequestSecurityEnvironment,
): string | null {
  const raw = env.APP_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;

  const url = parseHttpOrigin(raw);
  if (!url) return null;

  if (env.APP_ENVIRONMENT !== 'LOCAL' && url.protocol !== 'https:') return null;

  return url.origin;
}

/**
 * Validate the browser Origin of a state-changing request.
 *
 * Accepted cases are deliberately narrow:
 * - exact runtime same-origin;
 * - HTTPS browser origin -> HTTP runtime URL with the exact same host, which
 *   covers normal TLS termination without trusting proxy-supplied host headers;
 * - exact APP_PUBLIC_ORIGIN when a trusted proxy also rewrites the host.
 *
 * Missing Origin remains supported for non-browser clients. Browser cross-site
 * requests are independently rejected through Sec-Fetch-Site, and session
 * mutations retain their CSRF token checks.
 */
export function mutationOriginAllowed(
  req: Request,
  env: RequestSecurityEnvironment,
): boolean {
  const rawOrigin = req.headers.get('origin');
  if (!rawOrigin) return true;

  const origin = parseHttpOrigin(rawOrigin);
  if (!origin) return false;

  const requestUrl = new URL(req.url);
  if (!['http:', 'https:'].includes(requestUrl.protocol)) return false;

  if (origin.origin === requestUrl.origin) return true;

  if (
    origin.protocol === 'https:' &&
    requestUrl.protocol === 'http:' &&
    origin.host.toLowerCase() === requestUrl.host.toLowerCase()
  )
    return true;

  const publicOrigin = configuredPublicOrigin(env);
  return publicOrigin !== null && origin.origin === publicOrigin;
}
