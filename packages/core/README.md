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
- `createServer` options — API keys, per-client rate limiting, CORS, ETags,
  `?limit/offset/fields/format`, JSON errors with request ids, `/health`.
- `checkSpec` / `evaluateResource` / `compareToBaseline` — data contracts and
  drift detection behind `daddyapi check`.
- `generateTypeScript` / `generateJsonSchema` — typed client and schema codegen.
- `toCsv` / `toNdjson` — export helpers.
- `diffData` / `buildWatchEvent` / `signPayload` — row-level change detection
  and signed webhook payloads behind `daddyapi watch`.
- `inferSpec` — best-effort crawler that drafts a SiteSpec.

MIT
