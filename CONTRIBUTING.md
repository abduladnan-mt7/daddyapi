# Contributing to daddyapi

Thanks for your interest! daddyapi is open source and contributions are welcome —
bug fixes, new transforms, runtime improvements, docs, and especially new
**example specs** for bot-friendly sites.

## Ground rules

daddyapi targets **websites that welcome bots**. Please only contribute specs and
features for sites whose `robots.txt` and terms permit crawling. We will not
accept anything aimed at defeating anti-bot measures, solving captchas, or
scraping behind logins/paywalls.

## Development setup

```bash
# Node.js >= 20 and pnpm
pnpm install
pnpm build       # build spec → core → cli (topological)
pnpm typecheck   # tsc --noEmit across packages
pnpm test        # vitest (fixture-driven, no live network)
```

Run the CLI during development:

```bash
node packages/cli/dist/index.js run examples/quotes.yaml quotes --pages 1
```

## Project layout

- `packages/spec` — the SiteSpec schema. Changes here are the cross-language
  contract; keep it declarative and validated with zod.
- `packages/core` — the engine. Add tests under `packages/core/test` using HTML
  fixtures and the injected `fetchImpl` (see `test/helpers.ts`). **No live
  network in tests.**
- `packages/cli` — the command surface.
- `examples/` — ready-made specs. New ones are a great first contribution.

## Adding an example spec

1. Confirm the site welcomes bots (check `robots.txt`).
2. Write `examples/<site>.yaml`. Start with `daddyapi init <url>` and refine.
3. Verify with `daddyapi validate` and `daddyapi run`.
4. Open a PR describing the site and what the spec exposes.

## Pull requests

- Keep changes focused; add or update tests for behavior changes.
- Make sure `pnpm build && pnpm typecheck && pnpm test` all pass.
- Be kind and constructive in review. 🙏
