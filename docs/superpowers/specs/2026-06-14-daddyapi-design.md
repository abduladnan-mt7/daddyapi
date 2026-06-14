# daddyapi — design

**Date:** 2026-06-14
**Status:** v1 in progress (reference TypeScript runtime)

## Context

Scraping a website live every time you need its data is repetitive and fragile:
the same parsing logic gets rewritten per project, with no caching, no docs, and
no stable contract. The goal of **daddyapi** is to flip that around — point the
tool at a **bot-friendly** website and get a clean, documented API you (and
others) can call, with the messy extraction captured once behind a stable
interface.

It is open source so the community can use it and contribute site definitions.
It deliberately targets sites that **welcome bots** (public sandboxes, open data,
sites whose robots.txt permits it). It is **not** a tool for defeating anti-bot
measures, solving captchas, or scraping behind logins — those are explicit
non-goals.

## The big idea

Point daddyapi at a website → it crawls, infers the structure, and writes a
declarative **SiteSpec** (YAML). From that one spec you get **both**:

1. a callable **data SDK** (`createClient(spec)`), and
2. a live **HTTP API** with auto-generated OpenAPI/Swagger docs (`createServer(spec)`).

Clean sites work out of the box; messy ones you refine by editing the generated
spec or dropping into a code escape-hatch. The TypeScript runtime ships first;
the spec is language-neutral (a JSON-Schema-able data format) so a Python runtime
can read the exact same files later.

## Architecture — monorepo (pnpm workspaces)

```
packages/
  spec/    SiteSpec schema (zod) + loader/validator + duration helper   ← the cross-language contract
  core/    robots · cache · fetch · extract · runtime · openapi · serve · infer
  cli/     init · dev · run · validate · build
examples/  quotes.yaml · books.yaml   (real bot-friendly sandbox sites)
```

- **@daddyapi/spec** — defines and validates the SiteSpec. The one package a
  second-language runtime must agree with. No I/O beyond reading a file.
- **@daddyapi/core** — the engine:
  - `robots` — dependency-free robots.txt parse + Allow/Disallow longest-match.
  - `cache` — `MemoryCache` (default) and `FileCache`.
  - `fetch` — `PoliteFetcher`: robots, per-origin rate-limit, cache, retries,
    timeout, identifiable user-agent. Injectable `fetchImpl` for tests.
  - `extract` — selector/transform engine over cheerio.
  - `runtime` — `runResource` (fetch → extract → normalize, with pagination)
    and `createClient` (the data SDK).
  - `openapi` — `buildOpenApi(spec)` derives an OpenAPI 3 doc from field types.
  - `serve` — `createServer(spec)` → a Hono app: one route per resource, plus
    `/openapi.json` and a `/docs` Swagger UI (CDN, pinned + SRI-hashed).
  - `infer` — best-effort single-page crawler that drafts a SiteSpec.
- **@daddyapi/cli** — the `daddyapi` command wrapping the above.

## The SiteSpec

One declarative document describes a site→API. Key parts:

- **meta**: `name`, `baseUrl`, `description`.
- **politeness** (all defaulted, conservative): `requestsPerSecond`,
  `respectRobotsTxt`, `cacheTtl`, `userAgent`, `timeoutMs`, `maxRetries`.
- **resources[]**: each becomes one API endpoint (`GET /<name>` + a client
  method). A resource has a `fetch` strategy (path template + optional
  pagination) and either a `list` (repeating-row selector + fields) or an
  `item` (page-level fields). Fields are CSS selectors with optional `attr`,
  `html`, `many`, `transform`, `default`, `optional`.

Field types drive both the OpenAPI schema and the response shape.

**Code escape-hatch (implemented):** a spec may set `hooks: <module path>` and
reference its functions as custom field `transform`s or a resource `postProcess`.
The runtime resolves non-built-in transform names from `hooks.transforms`, and
applies `hooks.postProcess[name]` to a resource's data after extraction. The CLI
loads the module relative to the spec file; the library accepts a `hooks` object
directly. See `examples/books-rated.yaml`.

## Data flows

- **Discover:** URL → `infer` → draft SiteSpec (review before use).
- **Serve:** SiteSpec → `serve` → request → polite cached fetch → extract → JSON;
  docs generated from the spec.
- **Embed:** SiteSpec → `createClient` → typed methods → normalized data.

## Error handling

- Spec validation: zod errors with the offending field path (`daddyapi validate`).
- Fetch: typed `FetchError` (`robots-disallowed`, `timeout`, `http-error`,
  `network-error`); retry with backoff on 5xx/network, no retry on 4xx.
- Extraction: per-field missing policy (`default` / `optional` / warn); the API
  returns partial `data` plus a `warnings[]` array rather than failing the call.
- Server: structured `{ error: { message, code } }`; robots-disallowed → 403,
  other fetch failures → 502.

## Testing

- Fixture-driven unit tests (saved HTML, injected fetch) — no live network in CI.
- Coverage: schema/validation, robots matching, extraction + transforms,
  runtime + pagination, server routes + OpenAPI, inference.

## Scope

**v1 (shipped):** TypeScript runtime · HTML extraction (cheerio) ·
`init/dev/run/validate/build` · memory + file cache · OpenAPI + Swagger ·
**code escape-hatches (hooks)** · content-ranked `init` · example specs ·
responsible-use docs · CI.

**Later (designed-for, not built):** Python runtime · JS-rendered pages
(Playwright adapter) · Redis cache · community spec registry · API keys/
rate-limits on served APIs · deploy templates.

## Non-goals

Anti-bot evasion, captcha solving, login-walled or paywalled scraping, ignoring
robots.txt. daddyapi is for sites that welcome bots.
