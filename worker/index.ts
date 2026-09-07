import { handleApi, type AtlasEnv } from '../lib/atlas/api';
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
      const response = await handleProductionApi(request, env);
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
