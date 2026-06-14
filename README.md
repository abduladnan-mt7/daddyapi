# daddyapi

**Point it at a bot-friendly website. Get a documented API.**

daddyapi turns a website into a clean, cached, documented API — described by one
declarative **SiteSpec** file. From that single file you get **both** a callable
data SDK **and** a live HTTP API with auto-generated OpenAPI/Swagger docs. Stop
re-writing scrapers; capture the messy extraction once, behind a stable contract.

```bash
# Crawl a site and write a draft spec
daddyapi init https://quotes.toscrape.com --out quotes.yaml

# Serve it as a live API with Swagger docs
daddyapi dev quotes.yaml
#   API      http://localhost:8787/
#   Docs     http://localhost:8787/docs
```

> [!IMPORTANT]
> **daddyapi is for websites that welcome bots** — public sandboxes, open data,
> and sites whose `robots.txt` permits crawling. It respects `robots.txt`,
> rate-limits, caches, and identifies itself by default. It is **not** a tool for
> defeating anti-bot measures, solving captchas, or scraping behind logins.
> Please scrape responsibly and within each site's terms.

## Why

Scraping live every time is repetitive and brittle: rewritten parsing per
project, no caching, no docs, no stable interface. daddyapi flips it: write (or
auto-generate) a spec once, then call a stable API that handles polite fetching,
caching, normalization, and documentation for you.

## Install

```bash
# Requires Node.js >= 20 and pnpm
git clone https://github.com/abduladnan-mt7/daddyapi.git
cd daddyapi
pnpm install
pnpm build
# Run the CLI
node packages/cli/dist/index.js help
```

(Published npm packages — `@daddyapi/cli`, `@daddyapi/core`, `@daddyapi/spec` —
are on the roadmap.)

## Quick start

```bash
# 1. Generate a draft spec from a live site (review the selectors it guesses)
daddyapi init https://quotes.toscrape.com --out quotes.yaml

# 2. Test one resource — fetch and print JSON
daddyapi run quotes.yaml quotes --pages 1

# 3. Serve it as a live, documented API
daddyapi dev quotes.yaml --port 8787

# 4. Validate a spec, or export its OpenAPI document
daddyapi validate quotes.yaml
daddyapi build quotes.yaml --out openapi.json
```

See ready-made specs in [`examples/`](./examples).

## The SiteSpec

One declarative file describes a site → API:

```yaml
name: quotes
baseUrl: https://quotes.toscrape.com
description: Quotes sandbox built for scraping practice.

resources:
  - name: quotes                 # → GET /quotes  and  client.quotes()
    fetch:
      path: /
      pagination:
        type: link
        selector: li.next a      # follow the "next" link
        maxPages: 3
    list:
      selector: .quote           # the repeating row
      fields:
        text: span.text          # shorthand: a selector → trimmed text
        author: small.author
        tags:
          selector: .tags a.tag
          many: true             # collect every match into an array
```

**Politeness** is configurable per spec and on by default:

```yaml
politeness:
  requestsPerSecond: 1
  respectRobotsTxt: true
  cacheTtl: 10m
  userAgent: "daddyapi-bot (+https://github.com/abduladnan-mt7/daddyapi)"
```

**Fields** support: `selector`, `attr` (pull an attribute), `html`, `many`
(array), `transform` (`trim`, `int`, `float`, `number`, `boolean`, `url`,
`lower`, `upper`), `default`, and `optional`.

A resource defines either a **`list`** (a repeating-row selector + per-row
fields) or an **`item`** (page-level fields). Missing required fields don't fail
the request — you get partial `data` plus a `warnings[]` array.

## Code escape-hatch (hooks)

The declarative spec covers most sites. For the hard 20% — values that need real
code — a spec can point at a **hooks** module and use its functions as custom
`transform`s (per field) or `postProcess`ors (per resource):

```yaml
# books-rated.yaml
hooks: ./hooks/books.mjs        # path relative to the spec file
resources:
  - name: books
    postProcess: sortByPrice    # a function from the hooks module
    fetch: { path: / }
    list:
      selector: article.product_pod
      fields:
        price:  { selector: .price_color, transform: [float] }
        rating: { selector: .star-rating, attr: class, transform: rating } # custom
```

```js
// hooks/books.mjs
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
export const transforms = {
  rating: (value) => WORDS[String(value).replace(/star-rating/i, '').trim().toLowerCase()] ?? null,
};
export const postProcess = {
  sortByPrice: (rows) => [...rows].sort((a, b) => a.price - b.price),
};
```

See [`examples/books-rated.yaml`](./examples/books-rated.yaml) for the full,
runnable version. Hooks are plain JS modules (`.mjs`/`.js`); since you reference
them in your own spec, they run with your trust — only point `hooks` at code you
control.

## Use it as a library

```ts
import { loadSiteSpec } from '@daddyapi/spec';
import { createClient, createServer } from '@daddyapi/core';

const spec = loadSiteSpec('quotes.yaml');

// Data SDK
const client = createClient(spec);
const { data, warnings, meta } = await client.quotes({ maxPages: 2 });

// Or mount it as an HTTP API (Hono app — deploy anywhere)
const app = createServer(spec);
// app.fetch(request) → Response   |   serve with @hono/node-server, Vercel, etc.
```

## Packages

| Package | What it is |
| --- | --- |
| [`@daddyapi/spec`](./packages/spec) | The SiteSpec schema, loader & validator — the language-neutral contract. |
| [`@daddyapi/core`](./packages/core) | Polite fetching, extraction, the data SDK, the HTTP server, and the crawler. |
| [`@daddyapi/cli`](./packages/cli) | The `daddyapi` command: `init`, `dev`, `run`, `validate`, `build`. |

## Roadmap

- [x] **Code escape-hatches** (hooks) for the hard 20% of sites
- [ ] **Python runtime** reading the same SiteSpec files
- [ ] JS-rendered pages (optional Playwright adapter)
- [ ] Redis cache backend
- [ ] Community **spec registry**
- [ ] API keys / rate limits on served APIs
- [ ] One-click deploy templates

## Contributing

Contributions and new example specs are welcome — see
[CONTRIBUTING.md](./CONTRIBUTING.md). The design doc lives in
[`docs/superpowers/specs`](./docs/superpowers/specs).

## License

[MIT](./LICENSE) © 2026 Abdul Adnan
