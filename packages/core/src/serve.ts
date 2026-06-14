import type { SiteSpec } from '@daddyapi/spec';
import { Hono } from 'hono';
import { createFetcher, FetchError, type PoliteFetcher } from './fetch';
import type { Hooks } from './hooks';
import { buildOpenApi } from './openapi';
import { runResource } from './runtime';

export interface ServeOptions {
  fetcher?: PoliteFetcher;
  /** Code escape-hatch: custom transforms and post-processors. */
  hooks?: Hooks;
}

/** Turn a SiteSpec into a Hono app: one route per resource, plus OpenAPI + docs. */
export function createServer(spec: SiteSpec, options: ServeOptions = {}): Hono {
  const fetcher = options.fetcher ?? createFetcher(spec.politeness);
  const app = new Hono();

  app.get('/', (c) =>
    c.json({
      name: spec.name,
      description: spec.description,
      docs: '/docs',
      openapi: '/openapi.json',
      resources: spec.resources.map((r) => ({
        name: r.name,
        path: `/${r.name}`,
        description: r.description,
      })),
    }),
  );

  app.get('/openapi.json', (c) => c.json(buildOpenApi(spec)));
  app.get('/docs', (c) => c.html(swaggerHtml(spec.name)));

  for (const resource of spec.resources) {
    app.get(`/${resource.name}`, async (c) => {
      try {
        const params: Record<string, string> = { ...c.req.query() };
        const pagesRaw = c.req.query('pages');
        const maxPages = pagesRaw ? Math.max(1, Number(pagesRaw) || 1) : undefined;
        const result = await runResource(spec, resource, {
          fetcher,
          params,
          maxPages,
          hooks: options.hooks,
        });
        return c.json(result);
      } catch (err) {
        const robotsBlocked = err instanceof FetchError && err.code === 'robots-disallowed';
        return c.json(
          {
            error: {
              message: err instanceof Error ? err.message : String(err),
              code: err instanceof FetchError ? err.code : 'error',
            },
          },
          robotsBlocked ? 403 : 502,
        );
      }
    });
  }

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
