# Changelog

## 0.2.0

### Added

- **MCP server** (`@daddyapi/mcp`, `daddyapi mcp <spec>`): every resource becomes a
  typed, read-only MCP tool with typed inputs (path parameters, `pages`, `limit`,
  `offset`, `fields`) and a typed output schema. Errors are tool errors; the
  OpenAPI document is an MCP resource.
- **`daddyapi check`**: data contracts and drift detection. Implicit contracts from
  the field specs, an optional per-resource `expect` block (`minRows`, `maxRows`,
  example `params`, per-field `fillRate`, `pattern`, `min`, `max`), and baselines
  that flag row drops, fill-rate collapses and type changes. Exit codes 0/1/2 for CI.
- **`daddyapi types`**: TypeScript interfaces plus a dependency-free typed client for
  the served API, or `--json-schema`.
- **Production HTTP API** in `daddyapi dev` / `createServer`:
  - correct status codes (400, 401, 403, 404, 429, 502, 504) with a JSON error body
    and request id
  - `?limit`, `?offset`, `?fields`, validated `?pages` (capped by `--max-pages`)
  - `?format=csv|ndjson`
  - CORS (`--cors`), content-hash ETags with real 304s, `Cache-Control`
  - optional API keys (`--api-key`, `DADDYAPI_API_KEYS`) and per-client rate limiting
    (`--rate-limit 60/min`)
  - `/health`, `--host`, clear message when the port is busy
- `daddyapi run --format json|csv|ndjson --out file`.
- The `quotes` example now has an `author` resource and `expect` contracts.

### Fixed

- `daddyapi init quotes.toscrape.com` (no `https://`) failed with a bare
  "Invalid URL"; the scheme is now added, and non-URLs get a readable error.
- Commands that need a spec file explain what to do when given a web address or a
  missing path.
- Fields that end in a custom hook transform are no longer documented as strings.

## 0.1.0

- First release: SiteSpec schema, polite fetching, extraction, data SDK, HTTP API
  with OpenAPI and Swagger docs, `init`, `dev`, `run`, `validate`, `build`.
