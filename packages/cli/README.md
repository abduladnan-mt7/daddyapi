# @daddyapi/cli

The `daddyapi` command line for [daddyapi](../../README.md): point it at a
bot-friendly website, get a documented API, an MCP server for AI agents, and a
check that tells you when the site changed.

```bash
npm i -g @daddyapi/cli        # or: npx @daddyapi/cli <command>
```

```bash
daddyapi init <url> [--out spec.yaml]      # crawl a site → draft SiteSpec
daddyapi dev <spec> [--port 8787]          # serve as a live API + Swagger docs
daddyapi mcp <spec>                        # serve as an MCP server for AI agents
daddyapi run <spec> <resource> [--pages N] [--params k=v,...] [--format csv]
daddyapi check <spec> [--update-baseline]  # data contracts + drift detection (CI-friendly)
daddyapi types <spec> [--out client.ts]    # TypeScript types + a typed API client
daddyapi watch <spec> <resource> --key f   # row-level change events, optional signed webhook
daddyapi validate <spec>                   # check against the schema
daddyapi build <spec> [--out openapi.json] # emit the OpenAPI document
```

`dev` options: `--host`, `--cors origin|off`, `--api-key k1,k2` (or
`DADDYAPI_API_KEYS`), `--rate-limit 60/min`, `--max-pages N`, `--cache [dir]`.

Use it from Claude Code:

```bash
claude mcp add quotes -- npx -y @daddyapi/cli mcp /absolute/path/to/quotes.yaml
```

MIT
