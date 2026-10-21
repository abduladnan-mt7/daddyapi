# @daddyapi/mcp

Serve a [daddyapi](../../README.md) SiteSpec as an [MCP](https://modelcontextprotocol.io)
server, so AI agents can read a bot-friendly website through typed, read-only tools.

Most people use it through the CLI:

```bash
npx -y @daddyapi/cli mcp ./quotes.yaml
```

From code:

```ts
import { loadSiteSpec } from '@daddyapi/spec';
import { createMcpServer, serveMcpStdio } from '@daddyapi/mcp';

const spec = loadSiteSpec('quotes.yaml');

await serveMcpStdio(spec);              // stdio, for Claude Desktop, Claude Code, Cursor, ...
const server = createMcpServer(spec);   // or connect it to any MCP transport yourself
```

Each resource in the spec becomes one tool:

- **Inputs**: the spec's `{param}` path parameters (required strings), `pages`
  (bounded by `maxPagesLimit`, default 20), `limit`, `offset`, and `fields` as an
  enum of the resource's field names.
- **Output**: `{ data, warnings, meta }` as structured content with an output
  schema derived from the field transforms, plus the same JSON as text.
- **Annotations**: `readOnlyHint`, `idempotentHint` and `openWorldHint` are set;
  nothing a tool does changes the site.
- **Errors**: invalid arguments, `robots.txt` blocks and site failures come back
  as tool errors (`isError: true`) with a readable message.

The server also exposes the OpenAPI document as the MCP resource
`daddyapi://<spec name>/openapi.json`.

Options: `fetcher`, `hooks`, `maxPagesLimit`, `toolPrefix` (namespace tool names
when running several specs), `version`.
