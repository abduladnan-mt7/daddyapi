import {
  buildOpenApi,
  createFetcher,
  DEFAULT_MAX_PAGES_LIMIT,
  FetchError,
  fieldValueType,
  type Hooks,
  ParamError,
  type PoliteFetcher,
  parseResourceQuery,
  type RawQuery,
  resourceInputs,
  runResource,
  shapeData,
} from '@daddyapi/core';
import type { FieldSpec, Fields, Resource, SiteSpec } from '@daddyapi/spec';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type ZodRawShape, type ZodTypeAny, z } from 'zod';

export interface McpServerOptions {
  fetcher?: PoliteFetcher;
  /** Code escape-hatch: custom transforms and post-processors. */
  hooks?: Hooks;
  /** Upper bound for the `pages` argument (default 20). */
  maxPagesLimit?: number;
  /** Prefix for tool names, e.g. "quotes" gives "quotes_authors". */
  toolPrefix?: string;
  /** Server version reported to clients. */
  version?: string;
}

/** MCP tool name for a resource: letters, digits and underscores only. */
export function toolName(resource: Resource, prefix?: string): string {
  const base = resource.name.replace(/[^a-zA-Z0-9_]/g, '_');
  return prefix ? `${prefix.replace(/[^a-zA-Z0-9_]/g, '_')}_${base}` : base;
}

function fieldType(spec: FieldSpec): ZodTypeAny {
  const valueType = fieldValueType(spec);
  const scalar =
    valueType === 'number'
      ? z.number()
      : valueType === 'boolean'
        ? z.boolean()
        : valueType === 'unknown'
          ? z.unknown()
          : z.string();
  const value = typeof spec !== 'string' && spec.many ? z.array(scalar) : scalar;
  // Fields can come back null when a page is missing them, and `fields`
  // selection can drop any of them, so every field is optional in the output.
  return value.nullable().optional();
}

function rowSchema(fields: Fields): ZodTypeAny {
  const shape: ZodRawShape = {};
  for (const [name, spec] of Object.entries(fields)) shape[name] = fieldType(spec);
  return z.object(shape).passthrough();
}

/** Typed input arguments for a resource's tool. */
export function toolInputShape(resource: Resource, maxPagesLimit = DEFAULT_MAX_PAGES_LIMIT): ZodRawShape {
  const inputs = resourceInputs(resource);
  const shape: ZodRawShape = {};
  for (const param of inputs.pathParams) {
    shape[param] = z.string().min(1).describe(`Value for {${param}} in ${resource.fetch.path}`);
  }
  if (inputs.paginated) {
    shape.pages = z
      .number()
      .int()
      .min(1)
      .max(maxPagesLimit)
      .optional()
      .describe(`How many pages to fetch (default ${resource.fetch.pagination?.maxPages ?? 1}, max ${maxPagesLimit}).`);
  }
  if (inputs.isList) {
    shape.limit = z.number().int().min(1).optional().describe('Return at most this many rows.');
    shape.offset = z.number().int().min(0).optional().describe('Skip this many rows first.');
  }
  if (inputs.fieldNames.length > 0) {
    shape.fields = z
      .array(z.enum(inputs.fieldNames as [string, ...string[]]))
      .optional()
      .describe('Only return these fields.');
  }
  return shape;
}

/** Shape of a tool's structured result. */
export function toolOutputShape(resource: Resource): ZodRawShape {
  const fields = resource.list?.fields ?? resource.item?.fields ?? {};
  return {
    data: resource.list ? z.array(rowSchema(fields)) : rowSchema(fields),
    warnings: z.array(z.object({ field: z.string(), message: z.string() }).passthrough()),
    meta: z.record(z.unknown()),
  };
}

function toolDescription(spec: SiteSpec, resource: Resource): string {
  const inputs = resourceInputs(resource);
  const what = (resource.description ?? `${resource.name} from ${spec.name}`).trim().replace(/[.\s]+$/, '');
  const kind = inputs.isList
    ? `Returns a list of rows with fields: ${inputs.fieldNames.join(', ')}.`
    : `Returns one object with fields: ${inputs.fieldNames.join(', ')}.`;
  const source = `Source: ${new URL(resource.fetch.path.replace(/\{(\w+)\}/g, ':$1'), spec.baseUrl).href}.`;
  const paging = inputs.paginated ? ' Use "pages" to read further, and "limit"/"offset" to page through rows.' : '';
  return `${what}. ${kind} ${source} Read-only, cached and polite (respects robots.txt and rate limits).${paging}`;
}

function errorText(err: unknown): string {
  if (err instanceof ParamError) return `Invalid argument "${err.param}": ${err.message}`;
  if (err instanceof FetchError) {
    if (err.code === 'robots-disallowed') return `The site's robots.txt disallows this page: ${err.message}`;
    return `The site could not be fetched (${err.code}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build an MCP server for a SiteSpec. Every resource becomes a read-only tool
 * with typed inputs (path parameters, pages, limit, offset, fields) and a typed
 * structured result, so agents get the same validated data as the HTTP API.
 */
export function createMcpServer(spec: SiteSpec, options: McpServerOptions = {}): McpServer {
  const fetcher = options.fetcher ?? createFetcher(spec.politeness);
  const maxPagesLimit = options.maxPagesLimit ?? DEFAULT_MAX_PAGES_LIMIT;
  const server = new McpServer(
    { name: `daddyapi-${spec.name}`, version: options.version ?? '0.1.0' },
    {
      instructions:
        `Tools for ${spec.name} (${spec.baseUrl})${spec.description ? `: ${spec.description}` : ''}. ` +
        'Each tool returns { data, warnings, meta }. Data is extracted deterministically from the live site ' +
        'with no LLM involved; warnings list fields that could not be found.',
    },
  );

  for (const resource of spec.resources) {
    server.registerTool(
      toolName(resource, options.toolPrefix),
      {
        title: resource.description ?? resource.name,
        description: toolDescription(spec, resource),
        inputSchema: toolInputShape(resource, maxPagesLimit),
        outputSchema: toolOutputShape(resource),
        annotations: {
          title: resource.description ?? resource.name,
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>) => {
        try {
          const query = parseResourceQuery(resource, args as RawQuery, { maxPagesLimit });
          const result = await runResource(spec, resource, {
            fetcher,
            params: query.params,
            maxPages: query.maxPages,
            hooks: options.hooks,
          });
          const shaped = shapeData(result.data, query);
          const payload = {
            data: shaped.data,
            warnings: result.warnings,
            meta: {
              ...result.meta,
              ...(shaped.total !== undefined
                ? { total: shaped.total, returned: (shaped.data as unknown[]).length }
                : {}),
            },
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
            structuredContent: payload,
          };
        } catch (err) {
          return { isError: true, content: [{ type: 'text' as const, text: errorText(err) }] };
        }
      },
    );
  }

  server.registerResource(
    'openapi',
    `daddyapi://${spec.name}/openapi.json`,
    {
      title: `${spec.name} OpenAPI document`,
      description: 'The OpenAPI 3 description of the same resources, as served over HTTP.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(buildOpenApi(spec, { maxPagesLimit }), null, 2),
        },
      ],
    }),
  );

  return server;
}

/** Run the MCP server over stdio (for Claude Desktop, Claude Code, Cursor, ...). */
export async function serveMcpStdio(spec: SiteSpec, options: McpServerOptions = {}): Promise<McpServer> {
  const server = createMcpServer(spec, options);
  await server.connect(new StdioServerTransport());
  return server;
}
