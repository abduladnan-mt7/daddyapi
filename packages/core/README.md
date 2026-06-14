# @daddyapi/core

The [daddyapi](../../README.md) engine: polite fetching, extraction, the data
SDK, the HTTP server, and the crawler.

```ts
import { createClient, createServer, runResource, inferSpec } from '@daddyapi/core';

const client = createClient(spec);          // data SDK
const app = createServer(spec);             // Hono HTTP API + OpenAPI + /docs
const draft = await inferSpec('https://...'); // crawl → draft SiteSpec
```

Highlights:

- `PoliteFetcher` — robots.txt, per-origin rate-limit, caching, retries,
  identifiable user-agent.
- `runResource` / `createClient` — fetch → extract → normalize, with pagination.
- `createServer` — one route per resource, generated OpenAPI 3 + Swagger UI.
- `buildOpenApi` — derive an OpenAPI document from a spec.
- `inferSpec` — best-effort crawler that drafts a SiteSpec.

MIT
