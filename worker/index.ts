import { handleApi, type AtlasEnv } from '../lib/atlas/api';
import { handleAdminOperationsApi } from '../lib/atlas/admin-operations-api';
import {
  adminRefreshToken,
  adminRefreshTokenFromResponse,
  adminSessionExpiredResponse,
  inspectAdminServerSession,
  isAdminActivityRequest,
  isAdminAuthenticationCompletion,
  isProtectedAdminApi,
  registerAdminServerSession,
  revokeAdminServerSession,
  rotateAdminServerSession,
  touchAdminServerSession,
  withClearedAdminCookies,
  type AdminServerSessionState,
} from '../lib/atlas/admin-session-server';
import {
  handleProductionApi,
  recordProductionPerformance,
  type ProductionEnv,
} from '../lib/atlas/production-api';
/** Cloudflare Worker entry point for the vinext-starter template. */
import {
  handleImageOptimization,
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
} from 'vinext/server/image-optimization';
import handler from 'vinext/server/app-router-entry';

interface Env extends AtlasEnv, ProductionEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function hardenDocumentResponse(request: Request, response: Response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  headers.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
  headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (new URL(request.url).protocol === 'https:')
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  const path = new URL(request.url).pathname;
  if (path === '/admin' || path.startsWith('/admin/') || path === '/suivi')
    headers.set('Cache-Control', 'no-store, max-age=0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function productionResponse(request: Request, env: Env, pathname: string) {
  return pathname.startsWith('/api/production/admin/operations')
    ? handleAdminOperationsApi(request, env)
    : handleProductionApi(request, env);
}

async function protectedAdminResponse(request: Request, env: Env, pathname: string) {
  const refreshToken = adminRefreshToken(request);
  let serverSession: AdminServerSessionState | null = null;

  if (isProtectedAdminApi(pathname)) {
    if (!refreshToken) return adminSessionExpiredResponse(request);
    serverSession = await inspectAdminServerSession(env.DB, refreshToken);
    // Missing is deliberately rejected, not bootstrapped. A missing D1 marker can
    // mean a fresh deployment, storage loss, or a copied credential; every case
    // is safer when it requires a new MFA-authenticated admin session.
    if (serverSession.state !== 'active') return adminSessionExpiredResponse(request);
    if (isAdminActivityRequest(request)) {
      const touched = await touchAdminServerSession(env.DB, refreshToken);
      if (!touched) return adminSessionExpiredResponse(request);
    }
  }

  let response = await productionResponse(request, env, pathname);

  if (pathname === '/api/production/admin/logout') {
    if (refreshToken) await revokeAdminServerSession(env.DB, refreshToken);
    return response;
  }

  if (isAdminAuthenticationCompletion(pathname) && response.ok) {
    const issuedRefreshToken = adminRefreshTokenFromResponse(response);
    if (issuedRefreshToken) await registerAdminServerSession(env.DB, issuedRefreshToken);
    return response;
  }

  if (!isProtectedAdminApi(pathname) || !refreshToken || !serverSession) return response;

  if (response.status === 401) {
    await revokeAdminServerSession(env.DB, refreshToken);
    response = withClearedAdminCookies(request, response);
    return response;
  }

  if (response.ok) {
    const rotatedRefreshToken = adminRefreshTokenFromResponse(response);
    if (rotatedRefreshToken && rotatedRefreshToken !== refreshToken)
      await rotateAdminServerSession(env.DB, refreshToken, rotatedRefreshToken);
  }

  return response;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/production/')) {
      const startedAt = Date.now();
      const response = url.pathname.startsWith('/api/production/admin/')
        ? await protectedAdminResponse(request, env, url.pathname)
        : await productionResponse(request, env, url.pathname);
      ctx.waitUntil(
        recordProductionPerformance(env, url.pathname, response.status, Date.now() - startedAt),
      );
      return response;
    }
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);

    if (url.pathname === '/_vinext/image') {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    return hardenDocumentResponse(request, await handler.fetch(request, env, ctx));
  },
};

export default worker;
