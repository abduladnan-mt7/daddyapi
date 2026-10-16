import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseDuration, type SiteSpec } from '@daddyapi/spec';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { etag } from 'hono/etag';
import { createFetcher, FetchError, type PoliteFetcher } from './fetch';
import type { Hooks } from './hooks';
import { buildOpenApi } from './openapi';
import { DEFAULT_MAX_PAGES_LIMIT, ParamError, parseResourceQuery, shapeData } from './params';
import { runResource } from './runtime';

export interface RateLimitOptions {
  /** Requests allowed per client per window. */
  limit: number;
  /** Window length in milliseconds (default one minute). */
  windowMs?: number;
}

export interface ServeOptions {
  fetcher?: PoliteFetcher;
  /** Code escape-hatch: custom transforms and post-processors. */
  hooks?: Hooks;
  /**
   * Allowed CORS origin(s) for browser clients. Defaults to `*` (the API only
   * serves public, read-only data). Pass `false` to send no CORS headers.
   */
  cors?: string | string[] | false;
  /**
   * When set, resource routes require one of these keys, sent as
   * `Authorization: Bearer <key>` or `X-API-Key: <key>`. The index, health,
   * docs and OpenAPI routes stay public.
   */
  apiKeys?: string[];
  /** Per-client request limit for resource routes. Off by default. */
  rateLimit?: RateLimitOptions;
  /**
   * Identifies the caller for rate limiting when no API key is sent, e.g. the
   * socket's remote address. Defaults to one shared bucket.
   */
  clientId?: (c: Context) => string | undefined;
  /** Upper bound for `?pages=` (default 20). */
  maxPagesLimit?: number;
}

interface ErrorBody {
  error: { code: string; message: string; param?: string };
  requestId: string;
}

function errorBody(c: Context, code: string, message: string, param?: string): ErrorBody {
  return {
    error: { code, message, ...(param ? { param } : {}) },
    requestId: c.get('requestId' as never) as string,
  };
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time check of a presented key against the allowed keys. */
function keyMatches(presented: string, allowed: Buffer[]): boolean {
  const digest = sha256(presented);
  let ok = false;
  for (const candidate of allowed) ok = timingSafeEqual(digest, candidate) || ok;
  return ok;
}

function presentedKey(c: Context): string | undefined {
  const header = c.req.header('x-api-key');
  if (header) return header.trim();
  const auth = c.req.header('authorization');
  const match = auth ? /^Bearer\s+(.+)$/i.exec(auth) : null;
  return match ? match[1]!.trim() : undefined;
}

class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  hit(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
      if (this.windows.size > 10_000) this.prune(now);
    }
    window.count++;
    return {
      allowed: window.count <= this.limit,
      remaining: Math.max(0, this.limit - window.count),
      resetAt: window.resetAt,
    };
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}

/** Map an engine error to an HTTP status and stable error code. */
function classify(err: unknown): { status: 400 | 403 | 502 | 504 | 500; code: string } {
  if (err instanceof ParamError) return { status: 400, code: 'bad-request' };
  if (err instanceof FetchError) {
    if (err.code === 'robots-disallowed') return { status: 403, code: 'robots-disallowed' };
    if (err.code === 'timeout') return { status: 504, code: 'upstream-timeout' };
    return { status: 502, code: `upstream-${err.code}` };
  }
  return { status: 500, code: 'internal-error' };
}

/** Turn a SiteSpec into a Hono app: one route per resource, plus OpenAPI + docs. */
export function createServer(spec: SiteSpec, options: ServeOptions = {}): Hono {
  const fetcher = options.fetcher ?? createFetcher(spec.politeness);
  const maxPagesLimit = options.maxPagesLimit ?? DEFAULT_MAX_PAGES_LIMIT;
  const allowedKeys = (options.apiKeys ?? []).filter(Boolean).map(sha256);
  const limiter = options.rateLimit
    ? new FixedWindowLimiter(options.rateLimit.limit, options.rateLimit.windowMs ?? 60_000)
    : undefined;
  const maxAgeSeconds = Math.floor(parseDuration(spec.politeness.cacheTtl) / 1000);
  const startedAt = Date.now();
  const app = new Hono();

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id')?.slice(0, 128) || randomUUID();
    c.set('requestId' as never, requestId as never);
    await next();
    c.header('X-Request-Id', requestId);
  });

  if (options.cors !== false) {
    app.use(
      '*',
      cors({
        origin: options.cors ?? '*',
        allowMethods: ['GET', 'HEAD', 'OPTIONS'],
        allowHeaders: ['Authorization', 'X-API-Key', 'If-None-Match', 'X-Request-Id'],
        exposeHeaders: [
          'ETag',
          'X-Request-Id',
          'RateLimit-Limit',
          'RateLimit-Remaining',
          'RateLimit-Reset',
          'Retry-After',
        ],
        maxAge: 600,
      }),
    );
  }

  // Content-hash ETags for the static routes; resource routes set their own.
  for (const path of ['/', '/openapi.json', '/docs']) app.use(path, etag());

  app.get('/', (c) =>
    c.json({
      name: spec.name,
      description: spec.description,
      docs: '/docs',
      openapi: '/openapi.json',
      health: '/health',
      auth: allowedKeys.length > 0 ? 'api-key' : 'none',
      resources: spec.resources.map((r) => ({
        name: r.name,
        path: `/${r.name}`,
        description: r.description,
      })),
    }),
  );

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      name: spec.name,
      resources: spec.resources.length,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    }),
  );

  app.get('/openapi.json', (c) =>
    c.json(
      buildOpenApi(spec, {
        apiKeys: allowedKeys.length > 0,
        rateLimit: limiter !== undefined,
        maxPagesLimit,
      }),
    ),
  );
  app.get('/docs', (c) => c.html(swaggerHtml(spec.name)));

  for (const resource of spec.resources) {
    app.get(`/${resource.name}`, async (c) => {
      const key = presentedKey(c);

      if (allowedKeys.length > 0) {
        if (!key || !keyMatches(key, allowedKeys)) {
          c.header('WWW-Authenticate', 'Bearer realm="daddyapi"');
          return c.json(
            errorBody(
              c,
              'unauthorized',
              key ? 'Invalid API key' : 'Missing API key: send "Authorization: Bearer <key>" or "X-API-Key"',
            ),
            401,
          );
        }
      }

      if (limiter) {
        const bucket = key
          ? `key:${sha256(key).toString('hex')}`
          : `client:${options.clientId?.(c) ?? 'anonymous'}`;
        const verdict = limiter.hit(bucket);
        const resetSeconds = Math.max(0, Math.ceil((verdict.resetAt - Date.now()) / 1000));
        c.header('RateLimit-Limit', String(limiter.limit));
        c.header('RateLimit-Remaining', String(verdict.remaining));
        c.header('RateLimit-Reset', String(resetSeconds));
        if (!verdict.allowed) {
          c.header('Retry-After', String(resetSeconds));
          return c.json(
            errorBody(c, 'rate-limited', `Rate limit of ${limiter.limit} requests exceeded; retry in ${resetSeconds}s`),
            429,
          );
        }
      }

      try {
        const query = parseResourceQuery(resource, c.req.query(), { maxPagesLimit });
        const result = await runResource(spec, resource, {
          fetcher,
          params: query.params,
          maxPages: query.maxPages,
          hooks: options.hooks,
        });
        const shaped = shapeData(result.data, query);
        c.header(
          'Cache-Control',
          allowedKeys.length > 0 ? `private, max-age=${maxAgeSeconds}` : `public, max-age=${maxAgeSeconds}`,
        );
        // The ETag covers the content (data + warnings), not meta.fetchedAt, so
        // an unchanged page really does come back as 304 Not Modified.
        const tag = `W/"${createHash('sha1')
          .update(JSON.stringify([shaped.data, result.warnings]))
          .digest('base64url')}"`;
        c.header('ETag', tag);
        const ifNoneMatch = c.req.header('if-none-match');
        if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === tag || t.trim() === '*')) {
          return c.body(null, 304);
        }
        return c.json({
          data: shaped.data,
          warnings: result.warnings,
          meta: {
            ...result.meta,
            ...(shaped.total !== undefined ? { total: shaped.total, returned: (shaped.data as unknown[]).length } : {}),
            ...(query.offset !== undefined ? { offset: query.offset } : {}),
            ...(query.limit !== undefined ? { limit: query.limit } : {}),
            ...(query.fields ? { fields: query.fields } : {}),
          },
        });
      } catch (err) {
        const { status, code } = classify(err);
        const message = status === 500 ? 'Internal error' : err instanceof Error ? err.message : String(err);
        const param = err instanceof ParamError ? err.param : undefined;
        return c.json(errorBody(c, code, message, param), status);
      }
    });
  }

  app.notFound((c) =>
    c.json(
      errorBody(c, 'not-found', `No route ${c.req.method} ${c.req.path}. See / for the available resources.`),
      404,
    ),
  );

  app.onError((_err, c) => c.json(errorBody(c, 'internal-error', 'Internal error'), 500));

  return app;
}

// Swagger UI is loaded from a CDN, pinned to an exact version with Subresource
// Integrity hashes so a compromised CDN can't inject altered assets.
const SWAGGER_UI_VERSION = '5.32.6';
const SWAGGER_UI_CSS_SRI =
  'sha384-9Q2fpS+xeS4ffJy6CagnwoUl+4ldAYhOs9pgZuEKxypVModhmZFzeMlvVsAjf7uT';
const SWAGGER_UI_JS_SRI =
  'sha384-EYdOaiRwn44zNjrw+Tfs06qYz9BGQVo2f4/pLY5i7VorbjnZNhdplAbTBk8FXHUJ';

function swaggerHtml(title: string): string {
  const safe = title.replace(/</g, '&lt;');
  const base = `https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe} API — docs</title>
  <link rel="stylesheet" href="${base}/swagger-ui.css"
    integrity="${SWAGGER_UI_CSS_SRI}" crossorigin="anonymous" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${base}/swagger-ui-bundle.js"
    integrity="${SWAGGER_UI_JS_SRI}" crossorigin="anonymous"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;
}
